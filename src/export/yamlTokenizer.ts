// A small tokenizer for YAML syntax colouring (.yml and .yaml). Like the
// others, it labels pieces of code without changing a single character, and
// it is pattern-based, not a full parser. It reads the file one character at
// a time and only remembers a few things between lines (see the variables in
// tokenizeYaml). The YAML-specific parts:
//   - A # starts a comment only at the start of a line or after a space or tab.
//     So a#b and url: http://x#frag have no comment, and a # inside quotes is text.
//   - A key is coloured as a type. A key is a plain word or a quoted string
//     followed by a colon and then a space or the end of the line, so the colon
//     in http://x does not make a key. Keys after "- " in a list work too.
//   - 'single quoted' strings have no backslash escapes ('' is one quote) and
//     "double quoted" strings do. Both can run over several lines.
//   - Block scalars (| and >, with optional modifiers like |- >+ |2): every
//     line indented deeper than the line that has the | is plain string text,
//     so a # in there is not a comment.
//   - Document markers (--- and ...), directives (%YAML) and tags (!tag, !!str)
//     are coloured as preprocessor. Anchors (&name) and aliases (*name) are keywords.
//   - Plain values: true, false, null and ~ are keywords (also True, TRUE and so on),
//     numbers (12, -1.5, 1e3, 0x1F, 0o17, .inf, .nan) are numbers, and anything
//     else is plain.
//   - Flow collections like {a: 1, b: [x, y]} work, including over several lines.
//   - Anything unusual stays plain, and it never throws.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/**
 * A quoted string can run over lines, but a stray quote must not colour the whole
 * rest of the file. If no closing quote shows up within this many lines, the
 * string is cut off at the end of its first line.
 */
const MAX_QUOTED_LINES = 100;

/** The plain words that are coloured as keywords. */
const KEYWORDS = new Set(["true", "True", "TRUE", "false", "False", "FALSE", "null", "Null", "NULL", "~"]);

/** A whole plain value that is a number: ints, floats, 0x hex, 0o octal, .inf and .nan. */
const NUMBER = /^(?:[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;

/**
 * The start of a block scalar: | or > and an optional modifier (a - or + and/or a digit
 * 1 to 9, in either order). It only counts if the rest of the line is empty or a comment.
 */
const BLOCK_HEADER = /[|>](?:[+-][1-9]?|[1-9][+-]?)?(?=[ \t\r]*(?:\n|$)|[ \t]+#)/y;

/** Characters that end an anchor, alias or tag name (and plain values inside {} and []). */
const FLOW_CHARS = ",[]{}";

const isWs = (ch: string | undefined): boolean => ch === " " || ch === "\t" || ch === "\r" || ch === "\n";

/** True for a space, tab, line break or the end of the file. */
const isSpaceOrEnd = (ch: string | undefined): boolean => ch === undefined || isWs(ch);

export function tokenizeYaml(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;
  let i = 0;

  /** Where the current line starts. */
  let lineStart = 0;
  /** How many { and [ are open. Inside them, commas and brackets end plain values. */
  let flowDepth = 0;
  /** The column of the thing that owns a block scalar on this line (the key, or the "-"). Its lines must be indented deeper than this. */
  let blockParent = -1;
  /** True right after a line that ended with a | or > header, so the next lines are scalar text. */
  let blockPending = false;

  const lineEnd = (pos: number): number => {
    const end = source.indexOf("\n", pos);
    return end === -1 ? n : end;
  };

  /** How many spaces and tabs the line starting at pos begins with. */
  const indentOf = (pos: number): number => {
    let j = pos;
    while (source[j] === " " || source[j] === "\t") {
      j++;
    }
    return j - pos;
  };

  /** A line that has nothing but spaces, tabs and a carriage return. */
  const isBlank = (pos: number): boolean => {
    const end = lineEnd(pos);
    for (let j = pos; j < end; j++) {
      if (source[j] !== " " && source[j] !== "\t" && source[j] !== "\r") {
        return false;
      }
    }
    return true;
  };

  /** --- or ... at the very start of a line, followed by a space or the end of the line. */
  const isDocumentMarker = (pos: number): boolean => (source.startsWith("---", pos) || source.startsWith("...", pos)) && isSpaceOrEnd(source[pos + 3]);

  /** Where a quoted string that starts at `start` ends, and whether a closing quote was found. */
  const quotedEnd = (start: number, quote: string): { end: number; closed: boolean } => {
    let j = start + 1;
    let lines = 0;
    while (j < n) {
      const ch = source[j]!;
      if (ch === "\n") {
        lines++;
        if (lines > MAX_QUOTED_LINES) {
          break;
        }
      } else if (ch === "\\" && quote === '"') {
        // A backslash and the character after it go together, so \" does not end the string.
        if (source[j + 1] === "\n") {
          lines++;
        }
        j += 2;
        continue;
      } else if (ch === quote) {
        if (quote === "'" && source[j + 1] === "'") {
          // '' is one quote inside a single quoted string.
          j += 2;
          continue;
        }
        return { end: j + 1, closed: true };
      }
      j++;
    }
    // No closing quote: colour only the first line, so the rest of the file is read normally.
    return { end: lineEnd(start), closed: false };
  };

  /** Runs at the start of every line (and at the start of the file). It may move `i` forward. */
  const startLine = (): void => {
    // The lines after a | or > header are text until one is indented back to the parent or less.
    if (blockPending) {
      blockPending = false;
      let pos = lineStart;
      while (pos < n) {
        if (!isBlank(pos) && (isDocumentMarker(pos) || indentOf(pos) <= blockParent)) {
          break;
        }
        pos = Math.min(lineEnd(pos) + 1, n);
      }
      push("string", lineStart, pos);
      lineStart = pos;
      i = pos;
      if (pos >= n) {
        return;
      }
    }

    if (isDocumentMarker(lineStart)) {
      push("preprocessor", lineStart, lineStart + 3);
      i = lineStart + 3;
      // A new document starts clean, so a bracket left open in the last one cannot carry over.
      flowDepth = 0;
      blockParent = -1;
      return;
    }

    // A directive like %YAML 1.2 is the whole line, up to a comment if there is one.
    if (source[lineStart] === "%" && flowDepth === 0) {
      let end = lineStart + 1;
      while (end < n && source[end] !== "\n" && !(source[end] === "#" && isWs(source[end - 1]))) {
        end++;
      }
      while (end > lineStart && isWs(source[end - 1])) {
        end--;
      }
      push("preprocessor", lineStart, end);
      i = end;
      blockParent = -1;
      return;
    }

    // With nothing else to go on, a block scalar on this line must be indented deeper than the line itself.
    blockParent = indentOf(lineStart) - 1;
  };

  // A byte order mark at the very start is not part of the first word.
  if (source[0] === "﻿") {
    push("plain", 0, 1);
    i = 1;
    lineStart = 1;
  }
  startLine();

  while (i < n) {
    const ch = source[i]!;

    if (ch === "\n") {
      push("plain", i, i + 1);
      i++;
      lineStart = i;
      startLine();
      continue;
    }

    if (ch === " " || ch === "\t" || ch === "\r") {
      push("plain", i, i + 1);
      i++;
      continue;
    }

    // Comment: only at the start of a line or after whitespace, and it runs to the end of the line.
    if (ch === "#" && (i === 0 || isWs(source[i - 1]))) {
      const end = lineEnd(i);
      push("comment", i, end);
      i = end;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const { end, closed } = quotedEnd(i, ch);
      // A quoted string on one line, followed by a colon, is a key.
      let look = end;
      while (source[look] === " " || source[look] === "\t") {
        look++;
      }
      const sameLine = !source.slice(i, end).includes("\n");
      const isKey = closed && sameLine && source[look] === ":" && (isSpaceOrEnd(source[look + 1]) || flowDepth > 0);
      push(isKey ? "type" : "string", i, end);
      if (isKey && flowDepth === 0) {
        blockParent = i - lineStart;
      }
      i = end;
      continue;
    }

    // "- " starts a list item. Its column is what a block scalar after it must be indented past.
    // "? " starts a complex key, which is just left plain.
    if ((ch === "-" || ch === "?") && isSpaceOrEnd(source[i + 1])) {
      push("plain", i, i + 1);
      if (ch === "-" && flowDepth === 0) {
        blockParent = i - lineStart;
      }
      i++;
      continue;
    }

    // Anchors (&name) and aliases (*name). A lone & or * with no name is plain.
    if (ch === "&" || ch === "*") {
      let end = i + 1;
      while (end < n && !isSpaceOrEnd(source[end]) && !FLOW_CHARS.includes(source[end]!)) {
        end++;
      }
      push(end > i + 1 ? "keyword" : "plain", i, end);
      i = end;
      continue;
    }

    // Tags: !tag, !!str, ! on its own and !<verbatim form>.
    if (ch === "!") {
      let end = i + 1;
      if (source[end] === "<") {
        while (end < n && source[end] !== ">" && source[end] !== "\n") {
          end++;
        }
        end = source[end] === ">" ? end + 1 : end;
      } else {
        while (end < n && !isSpaceOrEnd(source[end]) && !FLOW_CHARS.includes(source[end]!)) {
          end++;
        }
      }
      push("preprocessor", i, end);
      i = end;
      continue;
    }

    // A | or > that ends its line (or is followed by a comment) starts a block scalar.
    if ((ch === "|" || ch === ">") && flowDepth === 0) {
      BLOCK_HEADER.lastIndex = i;
      const match = BLOCK_HEADER.exec(source);
      if (match) {
        push("string", i, i + match[0].length);
        i += match[0].length;
        blockPending = true;
        continue;
      }
    }

    if (ch === "{" || ch === "[") {
      flowDepth++;
      push("plain", i, i + 1);
      i++;
      continue;
    }
    if ((ch === "}" || ch === "]" || ch === ",") && flowDepth > 0) {
      if (ch !== ",") {
        flowDepth--;
      }
      push("plain", i, i + 1);
      i++;
      continue;
    }

    // A colon that is not part of a word (after a quoted key, or an empty key) is plain.
    if (ch === ":" && (isSpaceOrEnd(source[i + 1]) || flowDepth > 0)) {
      push("plain", i, i + 1);
      i++;
      continue;
    }

    // Everything else is a plain value or a plain key. Read it up to the end of the line,
    // a " #" comment, a colon followed by a space, or (inside {} and []) a comma or bracket.
    let end = i + 1;
    let endsAtColon = false;
    while (end < n && source[end] !== "\n") {
      const c = source[end]!;
      if (c === "#" && isWs(source[end - 1])) {
        break;
      }
      if (c === ":" && (isSpaceOrEnd(source[end + 1]) || (flowDepth > 0 && FLOW_CHARS.includes(source[end + 1]!)))) {
        endsAtColon = true;
        break;
      }
      if (flowDepth > 0 && FLOW_CHARS.includes(c)) {
        break;
      }
      end++;
    }
    // The spaces before a comment or a colon are not part of the value.
    let textEnd = end;
    while (textEnd > i + 1 && isWs(source[textEnd - 1])) {
      textEnd--;
    }
    const text = source.slice(i, textEnd);
    let kind: TokenKind = "plain";
    if (endsAtColon) {
      kind = "type";
      if (flowDepth === 0) {
        blockParent = i - lineStart;
      }
    } else if (KEYWORDS.has(text)) {
      kind = "keyword";
    } else if (NUMBER.test(text)) {
      kind = "number";
    }
    push(kind, i, textEnd);
    push("plain", textEnd, end);
    i = end;
  }

  return builder.lines();
}
