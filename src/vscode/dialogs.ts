// Every question CodePDF asks the user goes through this one object. In normal
// use these are just VS Code's own dialogs; automated tests swap in answers.

import * as vscode from "vscode";

export const dialogs = {
  /** A modal yes/no question. Resolves to the action's label, or undefined for Cancel. */
  confirm(message: string, detail: string, action: string): Thenable<string | undefined> {
    return vscode.window.showWarningMessage(message, { modal: true, detail }, action);
  },

  chooseFiles(options: vscode.OpenDialogOptions): Thenable<vscode.Uri[] | undefined> {
    return vscode.window.showOpenDialog(options);
  },

  chooseSaveLocation(options: vscode.SaveDialogOptions): Thenable<vscode.Uri | undefined> {
    return vscode.window.showSaveDialog(options);
  },

  pickMany<T extends vscode.QuickPickItem>(items: T[], options: vscode.QuickPickOptions): Thenable<T[] | undefined> {
    return vscode.window.showQuickPick(items, { ...options, canPickMany: true });
  },

  /** A non-blocking notification with buttons. */
  notify(message: string, ...actions: string[]): Thenable<string | undefined> {
    return vscode.window.showInformationMessage(message, ...actions);
  },
};
