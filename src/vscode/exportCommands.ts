// The four export commands: a file, the current selection, several files
// combined, and a whole folder combined.

import * as vscode from "vscode";
import { resolveFonts } from "../export/fonts";
import { renderPdf, type SourceSection } from "../export/renderer";
import type { ExportOptions } from "../export/options";
import {
  SUPPORTED_EXTENSIONS, batchPdfNames, isSupportedSource, scanFolder, selectionPdfName, sortForExport,
  type DirEntry,
} from "../files";
import { readExportSettings } from "./settings";
import { dialogs } from "./dialogs";
import {
  announceExport, askSaveLocation, baseName, confirmOverwrite, parentFolder, readSource, runWithProgress, writePdf,
} from "./output";

const EXTENSION_LIST = SUPPORTED_EXTENSIONS.join(", ");
const OPEN_DIALOG_FILTERS = { "C++ files": SUPPORTED_EXTENSIONS.map((ext) => ext.slice(1)) };

function isExportable(uri: vscode.Uri): boolean {
  return isSupportedSource(baseName(uri));
}

function notSupportedMessage(): void {
  void vscode.window.showWarningMessage(`CodePDF exports C++ files (${EXTENSION_LIST}).`);
}

function workspaceFolderUri(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

/** Renders sections with the settings that apply to `resource`. */
async function render(
  sections: SourceSection[],
  resource: vscode.Uri | undefined,
  documentTitle: string,
  token: vscode.CancellationToken,
  onSectionDone?: (done: number, total: number) => void,
  tabSize?: number,
): Promise<Uint8Array> {
  const settings = readExportSettings(resource);
  const options: ExportOptions = tabSize ? { ...settings.options, tabSize } : settings.options;
  const fonts = resolveFonts(settings.editorFontFamily);
  const hooks = {
    isCancelled: () => token.isCancellationRequested,
    ...(onSectionDone ? { onSectionDone } : {}),
  };
  return renderPdf(sections, options, fonts, { documentTitle }, hooks);
}

// ---------------------------------------------------------------------------
// CodePDF: Export as PDF
// ---------------------------------------------------------------------------

export async function exportFileCommand(uri?: vscode.Uri, selected?: vscode.Uri[]): Promise<void> {
  let targets: vscode.Uri[];
  if (selected && selected.length > 1) {
    targets = selected; // several files right-clicked in the Explorer: one PDF each
  } else if (uri instanceof vscode.Uri) {
    targets = [uri];
  } else {
    const active = vscode.window.activeTextEditor?.document;
    if (active && (isExportable(active.uri) || (active.isUntitled && active.languageId === "cpp"))) {
      targets = [active.uri];
    } else {
      const picked = await dialogs.chooseFiles({
        canSelectMany: true,
        filters: OPEN_DIALOG_FILTERS,
        openLabel: "Export as PDF",
        title: "Choose C++ files to export",
        ...(workspaceFolderUri() ? { defaultUri: workspaceFolderUri()! } : {}),
      });
      if (!picked || picked.length === 0) {
        return;
      }
      targets = picked;
    }
  }

  const unsupported = targets.filter((t) => !isExportable(t) && t.scheme !== "untitled");
  targets = targets.filter((t) => !unsupported.includes(t));
  if (targets.length === 0) {
    notSupportedMessage();
    return;
  }

  // Work out every output file first, and ask about any that already exist.
  const names = batchPdfNames(targets.map((t) => ({ folder: parentFolder(t).toString(), fileName: baseName(t) })));
  const jobs: { source: vscode.Uri; output: vscode.Uri }[] = [];
  for (let i = 0; i < targets.length; i++) {
    const source = targets[i]!;
    let output: vscode.Uri | undefined;
    if (source.scheme === "untitled") {
      output = await askSaveLocation(vscode.Uri.joinPath(workspaceFolderUri() ?? vscode.Uri.file("/"), "untitled.pdf"));
      if (!output) {
        continue;
      }
    } else {
      output = vscode.Uri.joinPath(parentFolder(source), names[i]!);
      if (!(await confirmOverwrite(output))) {
        continue;
      }
    }
    jobs.push({ source, output });
  }
  if (jobs.length === 0) {
    return;
  }

  const title = jobs.length === 1 ? `Exporting ${baseName(jobs[0]!.source)}` : `Exporting ${jobs.length} files`;
  const result = await runWithProgress(title, async (progress, token) => {
    let unsaved = false;
    for (const [index, job] of jobs.entries()) {
      progress.report({ message: `${index + 1} of ${jobs.length}: ${baseName(job.source)}` });
      const source = await readSource(job.source);
      unsaved ||= source.unsaved;
      const section: SourceSection = { title: baseName(job.source), text: source.text, firstLineNumber: 1 };
      const bytes = await render([section], job.source, baseName(job.output), token, undefined, source.tabSize);
      await writePdf(job.output, bytes);
      progress.report({ increment: 100 / jobs.length });
    }
    return { unsaved };
  });
  if (!result) {
    return;
  }

  const note = result.unsaved ? " It includes unsaved changes from the editor." : "";
  if (unsupported.length > 0) {
    void vscode.window.showWarningMessage(`Skipped ${unsupported.length} file(s) that aren't C++ (${EXTENSION_LIST}).`);
  }
  if (jobs.length === 1) {
    announceExport(jobs[0]!.output, `Exported ${baseName(jobs[0]!.output)}.${note}`);
  } else {
    announceExport(jobs[0]!.output, `Exported ${jobs.length} PDFs next to their source files.${note}`);
  }
}

// ---------------------------------------------------------------------------
// CodePDF: Export Selection as PDF
// ---------------------------------------------------------------------------

export async function exportSelectionCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage("Open a C++ file and highlight some code first.");
    return;
  }
  const doc = editor.document;
  if (!isExportable(doc.uri) && !(doc.isUntitled && doc.languageId === "cpp")) {
    notSupportedMessage();
    return;
  }
  const selection = editor.selection;
  if (selection.isEmpty) {
    void vscode.window.showWarningMessage("Highlight the code you want to export first, then run this command again.");
    return;
  }

  // Export the full lines the selection touches. A selection that ends at the
  // very start of a line doesn't include that line.
  const start = selection.start.line;
  let end = selection.end.line;
  if (end > start && selection.end.character === 0) {
    end--;
  }
  const firstLine = start + 1;
  const lastLine = end + 1;

  let output: vscode.Uri | undefined;
  if (doc.isUntitled) {
    output = await askSaveLocation(
      vscode.Uri.joinPath(workspaceFolderUri() ?? vscode.Uri.file("/"), selectionPdfName("untitled.cpp", firstLine, lastLine)),
    );
    if (!output) {
      return;
    }
  } else {
    output = vscode.Uri.joinPath(parentFolder(doc.uri), selectionPdfName(baseName(doc.uri), firstLine, lastLine));
    if (!(await confirmOverwrite(output))) {
      return;
    }
  }

  const tabSize = typeof editor.options.tabSize === "number" ? editor.options.tabSize : undefined;
  const fileName = doc.isUntitled ? "untitled" : baseName(doc.uri);
  const target = output;
  const done = await runWithProgress(`Exporting lines ${firstLine}-${lastLine}`, async (_progress, token) => {
    const section: SourceSection = {
      title: fileName,
      subtitle: firstLine === lastLine ? `Line ${firstLine}` : `Lines ${firstLine}-${lastLine}`,
      text: doc.getText(),
      firstLineNumber: 1,
      onlyLines: { start, end },
    };
    const bytes = await render([section], doc.uri, baseName(target), token, undefined, tabSize);
    await writePdf(target, bytes);
    return true;
  });
  if (done) {
    const extra = editor.selections.length > 1 ? " Only the first selection was exported." : "";
    announceExport(target, `Exported ${baseName(target)}.${extra}`);
  }
}

// ---------------------------------------------------------------------------
// Combined exports: CodePDF: Export Multiple Files / Export Folder as PDF
// ---------------------------------------------------------------------------

interface PickedFile {
  uri: vscode.Uri;
  relativePath: string;
}

/** Shows the files that will be included and lets the user untick any. */
async function confirmFileList(files: PickedFile[], title: string, note?: string): Promise<PickedFile[] | undefined> {
  const items = sortForExport(files).map((file) => ({
    label: file.relativePath,
    picked: true,
    file,
  }));
  const placeHolder = note
    ? `${items.length} file(s) will be combined in this order. ${note}`
    : `${items.length} file(s) will be combined in this order. Untick any you want to leave out.`;
  const chosen = await dialogs.pickMany(items, { title, placeHolder, ignoreFocusOut: true });
  if (!chosen || chosen.length === 0) {
    return undefined;
  }
  const keep = new Set(chosen.map((c) => c.file));
  return sortForExport(files).filter((f) => keep.has(f));
}

/** The deepest folder that contains every file. */
function commonFolder(uris: vscode.Uri[]): vscode.Uri {
  const parts = uris.map((u) => parentFolder(u).path.split("/"));
  const shared: string[] = [];
  for (let i = 0; i < (parts[0]?.length ?? 0); i++) {
    const segment = parts[0]![i]!;
    if (parts.every((p) => p[i] === segment)) {
      shared.push(segment);
    } else {
      break;
    }
  }
  return uris[0]!.with({ path: shared.join("/") || "/" });
}

async function exportCombined(files: PickedFile[], resource: vscode.Uri, defaultOutput: vscode.Uri): Promise<void> {
  const output = await askSaveLocation(defaultOutput);
  if (!output) {
    return;
  }
  const result = await runWithProgress(`Combining ${files.length} file(s) into one PDF`, async (progress, token) => {
    const sections: SourceSection[] = [];
    let unsaved = false;
    for (const [index, file] of files.entries()) {
      progress.report({ message: `Reading ${index + 1} of ${files.length}` });
      const source = await readSource(file.uri);
      unsaved ||= source.unsaved;
      sections.push({ title: file.relativePath, text: source.text, firstLineNumber: 1 });
    }
    const bytes = await render(sections, resource, baseName(output), token, (done, total) => {
      progress.report({ message: `Drawing ${done} of ${total}`, increment: 100 / total });
    });
    await writePdf(output, bytes);
    return { unsaved };
  });
  if (result) {
    const note = result.unsaved ? " It includes unsaved changes from the editor." : "";
    announceExport(output, `Exported ${files.length} file(s) to ${baseName(output)}.${note}`);
  }
}

export async function exportMultipleCommand(uri?: vscode.Uri, selected?: vscode.Uri[]): Promise<void> {
  let uris: vscode.Uri[] | undefined = selected && selected.length > 0 ? selected : uri instanceof vscode.Uri ? [uri] : undefined;
  if (!uris || uris.length < 2) {
    uris = await dialogs.chooseFiles({
      canSelectMany: true,
      filters: OPEN_DIALOG_FILTERS,
      openLabel: "Choose Files",
      title: "Choose the C++ files to combine into one PDF",
      ...(workspaceFolderUri() ? { defaultUri: workspaceFolderUri()! } : {}),
    });
  }
  if (!uris || uris.length === 0) {
    return;
  }
  const supported = uris.filter(isExportable);
  if (supported.length === 0) {
    notSupportedMessage();
    return;
  }
  const files = supported.map((u) => ({ uri: u, relativePath: vscode.workspace.asRelativePath(u, false) }));
  const skipped = uris.length - supported.length;
  const note = skipped > 0 ? `${skipped} non-C++ file(s) were left out.` : undefined;
  const confirmed = await confirmFileList(files, "CodePDF: Export Multiple Files", note);
  if (!confirmed) {
    return;
  }
  const folder = commonFolder(confirmed.map((f) => f.uri));
  const folderName = baseName(folder) || "combined";
  await exportCombined(confirmed, confirmed[0]!.uri, vscode.Uri.joinPath(folder, `${folderName}.pdf`));
}

export async function exportFolderCommand(uri?: vscode.Uri): Promise<void> {
  let folder = uri instanceof vscode.Uri ? uri : undefined;
  if (!folder) {
    const picked = await dialogs.chooseFiles({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Export Folder",
      title: "Choose a folder to export as one PDF",
      ...(workspaceFolderUri() ? { defaultUri: workspaceFolderUri()! } : {}),
    });
    folder = picked?.[0];
  }
  if (!folder) {
    return;
  }
  const root = folder;

  const scan = await scanFolder<vscode.Uri>(
    root,
    async (location): Promise<DirEntry[]> => {
      const entries = await vscode.workspace.fs.readDirectory(location);
      return entries
        .filter(([, type]) => (type & vscode.FileType.SymbolicLink) === 0) // don't follow shortcuts out of the folder
        .map(([name, type]) => ({
          name,
          isDirectory: (type & vscode.FileType.Directory) !== 0,
          isFile: (type & vscode.FileType.File) !== 0,
        }));
    },
    (location, name) => vscode.Uri.joinPath(location, name),
  );

  const skippedNote: string[] = [];
  if (scan.skippedFolders.length > 0) {
    const shown = scan.skippedFolders.slice(0, 4).join(", ");
    const more = scan.skippedFolders.length > 4 ? ` and ${scan.skippedFolders.length - 4} more` : "";
    skippedNote.push(`Skipped folders: ${shown}${more}.`);
  }
  if (scan.skippedHiddenFiles.length > 0) {
    skippedNote.push(`Skipped ${scan.skippedHiddenFiles.length} hidden file(s).`);
  }
  if (scan.truncated) {
    skippedNote.push(`Stopped at the first ${scan.files.length} files.`);
  }

  if (scan.files.length === 0) {
    void vscode.window.showInformationMessage(
      `No C++ files (${EXTENSION_LIST}) found in "${baseName(root)}". ${skippedNote.join(" ")}`.trim(),
    );
    return;
  }

  const files = scan.files.map((f) => ({ uri: f.location, relativePath: f.relativePath }));
  const confirmed = await confirmFileList(files, `CodePDF: Export Folder "${baseName(root)}"`, skippedNote.join(" ") || undefined);
  if (!confirmed) {
    return;
  }
  await exportCombined(confirmed, root, vscode.Uri.joinPath(root, `${baseName(root) || "folder"}.pdf`));
}
