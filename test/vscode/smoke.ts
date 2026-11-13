// A short check of the packaged extension (the installed .vsix, not the
// development copy): it must load, open a PDF and export a file.
// Launched by `node scripts/test-vscode.mjs --packaged`.

import * as vscode from "vscode";
import type { CodePdfApi } from "../../src/extension";

export async function run(): Promise<void> {
  const project = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!project) {
    throw new Error("The test project folder isn't open.");
  }
  const results: { name: string; ok: boolean; detail: string }[] = [];
  const step = async (name: string, body: () => Promise<string>): Promise<void> => {
    try {
      const detail = await body();
      results.push({ name, ok: true, detail });
      console.log(`PASS  ${name} (${detail})`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      results.push({ name, ok: false, detail });
      console.log(`FAIL  ${name}: ${detail}`);
    }
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(project, "..", "results.json"),
      new TextEncoder().encode(JSON.stringify(results, null, 2)),
    );
  };

  const extension = vscode.extensions.getExtension<CodePdfApi>("toarjungarg.codepdf");
  let api: CodePdfApi | undefined;

  await step("packaged: the installed extension loads", async () => {
    if (!extension) {
      throw new Error("CodePDF isn't installed in the test profile.");
    }
    if (!extension.extensionPath.includes("extensions-packaged")) {
      throw new Error(`Loaded from the wrong place: ${extension.extensionPath}`);
    }
    api = await extension.activate();
    return `version ${String(extension.packageJSON.version)}`;
  });

  await step("packaged: opens a PDF in the viewer", async () => {
    if (!api) {
      throw new Error("The extension didn't load.");
    }
    const pdf = vscode.Uri.joinPath(project, "pdfs", "combined.pdf");
    await vscode.commands.executeCommand("vscode.openWith", pdf, "codepdf.pdfViewer");
    const state = await api.viewer.waitForState(pdf, (s) => s.status !== "loading", 20000);
    if (state.status !== "loaded" || state.pagesCount !== 3) {
      throw new Error(`status ${state.status}, ${state.pagesCount} pages, ${state.error ?? ""}`);
    }
    return `${state.pagesCount} pages`;
  });

  await step("packaged: exports a C++ file and opens the result", async () => {
    if (!api) {
      throw new Error("The extension didn't load.");
    }
    await vscode.commands.executeCommand("codepdf.exportFile", vscode.Uri.joinPath(project, "unicode.cpp"));
    const out = vscode.Uri.joinPath(project, "unicode.pdf");
    await vscode.workspace.fs.stat(out);
    await vscode.commands.executeCommand("vscode.openWith", out, "codepdf.pdfViewer");
    const state = await api.viewer.waitForState(out, (s) => s.status !== "loading", 20000);
    if (state.status !== "loaded") {
      throw new Error(`exported PDF didn't open: ${state.error ?? state.status}`);
    }
    await api.viewer.sendAction(out, { action: "find", query: "中文注释" });
    await api.viewer.waitForState(out, (s) => (s.findMatches?.total ?? 0) > 0);
    return "unicode.pdf written, opened, Chinese text found";
  });

  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`${failed} packaged check(s) failed`);
  }
}
