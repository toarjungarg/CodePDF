// A small tokenizer for Python syntax colouring. Like the C and C++ one, it
// labels pieces of code (keyword, string, comment, number, decorator, plain)
// without changing a single character: joining every token's text gives back
// the original. It is pattern-based, not a full parser.
// The Python-specific parts are # comments, triple-quoted strings, string
// prefixes (r, b, f, ...), f-strings (the code inside {...} is coloured as
// code), @decorators and the soft keywords match, case and type.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

const KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def",
  "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda",
  "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
]);

/** Built-in type names, coloured as types (unless they follow a dot, as in `np.float`). */
const BUILTIN_TYPES = new Set([
  "bool", "bytearray", "bytes", "complex", "dict", "float", "frozenset", "int", "list", "object", "set",
  "str", "tuple", "type",
]);

/** Letters allowed before a string's opening quote, in lower case (Python accepts any mix of cases). */
const STRING_PREFIXES = new Set(["r", "u", "b", "br", "rb", "f", "fr", "rf", "t", "tr", "rt"]);

/** A number: 0xFF, 0b1010, 0o17, 1_000, 3.14e-2, .5, 2j. The "y" flag makes it match only at lastIndex. */
const NUMBER =
  /0[xX](?:_?[0-9a-fA-F])+|0[bB](?:_?[01])+|0[oO](?:_?[0-7])+|(?:\d(?:_?\d)*\.?(?:\d(?:_?\d)*)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?[jJ]?/y;

/** `type Name = ...` or `type Name[T] = ...`, checked on the text after the word `type`. */
const TYPE_ALIAS_REST = /^[ \t]+[\p{L}_][\p{L}\p{N}_]*[ \t]*[=[]/u;

const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}_]/u;

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string | undefined): boolean {
  return ch !== undefined && IDENT_START.test(ch);
}

function isIdentPart(ch: string | undefined): boolean {
  return ch !== undefined && IDENT_PART.test(ch);
}

function isInlineSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\v" || ch === "\f" || ch === "\r";
}

/** 3 for a triple quote (""" or ''') at index i, otherwise 1. */
function quoteLength(src: string, i: number): number {
  return src[i + 1] === src[i] && src[i + 2] === src[i] ? 3 : 1;
}

/**
 * End of the string whose opening quote is at index i, never going past `limit`.
 * A triple-quoted string runs across lines; a single-quoted one stops at an unescaped newline.
 */
function stringEnd(src: string, i: number, limit: number): number {
  const length = quoteLength(src, i);
  const closing = src[i]!.repeat(length);
  let j = i + length;
  while (j < limit) {
    const ch = src[j];
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === "\n" && length === 1) {
      return j;
    }
    if (src.startsWith(closing, j)) {
      return Math.min(j + length, limit);
    }
    j++;
  }
  return limit;
}

/**
 * Finds the end of an f-string field that opens with the "{" at index `open`.
 * Returns where the expression ends (at a "!r" conversion, a ":" format spec or
 * the closing brace) and where the closing brace is, or undefined if the field never closes.
 */
function fieldEnd(src: string, open: number, singleLine: boolean, limit: number): { exprEnd: number; close: number } | undefined {
  let depth = 0;
  let exprEnd = -1;
  let j = open + 1;
  while (j < limit) {
    const ch = src[j]!;
    if (ch === "\n" && singleLine) {
      return undefined;
    }
    if (exprEnd === -1) {
      if (ch === '"' || ch === "'") {
        j = stringEnd(src, j, limit);
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") {
        depth++;
      } else if (ch === ")" || ch === "]") {
        depth = Math.max(0, depth - 1);
      } else if (ch === "}") {
        if (depth === 0) {
          return { exprEnd: j, close: j };
        }
        depth--;
      } else if (depth === 0 && (ch === ":" || (ch === "!" && src[j + 1] !== "="))) {
        exprEnd = j; // the rest, up to the closing brace, is the conversion or format spec
      }
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      if (depth === 0) {
        return { exprEnd, close: j };
      }
      depth--;
    }
    j++;
  }
  return undefined;
}

/**
 * Whether `match` or `case` at the start of a line is the keyword (as in
 * `match command:`) and not an ordinary name (as in `match = pattern.search(s)`).
 * `rest` is the line's text after the word.
 */
function looksLikeMatchStatement(rest: string): boolean {
  const after = rest.trimStart();
  if (after === "" || "=.,)]:;".includes(after[0]!)) {
    return false;
  }
  return rest.trimEnd().endsWith(":") || /:\s*#.*$/.test(rest);
}

/**
 * Splits Python source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizePython(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;

  const previousIsDot = (i: number): boolean => {
    let j = i - 1;
    while (j >= 0 && (source[j] === " " || source[j] === "\t")) {
      j--;
    }
    return source[j] === ".";
  };

  const kindOfWord = (word: string, start: number, end: number, firstOnLine: boolean): TokenKind => {
    if (KEYWORDS.has(word)) {
      return "keyword";
    }
    if (firstOnLine && (word === "match" || word === "case" || word === "type")) {
      const newline = source.indexOf("\n", end);
      const rest = source.slice(end, newline === -1 ? n : newline);
      if (word === "type" ? TYPE_ALIAS_REST.test(rest) : looksLikeMatchStatement(rest)) {
        return "keyword";
      }
    }
    return BUILTIN_TYPES.has(word) && !previousIsDot(start) ? "type" : "plain";
  };

  /**
   * Colours an f-string that starts at `start` (its prefix letters) with its opening quote at `quoteAt`.
   * The text is a string; the code inside each {...} is coloured as code. Returns where the string ends.
   */
  const fString = (start: number, quoteAt: number, limit: number, raw: boolean): number => {
    const length = quoteLength(source, quoteAt);
    const closing = source[quoteAt]!.repeat(length);
    let textStart = start;
    let j = quoteAt + length;
    while (j < limit) {
      const ch = source[j];
      if (ch === "\\") {
        // In a raw f-string a backslash doesn't hide a brace: rf"\d{count}" still has a field.
        j += raw && source[j + 1] === "{" ? 1 : 2;
        continue;
      }
      if (ch === "\n" && length === 1) {
        break;
      }
      if (source.startsWith(closing, j)) {
        j += length;
        break;
      }
      if (ch === "{" && source[j + 1] === "{") {
        j += 2; // {{ is a literal brace
        continue;
      }
      if (ch === "{") {
        const field = fieldEnd(source, j, length === 1, limit);
        if (field) {
          push("string", textStart, j);
          push("plain", j, j + 1);
          scan(j + 1, field.exprEnd, false);
          push("string", field.exprEnd, field.close);
          push("plain", field.close, field.close + 1);
          j = field.close + 1;
          textStart = j;
          continue;
        }
      }
      j++;
    }
    const end = Math.min(j, limit);
    push("string", textStart, end);
    return end;
  };

  /** Colours source[start..end). `topLevel` is false for the code inside an f-string field. */
  const scan = (start: number, end: number, topLevel: boolean): void => {
    let i = start;
    let lineStart = topLevel; // true while only spaces have been seen on the current line
    let depth = 0; // how many ( [ { are open, so a line inside brackets isn't taken for a new statement

    while (i < end) {
      const ch = source[i]!;

      if (ch === "\n") {
        push("plain", i, i + 1);
        i++;
        lineStart = topLevel;
        continue;
      }

      if (isInlineSpace(ch)) {
        let j = i + 1;
        while (j < end && isInlineSpace(source[j])) {
          j++;
        }
        push("plain", i, j);
        i = j;
        continue;
      }

      if (ch === "#") {
        const newline = source.indexOf("\n", i);
        const stop = newline === -1 || newline > end ? end : newline;
        push("comment", i, stop);
        i = stop;
        continue;
      }

      const firstOnLine = lineStart && depth === 0;
      lineStart = false;

      // A decorator: @name or @package.name at the start of a line. (Elsewhere @ is the matrix operator.)
      if (ch === "@" && firstOnLine && isIdentStart(source[i + 1])) {
        let j = i + 1;
        while (j < end && (isIdentPart(source[j]) || source[j] === ".")) {
          j++;
        }
        push("preprocessor", i, j);
        i = j;
        continue;
      }

      if (isIdentStart(ch)) {
        let j = i + 1;
        while (j < end && isIdentPart(source[j])) {
          j++;
        }
        const word = source.slice(i, j);
        const next = j < end ? source[j] : undefined;
        const prefix = word.toLowerCase();
        if ((next === '"' || next === "'") && STRING_PREFIXES.has(prefix)) {
          if (prefix.includes("f") || prefix.includes("t")) {
            i = fString(i, j, end, prefix.includes("r"));
          } else {
            const stop = stringEnd(source, j, end);
            push("string", i, stop);
            i = stop;
          }
          continue;
        }
        push(kindOfWord(word, i, j, firstOnLine), i, j);
        i = j;
        continue;
      }

      if (isDigit(ch) || (ch === "." && isDigit(source[i + 1]))) {
        NUMBER.lastIndex = i;
        const match = NUMBER.exec(source);
        const stop = Math.min(i + (match ? match[0].length : 1), end);
        push("number", i, stop);
        i = stop;
        continue;
      }

      if (ch === '"' || ch === "'") {
        const stop = stringEnd(source, i, end);
        push("string", i, stop);
        i = stop;
        continue;
      }

      if (ch === "(" || ch === "[" || ch === "{") {
        depth++;
      } else if (ch === ")" || ch === "]" || ch === "}") {
        depth = Math.max(0, depth - 1);
      }

      // Operators, punctuation and anything else: one character (or one surrogate pair).
      const codePoint = source.codePointAt(i) ?? 0;
      const length = codePoint > 0xffff && i + 1 < end ? 2 : 1;
      push("plain", i, i + length);
      i += length;
    }
  };

  scan(0, n, true);
  return builder.lines();
}
