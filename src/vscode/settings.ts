// Reads CodePDF's settings (plus the editor's tab size and font) from VS Code.

import * as vscode from "vscode";
import { normalizeOptions, type ExportOptions } from "../export/options";

export interface ExportSettings {
  options: ExportOptions;
  /** The editor's font list, so the PDF uses the same font as the code on screen. */
  editorFontFamily: string | undefined;
}

/** Reads settings for a file (folder-level settings can differ from user settings). */
export function readExportSettings(resource?: vscode.Uri): ExportSettings {
  const config = vscode.workspace.getConfiguration("codepdf", resource);
  const editor = vscode.workspace.getConfiguration("editor", resource ? { uri: resource, languageId: "cpp" } : undefined);
  const options = normalizeOptions({
    paperSize: config.get("paperSize"),
    orientation: config.get("orientation"),
    fontSize: config.get("fontSize"),
    marginInches: config.get("margins"),
    lineNumbers: config.get("lineNumbers"),
    syntaxHighlighting: config.get("syntaxHighlighting"),
    header: config.get("header"),
    footer: config.get("footer"),
    pageNumbers: config.get("pageNumbers"),
    lineWrapping: config.get("lineWrapping"),
    tabSize: editor.get("tabSize"),
  });
  return { options, editorFontFamily: editor.get<string>("fontFamily") };
}
