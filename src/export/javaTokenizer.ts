// A small tokenizer for Java syntax colouring. Like the others, it labels
// pieces of code without changing a single character, and it is
// pattern-based, not a full parser.
// The Java-specific parts: text blocks ("""...""") span lines, annotations
// (@Override) get their own colour, words like var and record are only
// keywords where they're used as keywords, and names that start with a
// capital letter are coloured as types, following Java's naming convention.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

const KEYWORDS = new Set([
  "abstract", "assert", "break", "case", "catch", "class", "const", "continue", "default", "do", "else",
  "enum", "extends", "final", "finally", "for", "goto", "if", "implements", "import", "instanceof",
  "interface", "native", "new", "package", "private", "protected", "public", "return", "static",
  "strictfp", "super", "switch", "synchronized", "this", "throw", "throws", "transient", "try", "volatile",
  "while", "true", "false", "null",
  // Built-in types are coloured like keywords, as in VS Code's default theme.
  "boolean", "byte", "char", "double", "float", "int", "long", "short", "void",
]);

/**
 * Words that are keywords only in some places and ordinary names everywhere
 * else (`int var = 1;` is legal Java). They're coloured as keywords when a
 * name, number or quote follows on the same line (`var total`, `record Point`,
 * `yield 0`, `permits Circle`, `when r > 0`).
 */
const CONTEXTUAL_KEYWORDS = new Set(["var", "record", "yield", "sealed", "permits", "when"]);

const IDENT_START = /[\p{L}_$]/u;
const IDENT_PART = /[\p{L}\p{N}_$]/u;
const LOWERCASE = /\p{Ll}/u;
const UPPERCASE_START = /^\p{Lu}/u;

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
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\f";
}

function identEnd(src: string, i: number): number {
  let j = i;
  while (j < src.length && isIdentPart(src[j])) {
    j++;
  }
  return j;
}

/** A type name by convention: starts with a capital and has a lowercase letter (String, T, ArrayList), unlike a CONSTANT. */
function looksLikeType(word: string): boolean {
  return UPPERCASE_START.test(word) && (word.length === 1 || LOWERCASE.test(word));
}

/** End of a "..." or '...' literal whose quote is at i. Stops at an unescaped newline. */
function quotedEnd(src: string, i: number): number {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "\\") {
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

/** End of a text block """...""" whose first quote is at i. Escapes (\""") are skipped; an unclosed one runs to the end. */
function textBlockEnd(src: string, i: number): number {
  let j = i + 3;
  while (j < src.length) {
    if (src[j] === "\\") {
      j += 2;
    } else if (src.startsWith('"""', j)) {
      return j + 3;
    } else {
      j++;
    }
  }
  return src.length;
}

/** End of a number: 42, 1_000, 0xFF, 0b1010, 3.14, .5, 1e-9, 2.5f, 10L, 0x1.8p3. */
function numberEnd(src: string, i: number): number {
  const hex = src[i] === "0" && /[xX]/.test(src[i + 1] ?? "");
  let j = src[i] === "." ? i + 2 : i + 1;
  while (j < src.length) {
    const ch = src[j]!;
    if (/[A-Za-z0-9_]/.test(ch)) {
      j++;
    } else if (ch === "." && !isIdentStart(src[j + 1])) {
      j++;
    } else if ((ch === "+" || ch === "-") && (hex ? /[pP]/ : /[eE]/).test(src[j - 1] ?? "") && isDigit(src[j + 1])) {
      j++;
    } else {
      break;
    }
  }
  return j;
}

/** The first character after i that isn't a space or tab, on the same line. */
function nextOnLine(src: string, i: number): string | undefined {
  let j = i;
  while (j < src.length && isInlineSpace(src[j])) {
    j++;
  }
  return src[j];
}

/**
 * Splits Java source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizeJava(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;
  let i = 0;

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

    if (ch === "@" && isIdentStart(source[i + 1])) {
      let end = identEnd(source, i + 1);
      if (source.slice(i + 1, end) === "interface") {
        // @interface declares an annotation type.
        push("keyword", i, end);
        i = end;
        continue;
      }
      // A qualified annotation like @java.lang.Override is one piece.
      while (source[end] === "." && isIdentStart(source[end + 1])) {
        end = identEnd(source, end + 1);
      }
      push("preprocessor", i, end);
      i = end;
      continue;
    }

    if (isIdentStart(ch)) {
      const j = identEnd(source, i);
      const word = source.slice(i, j);
      if (word === "non" && source.startsWith("-sealed", j) && !isIdentPart(source[j + 7])) {
        push("keyword", i, j + 7);
        i = j + 7;
        continue;
      }
      let kind: TokenKind = "plain";
      if (KEYWORDS.has(word)) {
        kind = "keyword";
      } else if (CONTEXTUAL_KEYWORDS.has(word)) {
        const next = nextOnLine(source, j);
        if (isIdentStart(next) || isDigit(next) || next === '"' || next === "'") {
          kind = "keyword";
        }
      } else if (looksLikeType(word)) {
        kind = "type";
      }
      push(kind, i, j);
      i = j;
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(source[i + 1]))) {
      const end = numberEnd(source, i);
      push("number", i, end);
      i = end;
      continue;
    }

    if (ch === '"' && source.startsWith('"""', i)) {
      const end = textBlockEnd(source, i);
      push("string", i, end);
      i = end;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const end = quotedEnd(source, i);
      push("string", i, end);
      i = end;
      continue;
    }

    // Operators, punctuation and anything else: one character (or one surrogate pair).
    const codePoint = source.codePointAt(i) ?? 0;
    const length = codePoint > 0xffff ? 2 : 1;
    push("plain", i, i + length);
    i += length;
  }

  return builder.lines();
}
