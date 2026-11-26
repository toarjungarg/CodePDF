// A small tokenizer for Markdown syntax colouring (.md, .markdown). Like the
// others, it labels pieces of text without changing a single character:
// joining every token's text gives back the original. It is pattern-based, not
// a full CommonMark parser, and it never throws.
//
// It colours the Markdown SOURCE (the text with its # and * marks), not the
// rendered result. The shared colours are used like this:
//   keyword       headings (# Title, the whole line) and the === or --- line
//                 under a heading line (a "setext" heading)
//   preprocessor  structure marks: --- *** ___ lines, front matter markers,
//                 code fence lines (``` and ~~~ with their info word),
//                 list markers (- * + 1. 1)), task boxes [ ] [x], and > quotes
//   string        code (fenced blocks and `inline code`), (urls), <autolinks>
//                 and link titles
//   type          link text and [reference labels]
//   number        emphasis: *em*, _em_, **bold** and __bold__ (marks included)
//   comment       <!-- html comments -->, which may run over several lines
//   plain         everything else
//
// Things worth knowing:
//   - Inside a fenced code block nothing else is read. A fence that is never
//     closed colours the rest of the file, like CommonMark does.
//   - Lines indented 4 or more spaces (or a tab) that do not start a list item
//     are left plain, because they could be code or a list continuation.
//   - Front matter is --- on the very first line up to the next --- or ... line.
//     If it is never closed, the first line is just a thematic break.
//   - Inline code, links and emphasis only work inside one line.
//   - A comment with no --> within the next 100 lines ends at the end of its line.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** How far ahead (in characters) a code span, link or emphasis looks for its closing mark. Keeps huge lines fast. */
const MAX_SPAN_CHARS = 2000;

/** How many lines an <!-- html comment --> may run over before it is given up on (the same rule as YAML and XML). */
const MAX_COMMENT_LINES = 100;

/** A tab counts as this many columns when working out how far a line is indented. */
const TAB_WIDTH = 4;

/** From this many columns of indentation a line is code (or a list continuation), so it stays plain. */
const CODE_INDENT = 4;

const FENCE_LINE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE_MARK = /^( *)(>)( ?)/;
const LIST_MARK = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:([ \t]+)|$)/;
const TASK_BOX = /^\[[ xX]\](?=[ \t]|$)/;
const REFERENCE_DEFINITION = /^( {0,3})(\[[^\]\n^][^\]\n]*\])(:)([ \t]*)(<[^>\n]*>|\S+)/;
const FRONT_MATTER_MARK = /^---[ \t]*$/;
const FRONT_MATTER_END = /^(?:---|\.\.\.)[ \t]*$/;
const AUTOLINK = /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>]+)>/y;
const ESCAPABLE = /[!-/:-@[-`{-~]/;

const isSpace = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch);
const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** How many columns of leading spaces and tabs a line has. */
function indentWidth(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === " ") {
      width++;
    } else if (ch === "\t") {
      width += TAB_WIDTH - (width % TAB_WIDTH);
    } else {
      break;
    }
  }
  return width;
}

export function tokenizeMarkdown(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;

  const lineEnd = (pos: number): number => {
    const end = source.indexOf("\n", pos);
    return end === -1 ? n : end;
  };

  /** How many backticks (or other same characters) in a row start at `pos`, not going past `end`. */
  const runLength = (pos: number, end: number): number => {
    const ch = source[pos];
    let j = pos;
    while (j < end && source[j] === ch) {
      j++;
    }
    return j - pos;
  };

  /** Where a code span opened by `run` backticks closes (just after the closing run), or -1. */
  const findCodeClose = (from: number, run: number, end: number): number => {
    const limit = Math.min(end, from + MAX_SPAN_CHARS);
    let j = from;
    while (j < limit) {
      if (source[j] === "`") {
        const length = runLength(j, end);
        if (length === run) {
          return j + length;
        }
        j += length;
      } else {
        j++;
      }
    }
    return -1;
  };

  /** Where an html comment that starts at `start` ends (after the -->), or the end of the line if it never closes in time. */
  const findCommentEnd = (start: number, end: number): number => {
    // Only look as far as MAX_COMMENT_LINES lines ahead, so a stray <!-- cannot make every later line slow.
    let limit = start;
    for (let lines = 0; lines <= MAX_COMMENT_LINES && limit < n; lines++) {
      limit = lineEnd(limit) + 1;
    }
    const found = source.slice(start + 4, Math.min(limit, n)).indexOf("-->");
    return found === -1 ? end : start + 4 + found + 3;
  };

  /**
   * Colours the text from `start` to `end` (inside one line). `base` is the
   * colour of plain text here (type inside link text). `top` is true for a whole
   * line, where an html comment may run on past the end. Returns the position
   * it got to, which is past `end` only when a comment ran on to a later line.
   */
  const inline = (start: number, end: number, base: TokenKind, top: boolean): number => {
    let i = start;
    let flushedTo = start;
    /** Colours source[from..to) and moves past it. Plain text before it is written first. */
    const emit = (kind: TokenKind, from: number, to: number): void => {
      push(base, flushedTo, from);
      push(kind, from, to);
      flushedTo = to;
      i = to;
    };

    while (i < end) {
      const ch = source[i]!;
      if (ch === "\\") {
        // A backslash and the mark after it are a pair, so \* or \` never starts anything.
        i += i + 1 < end && ESCAPABLE.test(source[i + 1]!) ? 2 : 1;
      } else if (ch === "`") {
        const run = runLength(i, end);
        const close = findCodeClose(i + run, run, end);
        if (close === -1) {
          i += run; // a backtick run with no partner is plain text
        } else {
          emit("string", i, close);
        }
      } else if (ch === "<") {
        if (source.startsWith("<!--", i)) {
          const close = findCommentEnd(i, end);
          if (top || close <= end) {
            emit("comment", i, close);
          } else {
            i++;
          }
        } else {
          AUTOLINK.lastIndex = i;
          const match = AUTOLINK.exec(source);
          if (match && i + match[0].length <= end) {
            emit("string", i, i + match[0].length);
          } else {
            i++;
          }
        }
      } else if (ch === "[") {
        tryLink();
      } else if (ch === "*" || ch === "_") {
        tryEmphasis();
      } else {
        i++;
      }
    }
    push(base, flushedTo, end);
    return Math.max(end, flushedTo);

    /** [text](url) and [text][label]. The text may hold more inline marks (an image, code, emphasis). */
    function tryLink(): void {
      const limit = Math.min(end, i + MAX_SPAN_CHARS);
      let depth = 0;
      let close = -1;
      for (let j = i; j < limit; j++) {
        const c = source[j]!;
        if (c === "\\") {
          j++;
        } else if (c === "`") {
          const run = runLength(j, end);
          const codeEnd = findCodeClose(j + run, run, end);
          j = (codeEnd === -1 ? j + run : codeEnd) - 1;
        } else if (c === "[") {
          depth++;
        } else if (c === "]" && --depth === 0) {
          close = j;
          break;
        }
      }
      if (close === -1) {
        i++;
        return;
      }
      if (source[close + 1] === "(") {
        // Find the matching ) so a url like /wiki/A_(b) keeps its inner brackets.
        let level = 1;
        let urlEnd = -1;
        const urlLimit = Math.min(end, close + 2 + MAX_SPAN_CHARS);
        for (let j = close + 2; j < urlLimit; j++) {
          const c = source[j]!;
          if (c === "\\") {
            j++;
          } else if (c === "(") {
            level++;
          } else if (c === ")" && --level === 0) {
            urlEnd = j;
            break;
          }
        }
        if (urlEnd !== -1) {
          push(base, flushedTo, i + 1);
          inline(i + 1, close, "type", false);
          push(base, close, close + 1);
          push("string", close + 1, urlEnd + 1);
          flushedTo = i = urlEnd + 1;
          return;
        }
      } else if (source[close + 1] === "[") {
        const labelClose = source.indexOf("]", close + 2);
        if (labelClose !== -1 && labelClose < end && !source.slice(close + 2, labelClose).includes("[")) {
          push(base, flushedTo, i + 1);
          inline(i + 1, close, "type", false);
          push(base, close, close + 1);
          push("type", close + 1, labelClose + 1);
          flushedTo = i = labelClose + 1;
          return;
        }
      }
      i++; // just a pair of square brackets, keep reading inside them
    }

    /** *em*, _em_, **bold**, __bold__ and ***both***, only when closed on the same line. */
    function tryEmphasis(): void {
      const mark = source[i]!;
      const run = runLength(i, end);
      const next = source[i + run];
      const prev = i > start ? source[i - 1] : undefined;
      // The opener must touch a word on its right. An underscore inside a word (snake_case) is not emphasis.
      if (run > 3 || i + run >= end || isSpace(next) || (mark === "_" && isWordChar(prev))) {
        i += run;
        return;
      }
      const limit = Math.min(end, i + run + MAX_SPAN_CHARS);
      let j = i + run;
      while (j < limit) {
        const c = source[j]!;
        if (c === "\\") {
          j += 2;
        } else if (c === "`") {
          const codeRun = runLength(j, end);
          const codeEnd = findCodeClose(j + codeRun, codeRun, end);
          j = codeEnd === -1 ? j + codeRun : codeEnd;
        } else if (c === mark) {
          const closeRun = runLength(j, end);
          const closes = closeRun === run && j > i + run && !isSpace(source[j - 1]) && (mark === "*" || !isWordChar(source[j + closeRun]));
          if (closes) {
            emit("number", i, j + closeRun);
            return;
          }
          j += closeRun;
        } else {
          j++;
        }
      }
      i += run; // never closed, so the marks are plain text
    }
  };

  /** Colours one line of text (and the lines a comment runs over). Returns where the last line ends. */
  const inlineLine = (start: number, end: number): number => {
    let lastEnd = end;
    let reached = inline(start, end, "plain", true);
    while (reached > lastEnd) {
      lastEnd = lineEnd(reached);
      reached = inline(reached, lastEnd, "plain", true);
    }
    return lastEnd;
  };

  /** The whole rest of the line as one colour, e.g. a heading. */
  const wholeLine = (kind: TokenKind, start: number, end: number): number => {
    push(kind, start, end);
    return end;
  };

  /** The fence that is open right now, with the pattern that closes it (the same mark, at least as long). */
  let fence: { closer: RegExp } | undefined;
  /** True when the line just before this one is ordinary paragraph text, so a --- or === under it is a heading underline. */
  let paragraph = false;
  let pos = 0;

  // Front matter: --- on line 1 down to the next --- or ... line.
  if (FRONT_MATTER_MARK.test(source.slice(0, lineEnd(0)))) {
    let at = lineEnd(0) + 1;
    while (at < n) {
      const end = lineEnd(at);
      if (FRONT_MATTER_END.test(source.slice(at, end))) {
        push("preprocessor", 0, lineEnd(0));
        push("plain", lineEnd(0), at);
        push("preprocessor", at, end);
        pos = end;
        if (pos < n) {
          push("plain", pos, pos + 1);
          pos++;
        }
        break;
      }
      at = end + 1;
    }
  }

  while (pos < n) {
    const start = pos;
    const end = lineEnd(start);
    const line = source.slice(start, end);
    let last = end;

    if (fence) {
      // Inside a fenced block: only a matching closing fence is special, everything else is code.
      if (fence.closer.test(line)) {
        push("preprocessor", start, end);
        fence = undefined;
      } else {
        push("string", start, end);
      }
    } else if (line.trim() === "") {
      push("plain", start, end);
      paragraph = false;
    } else {
      const width = indentWidth(line);
      const fenceMatch = width < CODE_INDENT ? FENCE_LINE.exec(line) : null;
      const listMatch = LIST_MARK.exec(line);
      if (fenceMatch && !(fenceMatch[2]![0] === "`" && fenceMatch[3]!.includes("`"))) {
        push("preprocessor", start, end);
        fence = { closer: new RegExp(`^ {0,3}${fenceMatch[2]![0]}{${fenceMatch[2]!.length},}[ \\t]*$`) };
        paragraph = false;
      } else if (width >= CODE_INDENT && !listMatch) {
        // Indented code or a list continuation. Left plain; a paragraph above it keeps going.
        push("plain", start, end);
      } else if (width < CODE_INDENT && ATX_HEADING.test(line)) {
        push("keyword", start, end);
        paragraph = false;
      } else if (width < CODE_INDENT && paragraph && SETEXT_UNDERLINE.test(line)) {
        push("keyword", start, end);
        paragraph = false;
      } else if (width < CODE_INDENT && THEMATIC_BREAK.test(line)) {
        push("preprocessor", start, end);
        paragraph = false;
      } else if (width < CODE_INDENT && QUOTE_MARK.test(line)) {
        // One or more > marks, then the text after them (a heading or normal text).
        let at = start;
        let quote = QUOTE_MARK.exec(source.slice(at, end));
        while (quote) {
          push("plain", at, at + quote[1]!.length);
          push("preprocessor", at + quote[1]!.length, at + quote[1]!.length + 1);
          push("plain", at + quote[1]!.length + 1, at + quote[0].length);
          at += quote[0].length;
          quote = QUOTE_MARK.exec(source.slice(at, end));
        }
        last = ATX_HEADING.test(source.slice(at, end)) ? wholeLine("keyword", at, end) : inlineLine(at, end);
        paragraph = false;
      } else if (listMatch) {
        // A list marker, an optional task box, then the text of the item.
        const markStart = start + listMatch[1]!.length;
        const markEnd = markStart + listMatch[2]!.length;
        push("plain", start, markStart);
        push("preprocessor", markStart, markEnd);
        let at = start + listMatch[0].length;
        push("plain", markEnd, at);
        const box = TASK_BOX.exec(source.slice(at, end));
        if (box) {
          push("preprocessor", at, at + box[0].length);
          at += box[0].length;
        }
        last = inlineLine(at, end);
        paragraph = false;
      } else if (!paragraph && width < CODE_INDENT && REFERENCE_DEFINITION.test(line)) {
        // [label]: url "optional title"
        const def = REFERENCE_DEFINITION.exec(line)!;
        let at = start;
        push("plain", at, (at += def[1]!.length));
        push("type", at, (at += def[2]!.length));
        push("plain", at, (at += def[3]!.length + def[4]!.length));
        push("string", at, (at += def[5]!.length));
        const rest = source.slice(at, end);
        if (/^[ \t]+["'(]/.test(rest)) {
          push("plain", at, at + rest.length - rest.trimStart().length);
          push("string", at + rest.length - rest.trimStart().length, end);
        } else {
          push("plain", at, end);
        }
        paragraph = false;
      } else {
        last = inlineLine(start, end);
        paragraph = !line.trimStart().startsWith("<!--");
      }
    }

    // Keep the newline itself, so the lines can be split again afterwards.
    pos = last;
    if (pos < n) {
      push("plain", pos, pos + 1);
      pos++;
    }
  }

  return builder.lines();
}
