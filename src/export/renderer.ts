// Draws code into a PDF with PDFKit: pages, header, footer with "Page X of Y",
// line numbers, colours, wrapped rows, and a bookmark per file.

import PDFDocument = require("pdfkit");
import { plainLines, tokenizeCpp, type TokenKind, type TokenLine } from "./cppTokenizer";
import { columnWidth, expandLine, layoutLine, type Row } from "./layout";
import { pageSize, type ExportOptions } from "./options";
import { BUILT_IN_COURIER, type CodeFont, type FontSet } from "./fonts";

export interface SourceSection {
  /** Shown in the page header (and as a heading when several files are combined), e.g. "src/main.cpp". */
  title: string;
  /** Optional label on the right of the header, e.g. "Lines 10-25". */
  subtitle?: string;
  /** The code, with any line ending style. */
  text: string;
  /** Number of the first line (1 for a whole file). */
  firstLineNumber: number;
  /**
   * Print only these lines (0-based, inclusive) of `text`. The whole text is still
   * coloured first, so a selection that starts inside a comment is coloured correctly.
   * Line numbers then start at start + 1.
   */
  onlyLines?: { start: number; end: number };
}

export interface RenderInfo {
  /** Stored as the PDF's title. */
  documentTitle: string;
  /** Date printed in the footer; defaults to today. */
  date?: Date;
}

export interface RenderHooks {
  /** Called after each file is drawn, so the UI can show progress. */
  onSectionDone?(done: number, total: number): void | Promise<void>;
  /** Checked regularly; returning true stops the export. */
  isCancelled?(): boolean;
}

export class ExportCancelledError extends Error {
  constructor() {
    super("Export cancelled.");
    this.name = "ExportCancelledError";
  }
}

/** Print-friendly colours based on VS Code's default light theme. */
const COLORS: Readonly<Record<TokenKind, string>> = {
  plain: "#1f1f1f",
  keyword: "#0000ff",
  type: "#267f99",
  string: "#a31515",
  comment: "#008000",
  number: "#098658",
  preprocessor: "#af00db",
};
const MUTED = "#8a8a8a";
const HEADER_TEXT = "#3c3c3c";
const RULE = "#c8c8c8";
const LINE_HEIGHT = 1.25;
const NO_LIGATURES = { liga: false, clig: false, dlig: false, calt: false };

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function formatDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function textColumns(text: string): number {
  let total = 0;
  for (const ch of text) {
    total += columnWidth(ch.codePointAt(0) ?? 0);
  }
  return total;
}

/** Shortens text from the left ("…/folder/main.cpp") so it fits in maxColumns. */
function fitLeft(text: string, maxColumns: number): string {
  if (textColumns(text) <= maxColumns) {
    return text;
  }
  const chars = [...text];
  let kept = "";
  let used = 1; // room for the ellipsis
  for (let i = chars.length - 1; i >= 0; i--) {
    const w = columnWidth(chars[i]!.codePointAt(0) ?? 0);
    if (used + w > maxColumns) {
      break;
    }
    kept = chars[i] + kept;
    used += w;
  }
  return "…" + kept;
}

/** Draws every file into one PDF and returns the PDF's bytes. */
export async function renderPdf(
  sections: SourceSection[],
  options: ExportOptions,
  fonts: FontSet,
  info: RenderInfo,
  hooks: RenderHooks = {},
): Promise<Uint8Array> {
  if (sections.length === 0) {
    throw new Error("There is nothing to export.");
  }

  const [pageWidth, pageHeight] = pageSize(options);
  const noMargins = { top: 0, bottom: 0, left: 0, right: 0 };
  const doc = new PDFDocument({
    size: [pageWidth, pageHeight],
    margins: noMargins,
    autoFirstPage: false,
    bufferPages: true,
    compress: true,
    displayTitle: true,
    font: "Courier",
    info: { Title: info.documentTitle, Creator: "CodePDF", Producer: "CodePDF" },
  });

  const chunks: Uint8Array[] = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });

  // Fonts: the code font first, then fill-in fonts for characters it lacks.
  const fontChain: CodeFont[] = [fonts.primary, ...fonts.fallbacks];
  for (const font of fontChain) {
    if (font.path) {
      doc.registerFont(font.label, font.path, font.postscriptName);
    }
  }
  const fontForChar = new Map<number, CodeFont>();
  const pickFont = (codePoint: number): CodeFont => {
    let font = fontForChar.get(codePoint);
    if (!font) {
      font = fontChain.find((f) => f.covers(codePoint)) ?? fonts.primary;
      fontForChar.set(codePoint, font);
    }
    return font;
  };

  const fontSize = options.fontSize;
  const smallSize = Math.max(6, Math.round(fontSize * 0.85 * 10) / 10);
  doc.font(fonts.primary.label).fontSize(fontSize);
  const charWidth = doc.widthOfString("0", { features: NO_LIGATURES });
  const advanceAt = (size: number): number => (charWidth * size) / fontSize;
  const lineHeight = fontSize * LINE_HEIGHT;

  /** Draws text starting at (x, y), one font run at a time, keeping every character on its column. */
  const drawString = (text: string, x: number, y: number, size: number, color: string): void => {
    const advance = advanceAt(size);
    let group = "";
    let groupFont: CodeFont | null = null;
    let groupColumn = 0;
    let column = 0;
    const flush = (): void => {
      if (group && groupFont) {
        doc
          .font(groupFont.label)
          .fontSize(size)
          .fillColor(color)
          .text(group, x + groupColumn * advance, y, { lineBreak: false, features: NO_LIGATURES });
      }
      group = "";
    };
    for (const ch of text) {
      const codePoint = ch.codePointAt(0) ?? 0;
      const width = columnWidth(codePoint);
      // Zero-width marks (like accents) stay in the same font as the letter before them.
      const font: CodeFont = width === 0 && groupFont ? groupFont : pickFont(codePoint);
      let shown = ch;
      if (font === BUILT_IN_COURIER && !font.covers(codePoint)) {
        shown = "?";
      }
      if (font !== groupFont) {
        flush();
        groupFont = font;
        groupColumn = column;
      }
      group += shown;
      column += width;
    }
    flush();
  };

  const margin = options.marginInches * 72;
  const contentWidth = pageWidth - 2 * margin;
  const headerHeight = options.header ? smallSize * LINE_HEIGHT + fontSize * 0.9 : 0;
  const footerVisible = options.footer || options.pageNumbers;
  const footerHeight = footerVisible ? smallSize * LINE_HEIGHT + fontSize * 0.9 : 0;
  const codeTop = margin + headerHeight;
  const codeBottom = pageHeight - margin - footerHeight;
  const rowsPerPage = Math.floor((codeBottom - codeTop) / lineHeight);
  if (rowsPerPage < 3) {
    throw new Error("The page is too small for this font size and margins. Try a smaller font size or margins.");
  }
  const combined = sections.length > 1;
  const smallColumns = Math.floor(contentWidth / advanceAt(smallSize));

  const rule = (y: number): void => {
    doc.lineWidth(0.5).strokeColor(RULE).moveTo(margin, y).lineTo(pageWidth - margin, y).stroke();
  };

  const startPage = (section: SourceSection): void => {
    doc.addPage({ size: [pageWidth, pageHeight], margins: noMargins });
    if (!options.header) {
      return;
    }
    const subtitle = section.subtitle ?? "";
    const subtitleColumns = subtitle ? textColumns(subtitle) + 2 : 0;
    drawString(fitLeft(section.title, smallColumns - subtitleColumns), margin, margin, smallSize, HEADER_TEXT);
    if (subtitle) {
      const x = pageWidth - margin - textColumns(subtitle) * advanceAt(smallSize);
      drawString(subtitle, x, margin, smallSize, MUTED);
    }
    rule(margin + smallSize * LINE_HEIGHT + fontSize * 0.3);
  };

  let rowsDrawn = 0;
  for (let s = 0; s < sections.length; s++) {
    const section = sections[s]!;
    const text = normalizeLineEndings(section.text);
    let lines: TokenLine[] = options.syntaxHighlighting ? tokenizeCpp(text) : plainLines(text);
    let firstLineNumber = section.firstLineNumber;
    if (section.onlyLines) {
      const start = Math.max(0, Math.min(section.onlyLines.start, lines.length - 1));
      const end = Math.max(start, Math.min(section.onlyLines.end, lines.length - 1));
      lines = lines.slice(start, end + 1);
      firstLineNumber = start + 1;
    } else if (lines.length > 1 && lines[lines.length - 1]!.length === 0) {
      lines.pop(); // the final newline doesn't start a real line
    }

    const lastLineNumber = firstLineNumber + lines.length - 1;
    const digits = Math.max(2, String(lastLineNumber).length);
    const gutterColumns = options.lineNumbers ? digits + 2 : options.lineWrapping ? 2 : 0;
    const codeLeft = margin + gutterColumns * charWidth;
    const maxColumns = Math.floor((pageWidth - margin - codeLeft) / charWidth);

    startPage(section);
    let y = codeTop;
    if (combined) {
      doc.outline.addItem(section.title);
      drawString(fitLeft(section.title, Math.floor(contentWidth / advanceAt(fontSize * 1.15))), margin, y, fontSize * 1.15, HEADER_TEXT);
      rule(y + lineHeight * 1.45);
      y += lineHeight * 2;
    }

    const drawRow = (row: Row): void => {
      if (y + lineHeight > codeBottom + 0.01) {
        startPage(section);
        y = codeTop;
      }
      if (options.lineNumbers && row.lineNumber !== null) {
        const label = String(row.lineNumber);
        drawString(label, margin + (digits - label.length) * charWidth, y, fontSize, MUTED);
      }
      if (row.continuation) {
        const markerColumn = options.lineNumbers ? digits - 1 : 0;
        drawString("↪", margin + markerColumn * charWidth, y, fontSize, MUTED);
      }
      for (const run of row.runs) {
        const color = options.syntaxHighlighting ? COLORS[run.kind] : COLORS.plain;
        drawString(run.text, codeLeft + run.column * charWidth, y, fontSize, color);
      }
      if (row.clipped) {
        drawString("→", codeLeft + (maxColumns - 1) * charWidth, y, fontSize, MUTED);
      }
      y += lineHeight;
    };

    for (let i = 0; i < lines.length; i++) {
      const expanded = expandLine(lines[i]!, options.tabSize);
      const rows = layoutLine(expanded, firstLineNumber + i, maxColumns, options.lineWrapping);
      for (const row of rows) {
        drawRow(row);
        rowsDrawn++;
        if (rowsDrawn % 2000 === 0) {
          // Give VS Code a moment to update progress and notice a cancel click.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          if (hooks.isCancelled?.()) {
            throw new ExportCancelledError();
          }
        }
      }
    }

    if (hooks.isCancelled?.()) {
      throw new ExportCancelledError();
    }
    await hooks.onSectionDone?.(s + 1, sections.length);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  // Second pass: footers, now that the total page count is known.
  if (footerVisible) {
    const range = doc.bufferedPageRange();
    const dateText = formatDate(info.date ?? new Date());
    const textY = pageHeight - margin - smallSize * LINE_HEIGHT;
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      if (options.footer) {
        rule(textY - fontSize * 0.45);
        drawString(dateText, margin, textY, smallSize, MUTED);
      }
      if (options.pageNumbers) {
        const label = `Page ${i + 1} of ${range.count}`;
        const x = pageWidth - margin - textColumns(label) * advanceAt(smallSize);
        drawString(label, x, textY, smallSize, MUTED);
      }
    }
  }

  doc.end();
  await finished;

  let length = 0;
  for (const chunk of chunks) {
    length += chunk.length;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
