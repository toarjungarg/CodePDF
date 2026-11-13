// The PDF viewer page. Runs inside a locked-down VS Code webview: it receives
// the PDF's bytes from the extension and draws them with pdf.js.

import type * as PdfJsLib from "pdfjs-dist";
import type * as PdfViewerLib from "pdfjs-dist/web/pdf_viewer.mjs";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

type Action =
  | { action: "zoomIn" }
  | { action: "zoomOut" }
  | { action: "setScale"; value: string }
  | { action: "goToPage"; page: number }
  | { action: "find"; query: string; previous?: boolean };

type ToViewer =
  | { type: "load"; data: unknown; reload: boolean }
  | { type: "error"; message: string }
  | ({ type: "action" } & Action);

interface ViewerState {
  status: "loading" | "loaded" | "error" | "password";
  pagesCount: number;
  page: number;
  scale: number;
  scaleValue: string;
  error?: string;
  findMatches?: { current: number; total: number };
}

interface SavedState {
  page?: number;
  scaleValue?: string;
}

const vscode = acquireVsCodeApi();
const PRESET_SCALES = new Set(["auto", "page-width", "page-fit"]);

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`The viewer page is missing #${id}.`);
  }
  return found as T;
}

const config = document.body.dataset as Record<"pdfjs" | "worker" | "viewer" | "cmaps" | "standardFonts" | "wasm" | "iccs", string>;
const container = element<HTMLDivElement>("viewerContainer");
const pageInput = element<HTMLInputElement>("pageNumber");
const pageCount = element<HTMLSpanElement>("pageCount");
const prevPage = element<HTMLButtonElement>("prevPage");
const nextPage = element<HTMLButtonElement>("nextPage");
const zoomIn = element<HTMLButtonElement>("zoomIn");
const zoomOut = element<HTMLButtonElement>("zoomOut");
const scaleSelect = element<HTMLSelectElement>("scaleSelect");
const customScale = element<HTMLOptionElement>("customScale");
const findInput = element<HTMLInputElement>("findInput");
const findPrev = element<HTMLButtonElement>("findPrev");
const findNext = element<HTMLButtonElement>("findNext");
const findResult = element<HTMLSpanElement>("findResult");
const messageBox = element<HTMLDivElement>("message");
const passwordBox = element<HTMLDivElement>("passwordBox");
const passwordPrompt = element<HTMLParagraphElement>("passwordPrompt");
const passwordInput = element<HTMLInputElement>("passwordInput");
const passwordSubmit = element<HTMLButtonElement>("passwordSubmit");

let state: ViewerState = { status: "loading", pagesCount: 0, page: 1, scale: 1, scaleValue: "auto" };

function report(patch: Partial<ViewerState>): void {
  state = { ...state, ...patch };
  vscode.postMessage({ type: "state", state });
}

function saved(): SavedState {
  const value = vscode.getState();
  return value && typeof value === "object" ? (value as SavedState) : {};
}

function save(patch: SavedState): void {
  vscode.setState({ ...saved(), ...patch });
}

/** Shows a message box. Text is set with textContent, so nothing in it can run as code. */
function showMessage(title: string, detail?: string): void {
  messageBox.replaceChildren();
  const heading = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = title;
  heading.append(strong);
  messageBox.append(heading);
  if (detail) {
    const body = document.createElement("p");
    body.textContent = detail;
    messageBox.append(body);
  }
  messageBox.classList.add("error");
  messageBox.hidden = false;
}

function hideMessages(): void {
  messageBox.hidden = true;
  passwordBox.hidden = true;
}

function describeLoadError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  switch (name) {
    case "InvalidPDFException":
      return /empty/i.test(message)
        ? "The file is empty (0 bytes)."
        : "This file isn't a valid PDF, or it's damaged. Try re-downloading or re-exporting it.";
    case "MissingPDFException":
      return "The PDF file is missing.";
    case "PasswordException":
      return "This PDF needs a password.";
    default:
      return message || "An unknown error happened while reading the PDF.";
  }
}

/** Sends a diagnostic line to the extension's "CodePDF" log (Output panel). */
function log(level: "info" | "warn" | "error", message: string): void {
  vscode.postMessage({ type: "log", level, message });
}

/**
 * Starts pdf.js's background worker. Webviews can't start workers from
 * extension files directly, so the worker's code is loaded and started from an
 * in-memory copy. The worker says "ready" when it's up; if that doesn't happen
 * (or it errors), pdf.js runs inside this page instead: slower, but it works.
 */
async function setUpWorker(pdfjsLib: typeof PdfJsLib): Promise<void> {
  let worker: Worker | undefined;
  try {
    const response = await fetch(config.worker);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} loading the worker code`);
    }
    const code = await response.text();
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    const started = new Worker(url, { type: "module" });
    worker = started;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the worker didn't answer within 4 seconds")), 4000);
      started.addEventListener(
        "message",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      started.addEventListener(
        "error",
        (event) => {
          clearTimeout(timer);
          reject(new Error(event.message || "the worker failed to start"));
        },
        { once: true },
      );
    });
    pdfjsLib.GlobalWorkerOptions.workerPort = started;
    log("info", "pdf.js worker started.");
  } catch (error) {
    worker?.terminate();
    pdfjsLib.GlobalWorkerOptions.workerSrc = config.worker;
    log("warn", `Background worker unavailable (${error instanceof Error ? error.message : String(error)}); running pdf.js in the page instead.`);
  }
}

/** The PDF's bytes as a Uint8Array, whatever shape the message delivered them in. */
function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data && typeof data === "object") {
    const inner = (data as { data?: unknown }).data;
    if (Array.isArray(inner)) {
      return Uint8Array.from(inner as number[]);
    }
    return Uint8Array.from(Object.values(data as Record<string, number>));
  }
  throw new Error("The PDF's contents didn't arrive in a readable form.");
}

async function main(): Promise<void> {
  const pdfjsLib = (await import(config.pdfjs)) as typeof PdfJsLib;
  (globalThis as unknown as { pdfjsLib: typeof PdfJsLib }).pdfjsLib = pdfjsLib;
  const viewerLib = (await import(config.viewer)) as typeof PdfViewerLib;
  await setUpWorker(pdfjsLib);

  const eventBus = new viewerLib.EventBus();
  const linkService = new viewerLib.PDFLinkService({ eventBus });
  const findController = new viewerLib.PDFFindController({ eventBus, linkService });
  const pdfViewer = new viewerLib.PDFViewer({
    container,
    viewer: element<HTMLDivElement>("viewer"),
    eventBus,
    linkService,
    findController,
    textLayerMode: 1,
    annotationMode: pdfjsLib.AnnotationMode.ENABLE,
  });
  linkService.setViewer(pdfViewer);

  let loadingTask: PdfJsLib.PDFDocumentLoadingTask | null = null;
  let pendingPage: number | undefined;
  let pendingScale: string | undefined;

  const updateNavButtons = (): void => {
    prevPage.disabled = pdfViewer.currentPageNumber <= 1;
    nextPage.disabled = pdfViewer.currentPageNumber >= pdfViewer.pagesCount;
  };

  const showScale = (scale: number, preset: string | undefined): void => {
    const value = preset ?? String(scale);
    const match = [...scaleSelect.options].find((o) => o.value === value && o !== customScale);
    if (match) {
      customScale.hidden = true;
      scaleSelect.value = match.value;
    } else {
      customScale.textContent = `${Math.round(scale * 100)}%`;
      customScale.hidden = false;
      scaleSelect.value = "custom";
    }
  };

  eventBus.on("pagesinit", () => {
    pdfViewer.currentScaleValue = pendingScale ?? "auto";
    if (pendingPage && pendingPage <= pdfViewer.pagesCount) {
      pdfViewer.currentPageNumber = pendingPage;
    }
    updateNavButtons();
    if (findInput.value) {
      runFind("");
    }
  });

  eventBus.on("pagechanging", (event: { pageNumber: number }) => {
    pageInput.value = String(event.pageNumber);
    updateNavButtons();
    save({ page: event.pageNumber });
    report({ page: event.pageNumber });
  });

  eventBus.on("scalechanging", (event: { scale: number; presetValue?: string }) => {
    showScale(event.scale, event.presetValue);
    const scaleValue = event.presetValue ?? String(event.scale);
    save({ scaleValue });
    report({ scale: event.scale, scaleValue });
  });

  const showMatches = (matches: { current: number; total: number } | undefined, notFound: boolean): void => {
    if (!findInput.value) {
      findResult.textContent = "";
    } else if (notFound || !matches || matches.total === 0) {
      findResult.textContent = "No matches";
    } else {
      findResult.textContent = `${matches.current} of ${matches.total}`;
    }
    if (matches) {
      report({ findMatches: { current: matches.current, total: matches.total } });
    }
  };
  eventBus.on("updatefindmatchescount", (event: { matchesCount: { current: number; total: number } }) => {
    showMatches(event.matchesCount, false);
  });
  eventBus.on("updatefindcontrolstate", (event: { state: number; matchesCount: { current: number; total: number } }) => {
    showMatches(event.matchesCount, event.state === 1 /* FindState.NOT_FOUND */);
  });

  function runFind(type: "" | "again", previous = false): void {
    const query = findInput.value;
    if (!query) {
      eventBus.dispatch("findbarclose", { source: null });
      showMatches(undefined, false);
      return;
    }
    eventBus.dispatch("find", {
      source: null,
      type,
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    });
  }

  const goToPage = (page: number): void => {
    if (!pdfViewer.pagesCount) {
      return;
    }
    const target = Math.min(pdfViewer.pagesCount, Math.max(1, Math.round(page)));
    pdfViewer.currentPageNumber = target;
    pageInput.value = String(target);
  };

  const setScale = (value: string): void => {
    if (value !== "custom" && pdfViewer.pagesCount) {
      pdfViewer.currentScaleValue = value;
    }
  };

  async function load(data: unknown, reload: boolean): Promise<void> {
    hideMessages();
    const remembered = saved();
    pendingPage = reload && pdfViewer.pagesCount ? pdfViewer.currentPageNumber : remembered.page;
    pendingScale = reload && pdfViewer.pagesCount ? pdfViewer.currentScaleValue : remembered.scaleValue;
    if (loadingTask) {
      await loadingTask.destroy();
    }
    report({ status: "loading" });

    const fail = (error: unknown): void => {
      const detail = describeLoadError(error);
      pdfViewer.setDocument(null as unknown as PdfJsLib.PDFDocumentProxy);
      pageCount.textContent = "/ 0";
      showMessage("CodePDF can't open this PDF.", detail);
      report({ status: "error", pagesCount: 0, error: detail });
      log("error", `Couldn't open the PDF: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    };

    let task: PdfJsLib.PDFDocumentLoadingTask;
    try {
      const params: Record<string, unknown> = {
        data: toBytes(data),
        cMapUrl: config.cmaps,
        cMapPacked: true,
        standardFontDataUrl: config.standardFonts,
        wasmUrl: config.wasm,
        iccUrl: config.iccs,
        useWasm: false,
        isEvalSupported: false,
        enableXfa: false,
        verbosity: 0,
      };
      task = pdfjsLib.getDocument(params as Parameters<typeof pdfjsLib.getDocument>[0]);
    } catch (error) {
      fail(error);
      return;
    }
    loadingTask = task;
    task.onPassword = (supply: (password: string) => void, reason: number) => {
      const wrong = reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD;
      passwordPrompt.textContent = wrong
        ? "That password didn't work. Try again."
        : "This PDF is protected. Enter its password to open it.";
      passwordBox.hidden = false;
      passwordInput.value = "";
      passwordInput.focus();
      report({ status: "password" });
      const submit = (): void => {
        passwordBox.hidden = true;
        passwordSubmit.removeEventListener("click", submit);
        passwordInput.removeEventListener("keydown", onKey);
        supply(passwordInput.value);
      };
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === "Enter") {
          submit();
        }
      };
      passwordSubmit.addEventListener("click", submit);
      passwordInput.addEventListener("keydown", onKey);
    };

    try {
      const pdf = await task.promise;
      if (task !== loadingTask) {
        return;
      }
      pdfViewer.setDocument(pdf);
      linkService.setDocument(pdf, null);
      pageCount.textContent = `/ ${pdf.numPages}`;
      pageInput.max = String(pdf.numPages);
      report({ status: "loaded", pagesCount: pdf.numPages, error: undefined });
    } catch (error) {
      if (task !== loadingTask) {
        return;
      }
      fail(error);
    }
  }

  // Toolbar
  prevPage.addEventListener("click", () => goToPage(pdfViewer.currentPageNumber - 1));
  nextPage.addEventListener("click", () => goToPage(pdfViewer.currentPageNumber + 1));
  pageInput.addEventListener("change", () => goToPage(Number(pageInput.value)));
  zoomIn.addEventListener("click", () => pdfViewer.increaseScale());
  zoomOut.addEventListener("click", () => pdfViewer.decreaseScale());
  scaleSelect.addEventListener("change", () => setScale(scaleSelect.value));

  let findTimer: ReturnType<typeof setTimeout> | undefined;
  findInput.addEventListener("input", () => {
    clearTimeout(findTimer);
    findTimer = setTimeout(() => runFind(""), 200);
  });
  findInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runFind("again", event.shiftKey);
    } else if (event.key === "Escape") {
      findInput.value = "";
      runFind("");
      container.focus();
    }
  });
  findPrev.addEventListener("click", () => runFind("again", true));
  findNext.addEventListener("click", () => runFind("again", false));

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      findInput.focus();
      findInput.select();
    }
  });

  // Ctrl + mouse wheel (or a trackpad pinch) zooms.
  container.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        if (event.deltaY < 0) {
          pdfViewer.increaseScale();
        } else {
          pdfViewer.decreaseScale();
        }
      }
    },
    { passive: false },
  );

  // Keep "Automatic", "Fit Width" and "Fit Page" correct when the tab is resized.
  new ResizeObserver(() => {
    if (pdfViewer.pagesCount && PRESET_SCALES.has(pdfViewer.currentScaleValue)) {
      pdfViewer.currentScaleValue = pdfViewer.currentScaleValue;
    }
  }).observe(container);

  // Links inside the PDF: page links are handled by pdf.js; anything else goes
  // to the extension, which asks before opening it.
  container.addEventListener(
    "click",
    (event) => {
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor) {
        return;
      }
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      vscode.postMessage({ type: "openLink", url: anchor.href });
    },
    true,
  );

  window.addEventListener("message", (event: MessageEvent<ToViewer>) => {
    const message = event.data;
    switch (message.type) {
      case "load":
        void load(message.data, message.reload);
        break;
      case "error":
        showMessage("CodePDF can't open this PDF.", message.message);
        report({ status: "error", error: message.message });
        break;
      case "action":
        switch (message.action) {
          case "zoomIn":
            pdfViewer.increaseScale();
            break;
          case "zoomOut":
            pdfViewer.decreaseScale();
            break;
          case "setScale":
            setScale(message.value);
            break;
          case "goToPage":
            goToPage(message.page);
            break;
          case "find":
            findInput.value = message.query;
            runFind(message.previous === undefined ? "" : "again", message.previous ?? false);
            break;
        }
        break;
    }
  });

  vscode.postMessage({ type: "ready" });
}

// Report anything that goes wrong in the page to the extension's log.
window.addEventListener("error", (event) => {
  log("error", `Script error: ${event.message} (${event.filename?.split("/").pop() ?? "?"}:${event.lineno})`);
});
window.addEventListener("unhandledrejection", (event) => {
  const reason: unknown = event.reason;
  log("error", `Unhandled error: ${reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)}`);
});
document.addEventListener("securitypolicyviolation", (event) => {
  log("warn", `Blocked by the security policy: ${event.violatedDirective} for ${event.blockedURI || "inline content"}`);
});

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  showMessage("The PDF viewer couldn't start.", detail);
  report({ status: "error", error: detail });
});
