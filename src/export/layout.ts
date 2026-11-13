// Turns token lines into printable rows: expands tabs, makes control
// characters visible, measures characters in columns, and wraps or cuts
// lines that are too long for the page.

import type { Token, TokenKind, TokenLine } from "./cppTokenizer";

/** A piece of same-coloured text placed at a column. */
export interface Run {
  text: string;
  kind: TokenKind;
  /** Column where the run starts (0 = first code column). */
  column: number;
}

/** One printed row of code. A long source line can become several rows. */
export interface Row {
  /** The source line number, or null for a wrapped continuation row. */
  lineNumber: number | null;
  runs: Run[];
  /** True when this row continues the previous line (wrapping on). */
  continuation: boolean;
  /** True when the line was cut at the margin (wrapping off). */
  clipped: boolean;
}

const COMBINING = /\p{M}/u;

/** How many columns a character takes in a monospace layout: 0, 1 or 2. */
export function columnWidth(codePoint: number): number {
  if (codePoint === 0x200b || codePoint === 0x200c || codePoint === 0x200d || codePoint === 0xfeff) {
    return 0;
  }
  if (COMBINING.test(String.fromCodePoint(codePoint))) {
    return 0;
  }
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) || // Hangul Jamo
    (codePoint >= 0x2e80 && codePoint <= 0x303e) || // CJK radicals, punctuation
    (codePoint >= 0x3041 && codePoint <= 0x33ff) || // Hiragana, Katakana, CJK symbols
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK extension A
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK unified ideographs
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) || // Yi
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK compatibility ideographs
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) || // CJK compatibility forms
    (codePoint >= 0xff00 && codePoint <= 0xff60) || // Fullwidth forms
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) || // Emoji and pictographs
    (codePoint >= 0x20000 && codePoint <= 0x3fffd) // CJK extensions B and later
  ) {
    return 2;
  }
  return 1;
}

/** Replaces a control character with a visible symbol (e.g. NUL becomes ␀). Tabs are handled separately. */
function visibleControl(codePoint: number): string | null {
  if (codePoint < 0x20 && codePoint !== 0x09) {
    return String.fromCodePoint(0x2400 + codePoint);
  }
  if (codePoint === 0x7f) {
    return "␡";
  }
  return null;
}

/** Expands tabs to spaces (to the next tab stop) and makes control characters visible. */
export function expandLine(line: TokenLine, tabSize: number): Token[] {
  const out: Token[] = [];
  let column = 0;
  for (const token of line) {
    let text = "";
    for (const ch of token.text) {
      const codePoint = ch.codePointAt(0) ?? 0;
      if (codePoint === 0x09) {
        const spaces = tabSize - (column % tabSize);
        text += " ".repeat(spaces);
        column += spaces;
        continue;
      }
      const shown = visibleControl(codePoint) ?? ch;
      text += shown;
      column += columnWidth(shown.codePointAt(0) ?? 0);
    }
    out.push({ kind: token.kind, text });
  }
  return out;
}

/** Number of columns of leading spaces in an already expanded line. */
function indentColumns(tokens: Token[]): number {
  let count = 0;
  for (const token of tokens) {
    for (const ch of token.text) {
      if (ch !== " ") {
        return count;
      }
      count++;
    }
  }
  return 0; // a blank line has no meaningful indent
}

/**
 * Lays out one expanded source line into rows of at most maxColumns columns.
 * With wrap on, extra rows keep the line's indent (capped at half the width).
 * With wrap off, the line is cut one column early so a marker fits.
 */
export function layoutLine(tokens: Token[], lineNumber: number, maxColumns: number, wrap: boolean): Row[] {
  const width = Math.max(8, Math.floor(maxColumns));
  let total = 0;
  for (const token of tokens) {
    for (const ch of token.text) {
      total += columnWidth(ch.codePointAt(0) ?? 0);
    }
  }

  const rows: Row[] = [];
  let row: Row = { lineNumber, runs: [], continuation: false, clipped: false };
  let column = 0;
  const hangingIndent = Math.min(indentColumns(tokens), Math.floor(width / 2));
  const limit = !wrap && total > width ? width - 1 : width;

  const addChar = (ch: string, kind: TokenKind, w: number): void => {
    const last = row.runs[row.runs.length - 1];
    if (last && last.kind === kind) {
      last.text += ch;
    } else {
      row.runs.push({ text: ch, kind, column });
    }
    column += w;
  };

  outer: for (const token of tokens) {
    for (const ch of token.text) {
      const w = columnWidth(ch.codePointAt(0) ?? 0);
      if (column + w > limit && column > 0) {
        if (!wrap) {
          row.clipped = true;
          break outer;
        }
        rows.push(row);
        row = { lineNumber: null, runs: [], continuation: true, clipped: false };
        column = hangingIndent;
      }
      addChar(ch, token.kind, w);
    }
  }
  rows.push(row);
  return rows;
}
