// A small tokenizer for Go syntax colouring. Like the others, it labels
// pieces of code without changing a single character, and it is
// pattern-based, not a full parser.
// The Go-specific parts: raw strings (`...`) can span lines and have no
// escapes, block comments do not nest, runes ('a', '\n') are coloured like
// strings, numbers can end in i (imaginary) or be hex floats (0x1p-2), and
// the predeclared names (int, error, nil, len, ...) get colours when they are
// used as those built-ins and not as a field or a variable you made up.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** All 25 Go keywords. */
const KEYWORDS = new Set([
  "break", "case", "chan", "const", "continue", "default", "defer", "else", "fallthrough", "for", "func",
  "go", "goto", "if", "import", "interface", "map", "package", "range", "return", "select", "struct",
  "switch", "type", "var",
]);

/** Predeclared types, coloured as types. */
const BUILT_IN_TYPES = new Set([
  "any", "bool", "byte", "comparable", "complex64", "complex128", "error", "float32", "float64", "int",
  "int8", "int16", "int32", "int64", "rune", "string", "uint", "uint8", "uint16", "uint32", "uint64",
  "uintptr",
]);

/** Predeclared constants and the zero value, coloured like keywords (the same way C# colours true and null). */
const BUILT_IN_CONSTANTS = new Set(["true", "false", "nil", "iota"]);

/** Predeclared functions. Only coloured when they are called, since `max := 3` makes a variable. */
const BUILT_IN_FUNCTIONS = new Set([
  "append", "cap", "clear", "close", "complex", "copy", "delete", "imag", "len", "make", "max", "min",
  "new", "panic", "print", "println", "real", "recover",
]);

const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}\p{M}_]/u;

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
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v";
}

function identEnd(src: string, i: number): number {
  let j = i;
  while (j < src.length && isIdentPart(src[j])) {
    j++;
  }
  return j;
}

/** The first index at or after i that isn't a space or tab, on the same line. */
function skipInlineSpace(src: string, i: number): number {
  let j = i;
  while (j < src.length && isInlineSpace(src[j])) {
    j++;
  }
  return j;
}

/** End of a "..." string or '...' rune whose quote is at i. A backslash skips the next character. Stops at a newline. */
function quotedEnd(src: string, i: number): number {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "\\" && src[j + 1] !== "\n" && j + 1 < src.length) {
      j += 2;
      continue;
    }
    if (ch === quote) {
      return j + 1;
    }
    if (ch === "\n") {
      return j;
    }
    j++;
  }
  return src.length;
}

/** End of a `raw string` whose backtick is at i. It can span lines, and an unclosed one runs to the end of the file. */
function rawStringEnd(src: string, i: number): number {
  const close = src.indexOf("`", i + 1);
  return close === -1 ? src.length : close + 1;
}

/**
 * End of a number: 42, 1_000, 0xFF, 0o17, 017, 0b1010, 3.14, .5, 1.5e-3, 0x1p-2, 3i, 1.5i.
 * The exponent sign (+ or -) is part of the number only after e (decimal) or p (hex).
 */
function numberEnd(src: string, i: number): number {
  const hex = src[i] === "0" && /[xX]/.test(src[i + 1] ?? "");
  let j = src[i] === "." ? i + 2 : i + 1;
  let seenDot = src[i] === ".";
  const exponent = hex ? /[pP]/ : /[eE]/;
  while (j < src.length) {
    const ch = src[j]!;
    if (/[A-Za-z0-9_]/.test(ch)) {
      j++;
    } else if (ch === "." && !seenDot && src[j + 1] !== ".") {
      seenDot = true;
      j++;
    } else if ((ch === "+" || ch === "-") && exponent.test(src[j - 1] ?? "") && isDigit(src[j + 1])) {
      j++;
    } else {
      break;
    }
  }
  return j;
}

/**
 * The names this file declares with `type`: `type Pantry struct`, `type Grams int`,
 * and the names inside a `type ( ... )` group. They are coloured as types wherever they are used.
 */
function declaredTypes(source: string): Set<string> {
  const names = new Set<string>();
  const single = /^[ \t]*type[ \t]+([\p{L}_][\p{L}\p{N}_]*)/u;
  const inGroup = /^[ \t]+([\p{L}_][\p{L}\p{N}_]*)/u;
  let group = false;
  // How many { are still open inside the group. A name only counts at depth 0,
  // so the fields of a struct or the methods of an interface are skipped.
  let depth = 0;
  for (const line of source.split("\n")) {
    if (group) {
      if (depth === 0 && /^\)/.test(line)) {
        group = false;
      } else {
        const match = depth === 0 ? inGroup.exec(line) : null;
        if (match) {
          names.add(match[1]!);
        }
        // Count braces, ignoring ones inside strings, runes and // comments.
        const bare = line.replace(/\/\/.*$/, "").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`/g, "");
        depth = Math.max(0, depth + (bare.match(/\{/g)?.length ?? 0) - (bare.match(/\}/g)?.length ?? 0));
      }
    } else if (/^[ \t]*type[ \t]*\(/.test(line)) {
      group = true;
    } else {
      const match = single.exec(line);
      if (match) {
        names.add(match[1]!);
      }
    }
  }
  return names;
}

/**
 * Splits Go source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizeGo(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;
  const ownTypes = declaredTypes(source);
  let i = 0;
  // The last character and word of real code (spaces and comments don't count).
  // A name right after a dot is a field or method, never a built-in.
  let lastChar = "";
  let lastWord = "";

  const code = (kind: TokenKind, start: number, end: number): void => {
    push(kind, start, end);
    lastChar = source[end - 1] ?? lastChar;
    lastWord = "";
  };

  while (i < n) {
    const ch = source[i];

    if (ch === "\n" || isInlineSpace(ch)) {
      let j = i + 1;
      while (j < n && (source[j] === "\n" || isInlineSpace(source[j]))) {
        j++;
      }
      push("plain", i, j);
      i = j;
      continue;
    }

    // A comment check comes before the operators, so a lone / (division) falls through to the operator case.
    if (ch === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      push("comment", i, end);
      i = end;
      continue;
    }

    if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      push("comment", i, end);
      i = end;
      continue;
    }

    if (isIdentStart(ch)) {
      const j = identEnd(source, i);
      const word = source.slice(i, j);
      const afterDot = lastChar === ".";
      let kind: TokenKind = "plain";
      if (KEYWORDS.has(word) && !afterDot) {
        kind = "keyword";
      } else if (!afterDot && (BUILT_IN_TYPES.has(word) || ownTypes.has(word))) {
        kind = "type";
      } else if (!afterDot && BUILT_IN_CONSTANTS.has(word)) {
        kind = "keyword";
      } else if (!afterDot && BUILT_IN_FUNCTIONS.has(word) && lastWord !== "func" && source[skipInlineSpace(source, j)] === "(") {
        kind = "keyword";
      }
      push(kind, i, j);
      lastChar = source[j - 1]!;
      lastWord = word;
      i = j;
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(source[i + 1]) && source[i - 1] !== ".")) {
      const end = numberEnd(source, i);
      code("number", i, end);
      i = end;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const end = quotedEnd(source, i);
      code("string", i, end);
      i = end;
      continue;
    }

    if (ch === "`") {
      const end = rawStringEnd(source, i);
      code("string", i, end);
      i = end;
      continue;
    }

    // Operators and punctuation (:=, <-, &^, &^=, ...), one character at a time.
    // They are all plain, so they merge into one token. Takes a surrogate pair as one character.
    const codePoint = source.codePointAt(i) ?? 0;
    const length = codePoint > 0xffff ? 2 : 1;
    code("plain", i, i + length);
    i += length;
  }

  return builder.lines();
}
