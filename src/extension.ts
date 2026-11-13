import * as vscode from "vscode";
import {
  exportFileCommand, exportFolderCommand, exportMultipleCommand, exportSelectionCommand,
} from "./vscode/exportCommands";
import { PdfEditorProvider } from "./viewer/pdfEditorProvider";

/** What activate() hands back. Only the automated tests use it. */
export interface CodePdfApi {
  viewer: PdfEditorProvider;
}

export function activate(context: vscode.ExtensionContext): CodePdfApi {
  const viewer = PdfEditorProvider.register(context);
  context.subscriptions.push(
    vscode.commands.registerCommand("codepdf.exportFile", exportFileCommand),
    vscode.commands.registerCommand("codepdf.exportSelection", exportSelectionCommand),
    vscode.commands.registerCommand("codepdf.exportMultiple", exportMultipleCommand),
    vscode.commands.registerCommand("codepdf.exportFolder", exportFolderCommand),
  );
  return { viewer };
}

export function deactivate(): void {
  // Nothing to clean up: everything is registered through context.subscriptions.
}
