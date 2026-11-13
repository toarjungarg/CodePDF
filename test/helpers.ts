// Shared test helpers: find fixture files, save output PDFs for a human to
// look at, and read PDFs back with pdf.js to check what's really inside.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Project root (tests run from out/test/). */
export const ROOT = join(__dirname, "..", "..");
export const OUTPUT_DIR = join(ROOT, "workspace", "test-output");

export function fixture(name: string): string {
  return readFileSync(join(ROOT, "test", "fixtures", name), "utf8");
}

/** Saves a PDF to workspace/test-output/ so it can be opened and checked by eye. */
export function saveOutput(name: string, bytes: Uint8Array): string {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const path = join(OUTPUT_DIR, name);
  writeFileSync(path, bytes);
  return path;
}

interface PdfJsTextItem {
  str?: string;
  transform?: number[];
}

interface PdfJsPage {
  view: number[];
  getTextContent(): Promise<{ items: PdfJsTextItem[] }>;
}

interface PdfJsDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfJsPage>;
  getOutline(): Promise<{ title: string }[] | null>;
  getMetadata(): Promise<{ info: Record<string, unknown> }>;
}

interface PdfJs {
  getDocument(source: { data: Uint8Array; verbosity?: number; useWasm?: boolean }): {
    promise: Promise<PdfJsDocument>;
    destroy(): Promise<void>;
  };
}

export interface PageInfo {
  width: number;
  height: number;
  /** Every text piece with its position (pdf.js squeezes runs of spaces, so positions show indentation). */
  pieces: { str: string; x: number; y: number }[];
  /** Text rows, top to bottom; pieces on the same row are joined without spaces. */
  lines: string[];
  text: string;
}

export interface PdfInfo {
  numPages: number;
  pages: PageInfo[];
  outline: string[];
  title: unknown;
  /** All pages' text joined. */
  text: string;
}

/** x position of the first text piece that is exactly `str`. */
export function pieceX(page: PageInfo, str: string): number {
  const piece = page.pieces.find((p) => p.str === str);
  if (!piece) {
    throw new Error(`"${str}" was not found on the page`);
  }
  return piece.x;
}

/**
 * Column of `str` counted from `#include` (column 0), using `#include <...>`
 * (where "<" sits at column 9) to measure one character's width.
 */
export function columnOf(page: PageInfo, str: string): number {
  const origin = pieceX(page, "#include");
  const bracket = page.pieces.find((p) => p.str.startsWith("<"));
  if (!bracket) {
    throw new Error("No #include <...> line to measure with");
  }
  const charWidth = (bracket.x - origin) / 9;
  return Math.round((pieceX(page, str) - origin) / charWidth);
}

let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  // The legacy build is the one pdf.js recommends for Node. It's dev-only (not shipped).
  const specifier: string = "pdfjs-dist/legacy/build/pdf.mjs";
  pdfjsPromise ??= import(specifier) as Promise<PdfJs>;
  return pdfjsPromise;
}

/** Opens a PDF with pdf.js and extracts page sizes, text rows and bookmarks. */
export async function readPdf(bytes: Uint8Array): Promise<PdfInfo> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, useWasm: false });
  const doc = await task.promise;
  try {
    const pages: PageInfo[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const rows = new Map<number, { x: number; str: string }[]>();
      const pieces: { str: string; x: number; y: number }[] = [];
      for (const item of content.items) {
        if (!item.str || !item.transform) {
          continue;
        }
        const y = Math.round(item.transform[5] ?? 0);
        const x = item.transform[4] ?? 0;
        const row = rows.get(y) ?? [];
        row.push({ x, str: item.str });
        rows.set(y, row);
        pieces.push({ str: item.str, x, y });
      }
      const lines = [...rows.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, row]) => row.sort((a, b) => a.x - b.x).map((piece) => piece.str).join(""));
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view;
      pages.push({ width: x1 - x0, height: y1 - y0, pieces, lines, text: lines.join("\n") });
    }
    const outline = ((await doc.getOutline()) ?? []).map((item) => item.title);
    const metadata = await doc.getMetadata();
    return {
      numPages: doc.numPages,
      pages,
      outline,
      title: metadata.info["Title"],
      text: pages.map((p) => p.text).join("\n"),
    };
  } finally {
    await task.destroy();
  }
}
