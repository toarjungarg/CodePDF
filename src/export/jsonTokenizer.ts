// A small tokenizer for JSON syntax colouring (.json and .jsonc). Like the
// others, it labels pieces of code without changing a single character, and
// it is pattern-based, not a full parser. One tokenizer reads both kinds of
// file: plain JSON never has comments, so always allowing them costs nothing.
// The JSON-specific parts:
//   - A string uses double quotes and backslash escapes ("a\"b", "\\", "\n").
//     JSON strings cannot run over lines, so a string with no closing quote
//     stops at the end of its line instead of colouring the rest of the file.
//   - A string followed by a : (on the same line, spaces allowed) is an object
//     key and is coloured as a type. Any other string is a normal string value.
//   - Numbers: -1, 0.5, 1e10, 1.2E-3, -0.
//   - true, false and null are coloured as keywords.
//   - // comments run to the end of the line and /* */ comments can span lines
//     (these only show up in .jsonc files, like tsconfig.json). A // inside a
//     string, like "http://x", is part of the string, not a comment.
//   - Brackets, braces, commas and colons have no colour of their own, so they are plain.
//   - Anything that is not valid JSON (single quotes, bare words) is plain text. It never throws.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** The three words JSON allows besides strings and numbers. */
const LITERALS = new Set(["true", "false", "null"]);

/** A number: optional minus, digits, optional fraction, optional exponent. */
const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

function isIdentPart(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
}

export function tokenizeJson(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;
  let i = 0;

  /** Where a string that starts at `start` ends (after the closing quote, or at the line break if it is never closed), and whether it was closed. */
  const stringEnd = (start: number): { end: number; closed: boolean } => {
    let j = start + 1;
    while (j < n) {
      const ch = source[j]!;
      if (ch === "\n" || ch === "\r") {
        return { end: j, closed: false };
      }
      if (ch === "\\") {
        // A backslash and the character after it go together, so \" does not end the string.
        j += source[j + 1] === undefined || source[j + 1] === "\n" || source[j + 1] === "\r" ? 1 : 2;
        continue;
      }
      if (ch === '"') {
        return { end: j + 1, closed: true };
      }
      j++;
    }
    return { end: n, closed: false };
  };

  while (i < n) {
    const ch = source[i]!;

    // Line comment: runs to the end of the line.
    if (ch === "/" && source[i + 1] === "/") {
      let end = source.indexOf("\n", i);
      end = end === -1 ? n : end;
      push("comment", i, end);
      i = end;
      continue;
    }

    // Block comment: runs to */ and can span lines. With no */ it runs to the end of the file.
    if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      push("comment", i, end);
      i = end;
      continue;
    }

    if (ch === '"') {
      const { end, closed } = stringEnd(i);
      // Look past spaces and tabs for a colon. If one follows, this string is a key.
      let look = end;
      while (source[look] === " " || source[look] === "\t") {
        look++;
      }
      push(closed && source[look] === ":" ? "type" : "string", i, end);
      i = end;
      continue;
    }

    // A word: true, false and null are keywords. Any other word is not valid JSON, so it stays plain.
    // The whole word is read at once so abc123 is not split into a word and a number.
    if (/[A-Za-z_$]/.test(ch)) {
      let end = i + 1;
      while (isIdentPart(source[end])) {
        end++;
      }
      push(LITERALS.has(source.slice(i, end)) ? "keyword" : "plain", i, end);
      i = end;
      continue;
    }

    if ((ch >= "0" && ch <= "9") || (ch === "-" && source[i + 1] !== undefined && source[i + 1]! >= "0" && source[i + 1]! <= "9")) {
      NUMBER.lastIndex = i;
      const match = NUMBER.exec(source);
      let end = match ? i + match[0].length : i + 1;
      // A number with letters stuck to it (12ab) is not valid, so the whole run is plain.
      if (isIdentPart(source[end])) {
        while (isIdentPart(source[end])) {
          end++;
        }
        push("plain", i, end);
      } else {
        push("number", i, end);
      }
      i = end;
      continue;
    }

    // Anything else (spaces, brackets, braces, commas, colons, stray characters) is plain.
    // A letter outside the basic range, like é, is one code unit or a pair, and plain tokens merge anyway.
    push("plain", i, i + 1);
    i++;
  }

  return builder.lines();
}
