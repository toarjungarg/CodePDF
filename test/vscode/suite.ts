// Integration tests that run inside a real VS Code window, launched by
// scripts/test-vscode.mjs. They drive CodePDF's commands and viewer the way a
// person would, answering its dialogs automatically.

import * as vscode from "vscode";
import { dialogs } from "../../src/vscode/dialogs";
import type { CodePdfApi } from "../../src/extension";
import type { ViewerState } from "../../src/viewer/pdfEditorProvider";

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}

const results: Result[] = [];

function check(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function run(): Promise<void> {
  const project = vscode.workspace.workspaceFolders?.[0]?.uri;
  check(project, "The test project folder isn't open.");
  const file = (...parts: string[]): vscode.Uri => vscode.Uri.joinPath(project, ...parts);
  const resultsFile = vscode.Uri.joinPath(project, "..", "results.json");

  const extension = vscode.extensions.getExtension<CodePdfApi>("toarjungarg.codepdf");
  check(extension, "CodePDF isn't loaded in the test window.");
  const api = await extension.activate();
  const viewer = api.viewer;

  // --- Automatic answers for CodePDF's dialogs -------------------------------
  const answers = {
    confirm: [] as (string | undefined)[],
    save: [] as (vscode.Uri | undefined)[],
    pickedLabels: [] as string[][],
  };
  dialogs.confirm = async () => answers.confirm.shift();
  dialogs.chooseSaveLocation = async () => answers.save.shift();
  dialogs.chooseFiles = async () => undefined;
  dialogs.notify = async () => undefined;
  dialogs.pickMany = (async (items: vscode.QuickPickItem[]) => {
    answers.pickedLabels.push(items.map((i) => i.label));
    return items;
  }) as typeof dialogs.pickMany;

  // --- Helpers ---------------------------------------------------------------
  const exists = async (uri: vscode.Uri): Promise<boolean> => {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  };
  const bytesOf = async (uri: vscode.Uri): Promise<Uint8Array> => vscode.workspace.fs.readFile(uri);
  const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

  const openPdf = async (uri: vscode.Uri, until: (s: ViewerState) => boolean = (s) => s.status !== "loading"): Promise<ViewerState> => {
    await vscode.commands.executeCommand("vscode.openWith", uri, "codepdf.pdfViewer");
    return viewer.waitForState(uri, until, 15000);
  };
  const closeAll = async (): Promise<void> => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await sleep(300);
  };

  const sourceNames = ["main.cpp", "util.h", "comments_strings.cpp", "unicode.cpp", "long_lines.cpp", "src/extra.cpp"];
  const sourcesBefore = new Map<string, Uint8Array>();
  for (const name of sourceNames) {
    sourcesBefore.set(name, await bytesOf(file(...name.split("/"))));
  }

  const test = async (name: string, body: () => Promise<string | void>): Promise<void> => {
    try {
      const detail = (await body()) ?? "";
      results.push({ name, ok: true, detail });
      console.log(`PASS  ${name}${detail ? ` (${detail})` : ""}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      results.push({ name, ok: false, detail });
      console.log(`FAIL  ${name}: ${detail}`);
    }
  };

  // --- Viewer ------------------------------------------------------------------
  const combined = file("pdfs", "combined.pdf");

  await test("viewer: opens a valid PDF", async () => {
    const state = await openPdf(combined);
    check(state.status === "loaded", `status ${state.status}: ${state.error ?? ""}`);
    check(state.pagesCount === 3, `expected 3 pages, got ${state.pagesCount}`);
    return `${state.pagesCount} pages`;
  });

  await test("viewer: navigates between pages", async () => {
    await viewer.sendAction(combined, { action: "goToPage", page: 3 });
    await viewer.waitForState(combined, (s) => s.page === 3);
    await viewer.sendAction(combined, { action: "goToPage", page: 99 });
    await sleep(300);
    check(viewer.states.get(combined.toString())?.page === 3, "page 99 should stop at the last page (3)");
    await viewer.sendAction(combined, { action: "goToPage", page: 1 });
    await viewer.waitForState(combined, (s) => s.page === 1);
    return "page 3, clamp at 3, back to 1";
  });

  await test("viewer: zooms in and out, fit width and fit page", async () => {
    await viewer.sendAction(combined, { action: "setScale", value: "1" });
    await viewer.waitForState(combined, (s) => Math.abs(s.scale - 1) < 0.001);
    await viewer.sendAction(combined, { action: "zoomIn" });
    const zoomedIn = await viewer.waitForState(combined, (s) => s.scale > 1.01);
    await viewer.sendAction(combined, { action: "zoomOut" });
    await viewer.sendAction(combined, { action: "zoomOut" });
    const zoomedOut = await viewer.waitForState(combined, (s) => s.scale < 0.99);
    await viewer.sendAction(combined, { action: "setScale", value: "page-width" });
    await viewer.waitForState(combined, (s) => s.scaleValue === "page-width");
    await viewer.sendAction(combined, { action: "setScale", value: "page-fit" });
    const fit = await viewer.waitForState(combined, (s) => s.scaleValue === "page-fit");
    return `100% -> ${Math.round(zoomedIn.scale * 100)}% -> ${Math.round(zoomedOut.scale * 100)}%, fit page ${Math.round(fit.scale * 100)}%`;
  });

  await test("viewer: searches text in the PDF", async () => {
    await viewer.sendAction(combined, { action: "find", query: "include" });
    const found = await viewer.waitForState(combined, (s) => (s.findMatches?.total ?? 0) > 0);
    await viewer.sendAction(combined, { action: "find", query: "zzqqxx_not_here" });
    await viewer.waitForState(combined, (s) => s.findMatches?.total === 0);
    return `"include": ${found.findMatches?.total} matches; nonsense word: 0`;
  });

  await test("viewer: two PDFs open at the same time", async () => {
    const longFile = file("pdfs", "long_file.pdf");
    const state = await openPdf(longFile);
    check(state.status === "loaded" && state.pagesCount > 50, `long file: ${state.status}, ${state.pagesCount} pages`);
    check(viewer.states.get(combined.toString())?.status === "loaded", "the first PDF should still be open");
    return `${state.pagesCount} pages + 3 pages`;
  });

  await test("viewer: A4 landscape page size", async () => {
    const state = await openPdf(file("pdfs", "settings.pdf"));
    check(state.status === "loaded", `status ${state.status}`);
    return `${state.pagesCount} page(s)`;
  });

  await test("viewer: a file that isn't a PDF shows a clear error", async () => {
    const state = await openPdf(file("pdfs", "notapdf.pdf"));
    check(state.status === "error", `status ${state.status}`);
    check(/valid PDF/.test(state.error ?? ""), `message: ${state.error}`);
    return state.error;
  });

  await test("viewer: an empty file shows a clear error", async () => {
    const state = await openPdf(file("pdfs", "empty.pdf"));
    check(state.status === "error", `status ${state.status}`);
    return state.error;
  });

  await test("viewer: a cut-off (corrupted) PDF doesn't hang or crash", async () => {
    const state = await openPdf(file("pdfs", "truncated.pdf"));
    check(state.status === "loaded" || state.status === "error", `status ${state.status}`);
    return state.status === "loaded" ? `recovered ${state.pagesCount} page(s)` : `error: ${state.error}`;
  });

  await test("viewer: a password-protected PDF asks for the password", async () => {
    const state = await openPdf(file("pdfs", "protected.pdf"), (s) => s.status !== "loading");
    check(state.status === "password", `status ${state.status}`);
  });

  await test("viewer: reloads when the PDF changes on disk", async () => {
    const target = file("pdfs", "reload.pdf");
    await vscode.workspace.fs.copy(file("pdfs", "basic.pdf"), target, { overwrite: true });
    const before = await openPdf(target);
    check(before.pagesCount === 1, `expected 1 page first, got ${before.pagesCount}`);
    await vscode.workspace.fs.writeFile(target, await bytesOf(combined));
    const after = await viewer.waitForState(target, (s) => s.status === "loaded" && s.pagesCount === 3, 15000);
    return `1 page -> ${after.pagesCount} pages`;
  });

  await closeAll();

  // --- Export ------------------------------------------------------------------
  await test("export: Export as PDF writes main.pdf next to main.cpp", async () => {
    await vscode.commands.executeCommand("codepdf.exportFile", file("main.cpp"));
    check(await exists(file("main.pdf")), "main.pdf wasn't created");
    const state = await openPdf(file("main.pdf"));
    check(state.status === "loaded", `exported PDF didn't open: ${state.error}`);
    return `${state.pagesCount} page(s)`;
  });

  await test("export: an existing PDF is only replaced after confirming", async () => {
    const before = await bytesOf(file("main.pdf"));
    await sleep(1100); // the PDF stores its creation time in seconds
    answers.confirm.push(undefined); // Cancel
    await vscode.commands.executeCommand("codepdf.exportFile", file("main.cpp"));
    check(sameBytes(before, await bytesOf(file("main.pdf"))), "Cancel should leave the old PDF untouched");
    answers.confirm.push("Replace");
    await vscode.commands.executeCommand("codepdf.exportFile", file("main.cpp"));
    check(!sameBytes(before, await bytesOf(file("main.pdf"))), "Replace should write a new PDF");
    return "Cancel kept it, Replace overwrote it";
  });

  await test("export: comments/strings, Unicode and long-line files", async () => {
    for (const name of ["comments_strings", "unicode", "long_lines"]) {
      await vscode.commands.executeCommand("codepdf.exportFile", file(`${name}.cpp`));
      const state = await openPdf(file(`${name}.pdf`));
      check(state.status === "loaded", `${name}.pdf didn't open`);
    }
    const unicode = file("unicode.pdf");
    await viewer.sendAction(unicode, { action: "find", query: "中文注释" });
    await viewer.waitForState(unicode, (s) => (s.findMatches?.total ?? 0) > 0);
    const longLines = file("long_lines.pdf");
    await viewer.sendAction(longLines, { action: "find", query: "MARKER_STRING_END" });
    await viewer.waitForState(longLines, (s) => (s.findMatches?.total ?? 0) > 0);
    return "all three open; Chinese text and the end of the long line are searchable";
  });

  await closeAll();

  await test("export: Export Selection as PDF exports only the highlighted lines", async () => {
    const doc = await vscode.workspace.openTextDocument(file("main.cpp"));
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(3, 2, 5, 4); // lines 4 to 6
    await vscode.commands.executeCommand("codepdf.exportSelection");
    const out = file("main-lines-4-6.pdf");
    check(await exists(out), "main-lines-4-6.pdf wasn't created");
    await openPdf(out);
    await viewer.sendAction(out, { action: "find", query: "sumOf" });
    await viewer.waitForState(out, (s) => (s.findMatches?.total ?? 0) > 0);
    await viewer.sendAction(out, { action: "find", query: "std::cout" });
    await viewer.waitForState(out, (s) => s.findMatches?.total === 0);
    return "has sumOf, doesn't have main's std::cout";
  });

  await closeAll();

  await test("export: Export Multiple Files combines them, headers first", async () => {
    const out = file("combined-out.pdf");
    answers.save.push(out);
    await vscode.commands.executeCommand("codepdf.exportMultiple", undefined, [file("main.cpp"), file("util.h"), file("unicode.cpp")]);
    const labels = answers.pickedLabels.pop() ?? [];
    check(labels[0] === "util.h", `headers should come first, got ${labels.join(", ")}`);
    const state = await openPdf(out);
    check(state.status === "loaded" && state.pagesCount === 3, `expected 3 pages, got ${state.pagesCount}`);
    return `order: ${labels.join(", ")}`;
  });

  await test("export: Export Folder skips hidden, dependency and build folders", async () => {
    const out = file("folder-out.pdf");
    answers.save.push(out);
    await vscode.commands.executeCommand("codepdf.exportFolder", project);
    const labels = answers.pickedLabels.pop() ?? [];
    for (const excluded of ["build/generated.cpp", "node_modules/dep/dep.cpp", ".hidden.cpp"]) {
      check(!labels.includes(excluded), `${excluded} should have been skipped`);
    }
    for (const included of ["main.cpp", "util.h", "src/extra.cpp"]) {
      check(labels.includes(included), `${included} should be included`);
    }
    const state = await openPdf(out);
    check(state.pagesCount >= labels.length, `${labels.length} files but ${state.pagesCount} pages`);
    return `${labels.length} files listed: ${labels.join(", ")}`;
  });

  await closeAll();

  await test("export: unsaved changes in the editor are included", async () => {
    const doc = await vscode.workspace.openTextDocument(file("main.cpp"));
    const editor = await vscode.window.showTextDocument(doc);
    await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), "// UNSAVED_MARKER\n"));
    answers.confirm.push("Replace");
    await vscode.commands.executeCommand("codepdf.exportFile", file("main.cpp"));
    await vscode.commands.executeCommand("workbench.action.files.revert");
    const out = file("main.pdf");
    await openPdf(out);
    await viewer.sendAction(out, { action: "find", query: "UNSAVED_MARKER" });
    await viewer.waitForState(out, (s) => (s.findMatches?.total ?? 0) > 0);
  });

  await test("export: a non-C++ file is refused", async () => {
    await vscode.commands.executeCommand("codepdf.exportFile", file("notes.txt"));
    check(!(await exists(file("notes.pdf"))), "notes.pdf should not exist");
  });

  await test("export: source files were never modified", async () => {
    for (const [name, before] of sourcesBefore) {
      check(sameBytes(before, await bytesOf(file(...name.split("/")))), `${name} changed`);
    }
    return `${sourcesBefore.size} files unchanged`;
  });

  await closeAll();
  await vscode.workspace.fs.writeFile(resultsFile, new TextEncoder().encode(JSON.stringify(results, null, 2)));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`${failed} VS Code test(s) failed`);
  }
}
