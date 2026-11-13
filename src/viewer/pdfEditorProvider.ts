// The PDF viewer's extension side: VS Code asks it to show .pdf files, and it
// hands the file's bytes to a locked-down webview where pdf.js draws them.

import * as vscode from "vscode";
import { randomBytes } from "node:crypto";

/** PDFs larger than this aren't opened, so a huge file can't freeze VS Code. */
const MAX_PDF_BYTES = 300 * 1024 * 1024;
const ALLOWED_LINK_SCHEMES = new Set(["http", "https", "mailto"]);

/** What the viewer reports about itself (shown nowhere; used by tests and future features). */
export interface ViewerState {
  status: "loading" | "loaded" | "error" | "password";
  pagesCount: number;
  page: number;
  scale: number;
  scaleValue: string;
  error?: string;
  findMatches?: { current: number; total: number };
}

export type ViewerAction =
  | { action: "zoomIn" }
  | { action: "zoomOut" }
  | { action: "setScale"; value: string }
  | { action: "goToPage"; page: number }
  | { action: "find"; query: string; previous?: boolean };

type FromWebview =
  | { type: "ready" }
  | { type: "state"; state: ViewerState }
  | { type: "openLink"; url: string }
  | { type: "log"; level: "info" | "warn" | "error"; message: string };

class PdfDocument implements vscode.CustomDocument {
  constructor(readonly uri: vscode.Uri) {}
  dispose(): void {
    // Nothing to release: the bytes live only inside each webview.
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export class PdfEditorProvider implements vscode.CustomReadonlyEditorProvider<PdfDocument> {
  static readonly viewType = "codepdf.pdfViewer";

  /** Latest state per open viewer, keyed by file URI. */
  readonly states = new Map<string, ViewerState>();
  private readonly panels = new Map<string, Set<vscode.WebviewPanel>>();
  private readonly stateListeners = new Set<() => void>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  static register(context: vscode.ExtensionContext): PdfEditorProvider {
    const log = vscode.window.createOutputChannel("CodePDF", { log: true });
    const provider = new PdfEditorProvider(context.extensionUri, log);
    context.subscriptions.push(
      log,
      vscode.window.registerCustomEditorProvider(PdfEditorProvider.viewType, provider, {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: false },
      }),
    );
    return provider;
  }

  openCustomDocument(uri: vscode.Uri): PdfDocument {
    return new PdfDocument(uri);
  }

  async resolveCustomEditor(document: PdfDocument, panel: vscode.WebviewPanel): Promise<void> {
    const key = document.uri.toString();
    const webview = panel.webview;
    webview.options = {
      enableScripts: true,
      enableForms: false,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "media"),
        vscode.Uri.joinPath(this.extensionUri, "out", "webview"),
      ],
    };
    webview.html = this.buildHtml(webview);

    const set = this.panels.get(key) ?? new Set<vscode.WebviewPanel>();
    set.add(panel);
    this.panels.set(key, set);

    const sendFile = async (reload: boolean): Promise<void> => {
      try {
        const stat = await vscode.workspace.fs.stat(document.uri);
        if (stat.size > MAX_PDF_BYTES) {
          throw new Error("This PDF is larger than 300 MB, which is too big to open here.");
        }
        const data = await vscode.workspace.fs.readFile(document.uri);
        await webview.postMessage({ type: "load", data, reload });
      } catch (error) {
        const message =
          error instanceof vscode.FileSystemError && error.code === "FileNotFound"
            ? "This PDF can't be found. It may have been moved or deleted."
            : error instanceof vscode.FileSystemError && error.code === "NoPermissions"
              ? "CodePDF doesn't have permission to read this PDF."
              : error instanceof Error
                ? error.message
                : String(error);
        await webview.postMessage({ type: "error", message });
      }
    };

    // Reload when the file changes on disk (for example after re-exporting it).
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleReload = (): void => {
      if (reloadTimer !== undefined) {
        clearTimeout(reloadTimer);
      }
      reloadTimer = setTimeout(() => void sendFile(true), 300);
    };
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.joinPath(document.uri, ".."), document.uri.path.split("/").pop() ?? ""),
    );

    const disposables: vscode.Disposable[] = [
      watcher,
      watcher.onDidChange(scheduleReload),
      watcher.onDidCreate(scheduleReload),
      watcher.onDidDelete(() => void webview.postMessage({ type: "error", message: "This PDF was deleted." })),
      webview.onDidReceiveMessage((message: FromWebview) => {
        switch (message.type) {
          case "ready":
            void sendFile(false);
            break;
          case "state":
            this.states.set(key, message.state);
            this.stateListeners.forEach((listener) => listener());
            break;
          case "openLink":
            void this.openLink(message.url);
            break;
          case "log": {
            const line = `[viewer] ${String(message.message).slice(0, 2000)}`;
            if (message.level === "error") {
              this.log.error(line);
            } else if (message.level === "warn") {
              this.log.warn(line);
            } else {
              this.log.info(line);
            }
            break;
          }
        }
      }),
    ];

    panel.onDidDispose(() => {
      if (reloadTimer !== undefined) {
        clearTimeout(reloadTimer);
      }
      disposables.forEach((d) => d.dispose());
      set.delete(panel);
      if (set.size === 0) {
        this.panels.delete(key);
        this.states.delete(key);
      }
    });
  }

  /** Sends a toolbar action to every viewer showing this file (used by tests). */
  async sendAction(uri: vscode.Uri, action: ViewerAction): Promise<void> {
    for (const panel of this.panels.get(uri.toString()) ?? []) {
      await panel.webview.postMessage({ type: "action", ...action });
    }
  }

  /** Resolves once the viewer for `uri` reports a state that passes `check`. */
  waitForState(uri: vscode.Uri, check: (state: ViewerState) => boolean, timeoutMs = 10000): Promise<ViewerState> {
    return new Promise((resolve, reject) => {
      const key = uri.toString();
      const test = (): boolean => {
        const state = this.states.get(key);
        if (state && check(state)) {
          cleanup();
          resolve(state);
          return true;
        }
        return false;
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Viewer state timed out; last state: ${JSON.stringify(this.states.get(key))}`));
      }, timeoutMs);
      const listener = (): void => void test();
      const cleanup = (): void => {
        clearTimeout(timer);
        this.stateListeners.delete(listener);
      };
      this.stateListeners.add(listener);
      test();
    });
  }

  private async openLink(url: string): Promise<void> {
    let parsed: vscode.Uri;
    try {
      parsed = vscode.Uri.parse(url, true);
    } catch {
      return;
    }
    if (!ALLOWED_LINK_SCHEMES.has(parsed.scheme)) {
      void vscode.window.showWarningMessage(`CodePDF only opens web and email links. This link was blocked: ${url}`);
      return;
    }
    const choice = await vscode.window.showInformationMessage(
      "This PDF wants to open a link.",
      { modal: true, detail: url },
      "Open Link",
    );
    if (choice === "Open Link") {
      await vscode.env.openExternal(parsed);
    }
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = randomBytes(18).toString("base64");
    const media = (...parts: string[]): string => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", ...parts)).toString();
    const pdfjs = (...parts: string[]): string => media("pdfjs", ...parts);
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "out", "webview", "viewer.js")).toString();
    const source = webview.cspSource;
    const csp = [
      "default-src 'none'",
      `img-src ${source} data: blob:`,
      `style-src ${source}`,
      `font-src ${source} data: blob:`,
      `script-src 'nonce-${nonce}' ${source}`,
      "worker-src blob:",
      `connect-src ${source}`,
    ].join("; ");

    const config: Record<string, string> = {
      pdfjs: pdfjs("build", "pdf.min.mjs"),
      worker: pdfjs("build", "pdf.worker.min.mjs"),
      viewer: pdfjs("web", "pdf_viewer.mjs"),
      cmaps: pdfjs("cmaps") + "/",
      standardFonts: pdfjs("standard_fonts") + "/",
      wasm: pdfjs("wasm") + "/",
      iccs: pdfjs("iccs") + "/",
    };
    const dataAttributes = Object.entries(config)
      .map(([name, value]) => `data-${name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}="${escapeAttribute(value)}"`)
      .join(" ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${escapeAttribute(pdfjs("web", "pdf_viewer.css"))}">
  <link rel="stylesheet" href="${escapeAttribute(media("viewer.css"))}">
  <title>CodePDF Viewer</title>
</head>
<body ${dataAttributes}>
  <div class="toolbar" role="toolbar" aria-label="PDF controls">
    <div class="group">
      <button id="prevPage" class="icon" title="Previous page" aria-label="Previous page">&#x2039;</button>
      <input id="pageNumber" type="number" min="1" value="1" aria-label="Page number" title="Go to page">
      <span id="pageCount" class="muted">/ 0</span>
      <button id="nextPage" class="icon" title="Next page" aria-label="Next page">&#x203A;</button>
    </div>
    <div class="group">
      <button id="zoomOut" class="icon" title="Zoom out" aria-label="Zoom out">&#x2212;</button>
      <select id="scaleSelect" title="Zoom" aria-label="Zoom">
        <option value="auto">Automatic</option>
        <option value="page-width">Fit Width</option>
        <option value="page-fit">Fit Page</option>
        <option value="0.5">50%</option>
        <option value="0.75">75%</option>
        <option value="1">100%</option>
        <option value="1.25">125%</option>
        <option value="1.5">150%</option>
        <option value="2">200%</option>
        <option value="3">300%</option>
        <option value="4">400%</option>
        <option id="customScale" value="custom" hidden disabled></option>
      </select>
      <button id="zoomIn" class="icon" title="Zoom in" aria-label="Zoom in">+</button>
    </div>
    <div class="group search">
      <input id="findInput" type="search" placeholder="Find in PDF" aria-label="Find in PDF" title="Find in PDF (Enter: next, Shift+Enter: previous)">
      <button id="findPrev" class="icon" title="Previous match" aria-label="Previous match">&#x2191;</button>
      <button id="findNext" class="icon" title="Next match" aria-label="Next match">&#x2193;</button>
      <span id="findResult" class="muted" aria-live="polite"></span>
    </div>
  </div>
  <div id="viewerContainer" tabindex="0">
    <div id="viewer" class="pdfViewer"></div>
  </div>
  <div id="message" class="message" hidden role="alert"></div>
  <div id="passwordBox" class="message" hidden>
    <p id="passwordPrompt">This PDF is protected. Enter its password to open it.</p>
    <input id="passwordInput" type="password" aria-label="PDF password" autocomplete="off">
    <button id="passwordSubmit" type="button">Open</button>
  </div>
  <script type="module" nonce="${nonce}" src="${escapeAttribute(script)}"></script>
</body>
</html>`;
  }
}
