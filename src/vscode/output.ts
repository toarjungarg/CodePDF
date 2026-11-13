// Shared pieces for the export commands: reading sources, asking before
// overwriting, writing the PDF, progress, and friendly messages.

import * as vscode from "vscode";
import { ExportCancelledError } from "../export/renderer";
import { dialogs } from "./dialogs";

/** Source files bigger than this are refused (they're almost certainly not hand-written code). */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

export interface SourceText {
  text: string;
  /** True when the text came from an editor with unsaved changes. */
  unsaved: boolean;
  /** The editor's tab size for this file, when it's open. */
  tabSize?: number;
}

function openDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
}

function editorTabSize(doc: vscode.TextDocument): number | undefined {
  const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
  const size = editor?.options.tabSize;
  return typeof size === "number" ? size : undefined;
}

/**
 * Reads a source file. If it's open in an editor, the text on screen is used
 * (including unsaved changes); otherwise the saved file is read. The source
 * file itself is never changed.
 */
export async function readSource(uri: vscode.Uri): Promise<SourceText> {
  const doc = openDocument(uri);
  if (doc) {
    const result: SourceText = { text: doc.getText(), unsaved: doc.isDirty };
    const tabSize = editorTabSize(doc);
    if (tabSize !== undefined) {
      result.tabSize = tabSize;
    }
    return result;
  }
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.size > MAX_SOURCE_BYTES) {
    throw new Error(`${baseName(uri)} is larger than 10 MB, which is too big to export.`);
  }
  const bytes = await vscode.workspace.fs.readFile(uri);
  return { text: new TextDecoder("utf-8").decode(bytes), unsaved: false };
}

export function baseName(uri: vscode.Uri): string {
  const path = uri.path;
  return path.slice(path.lastIndexOf("/") + 1);
}

export function parentFolder(uri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(uri, "..");
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Asks before replacing an existing file. Returns true when it's OK to write. */
export async function confirmOverwrite(target: vscode.Uri): Promise<boolean> {
  if (!(await exists(target))) {
    return true;
  }
  const choice = await dialogs.confirm(
    `"${baseName(target)}" already exists in this folder. Do you want to replace it?`,
    "The existing PDF will be overwritten. Your source files are never changed.",
    "Replace",
  );
  return choice === "Replace";
}

export async function writePdf(target: vscode.Uri, bytes: Uint8Array): Promise<void> {
  await vscode.workspace.fs.writeFile(target, bytes);
}

/** Lets the user pick where to save a combined PDF (the save dialog asks before replacing). */
export async function askSaveLocation(defaultUri: vscode.Uri): Promise<vscode.Uri | undefined> {
  return dialogs.chooseSaveLocation({
    defaultUri,
    filters: { PDF: ["pdf"] },
    saveLabel: "Export PDF",
    title: "Save the combined PDF",
  });
}

function revealLabel(): string {
  if (process.platform === "darwin") {
    return "Reveal in Finder";
  }
  return process.platform === "win32" ? "Reveal in File Explorer" : "Open Containing Folder";
}

/**
 * Shows a "done" message with buttons to open the PDF or show it in its folder.
 * It doesn't wait for a click, so the command finishes straight away.
 */
export function announceExport(target: vscode.Uri, message: string): void {
  const open = "Open PDF";
  const reveal = revealLabel();
  void Promise.resolve(dialogs.notify(message, open, reveal)).then((choice) => {
    if (choice === open) {
      return vscode.commands.executeCommand("vscode.open", target);
    }
    if (choice === reveal) {
      return vscode.commands.executeCommand("revealFileInOS", target);
    }
    return undefined;
  });
}

/** Turns an error into a short message a person can act on. */
export function describeError(error: unknown): string {
  if (error instanceof vscode.FileSystemError) {
    switch (error.code) {
      case "NoPermissions":
        return "CodePDF doesn't have permission to read or write there. Check the folder's permissions.";
      case "FileNotFound":
        return "The file couldn't be found. It may have been moved or deleted.";
      case "FileIsADirectory":
        return "That's a folder, not a file.";
      case "Unavailable":
        return "The file system is unavailable right now. Try again in a moment.";
      default:
        return error.message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Runs an export with a progress notification and a Cancel button, and
 * reports errors as readable messages. Returns undefined if cancelled or failed.
 */
export async function runWithProgress<T>(
  title: string,
  task: (progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken) => Promise<T>,
): Promise<T | undefined> {
  try {
    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: true },
      (progress, token) => task(progress, token),
    );
  } catch (error) {
    if (error instanceof ExportCancelledError) {
      void vscode.window.showInformationMessage("Export cancelled. No PDF was written.");
      return undefined;
    }
    void vscode.window.showErrorMessage(`CodePDF couldn't export: ${describeError(error)}`);
    return undefined;
  }
}
