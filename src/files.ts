// Rules about files: which ones are C++ sources, which folders a folder export
// skips, the order files appear in a combined PDF, and what PDFs are named.
// No VS Code imports here, so these rules can be tested in plain Node.

export const SUPPORTED_EXTENSIONS = [".cpp", ".cc", ".cxx", ".h", ".hpp", ".hh", ".hxx"] as const;
const HEADER_EXTENSIONS = new Set([".h", ".hpp", ".hh", ".hxx"]);

/** Folders never searched during a folder export (hidden folders are skipped too). */
export const EXCLUDED_FOLDERS = new Set([
  "node_modules", "build", "builds", "dist", "out", "bin", "obj", "debug", "release", "x64", "x86", "target",
]);

/** A folder search stops after this many files, so a huge folder can't freeze VS Code. */
export const MAX_FOLDER_FILES = 500;

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot).toLowerCase() : "";
}

export function isSupportedSource(fileName: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extensionOf(fileName));
}

export function isHeader(fileName: string): boolean {
  return HEADER_EXTENSIONS.has(extensionOf(fileName));
}

export function isHidden(name: string): boolean {
  return name.startsWith(".");
}

export function isExcludedFolder(name: string): boolean {
  const lower = name.toLowerCase();
  return isHidden(name) || EXCLUDED_FOLDERS.has(lower) || lower.startsWith("cmake-build-");
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

export interface FolderScan<T> {
  /** Supported source files found, in folder order (sort them with sortForExport). */
  files: { location: T; relativePath: string }[];
  /** Folders that were skipped, as relative paths, so the user can be told. */
  skippedFolders: string[];
  /** Hidden files that looked like sources but were skipped. */
  skippedHiddenFiles: string[];
  /** True when the search stopped at MAX_FOLDER_FILES. */
  truncated: boolean;
}

/**
 * Searches a folder for C++ sources, skipping hidden files, dependency folders and build folders.
 * Works with any location type (VS Code URIs in the extension, plain paths in tests).
 */
export async function scanFolder<T>(
  root: T,
  readDirectory: (location: T) => Promise<DirEntry[]>,
  join: (location: T, name: string) => T,
  maxFiles: number = MAX_FOLDER_FILES,
): Promise<FolderScan<T>> {
  const result: FolderScan<T> = { files: [], skippedFolders: [], skippedHiddenFiles: [], truncated: false };

  const visit = async (location: T, relative: string, depth: number): Promise<void> => {
    if (depth > 20) {
      return; // guards against folder loops
    }
    let entries: DirEntry[];
    try {
      entries = await readDirectory(location);
    } catch {
      return; // unreadable folder: skip it
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (result.truncated) {
        return;
      }
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        if (isExcludedFolder(entry.name)) {
          result.skippedFolders.push(path);
        } else {
          await visit(join(location, entry.name), path, depth + 1);
        }
      } else if (entry.isFile && isSupportedSource(entry.name)) {
        if (isHidden(entry.name)) {
          result.skippedHiddenFiles.push(path);
        } else if (result.files.length >= maxFiles) {
          result.truncated = true;
        } else {
          result.files.push({ location: join(location, entry.name), relativePath: path });
        }
      }
    }
  };

  await visit(root, "", 0);
  return result;
}

/** Order for combined PDFs: headers before sources, then alphabetical by path. */
export function sortForExport<T extends { relativePath: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => {
    const headerOrder = Number(!isHeader(a.relativePath)) - Number(!isHeader(b.relativePath));
    return headerOrder !== 0 ? headerOrder : a.relativePath.localeCompare(b.relativePath);
  });
}

function stemOf(fileName: string): string {
  const ext = extensionOf(fileName);
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

/** "main.cpp" becomes "main.pdf". */
export function pdfNameFor(fileName: string): string {
  return `${stemOf(fileName)}.pdf`;
}

/**
 * PDF names for files exported one by one in the same batch. Files in the same
 * folder that would share a name (main.cpp and main.h) keep their extension
 * instead (main.cpp.pdf and main.h.pdf), so neither overwrites the other.
 */
export function batchPdfNames(files: { folder: string; fileName: string }[]): string[] {
  const counts = new Map<string, number>();
  const key = (f: { folder: string; fileName: string }): string => `${f.folder}\u0000${pdfNameFor(f.fileName).toLowerCase()}`;
  for (const file of files) {
    counts.set(key(file), (counts.get(key(file)) ?? 0) + 1);
  }
  return files.map((file) => ((counts.get(key(file)) ?? 0) > 1 ? `${file.fileName}.pdf` : pdfNameFor(file.fileName)));
}

/** "main.cpp" with lines 10 to 25 becomes "main-lines-10-25.pdf". */
export function selectionPdfName(fileName: string, firstLine: number, lastLine: number): string {
  const range = firstLine === lastLine ? `line-${firstLine}` : `lines-${firstLine}-${lastLine}`;
  return `${stemOf(fileName)}-${range}.pdf`;
}
