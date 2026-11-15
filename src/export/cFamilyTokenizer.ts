// A small tokenizer for C and C++ syntax colouring. It labels pieces of code
// (keyword, string, comment, number, preprocessor, plain) without changing
// a single character: joining every token's text gives back the original.
// It is pattern-based, not a full parser, which is plenty for colouring.
// C and C++ share almost all of their syntax; the differences are the keyword
// lists and C++'s raw strings (R"(...)").

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

export type CFamilyLanguage = "c" | "cpp";

const CPP_KEYWORDS = new Set([
  "alignas", "alignof", "and", "and_eq", "asm", "auto", "bitand", "bitor", "break", "case", "catch",
  "class", "compl", "concept", "const", "consteval", "constexpr", "constinit", "const_cast", "continue",
  "co_await", "co_return", "co_yield", "decltype", "default", "delete", "do", "dynamic_cast", "else",
  "enum", "explicit", "export", "extern", "false", "final", "for", "friend", "goto", "if", "import",
  "inline", "module", "mutable", "namespace", "new", "noexcept", "not", "not_eq", "nullptr", "operator",
  "or", "or_eq", "override", "private", "protected", "public", "register", "reinterpret_cast", "requires",
  "return", "sizeof", "static", "static_assert", "static_cast", "struct", "switch", "template", "this",
  "thread_local", "throw", "true", "try", "typedef", "typeid", "typename", "union", "using", "virtual",
  "volatile", "while", "xor", "xor_eq",
  // Built-in types are coloured like keywords, as in VS Code's default theme.
  "bool", "char", "char8_t", "char16_t", "char32_t", "double", "float", "int", "long", "short", "signed",
  "unsigned", "void", "wchar_t",
]);

/** Common standard type names, coloured as types. */
const STANDARD_TYPES = [
  "size_t", "ssize_t", "ptrdiff_t", "nullptr_t", "intptr_t", "uintptr_t", "intmax_t", "uintmax_t",
  "int8_t", "int16_t", "int32_t", "int64_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t",
];
const CPP_TYPES = new Set(STANDARD_TYPES);

/**
 * C keywords up to C23. Words that are C++-only (class, new, this, template,
 * namespace, ...) are ordinary names in C, so they stay uncoloured there.
 */
const C_KEYWORDS = new Set([
  "auto", "break", "case", "const", "continue", "default", "do", "else", "enum", "extern", "for", "goto",
  "if", "inline", "register", "restrict", "return", "sizeof", "static", "struct", "switch", "typedef",
  "union", "volatile", "while",
  "_Alignas", "_Alignof", "_Atomic", "_Generic", "_Noreturn", "_Static_assert", "_Thread_local",
  // C23 keywords
  "alignas", "alignof", "constexpr", "false", "nullptr", "static_assert", "thread_local", "true",
  "typeof", "typeof_unqual",
  // Built-in types are coloured like keywords, as in VS Code's default theme.
  "bool", "char", "double", "float", "int", "long", "short", "signed", "unsigned", "void",
  "_Bool", "_BitInt", "_Complex", "_Imaginary", "_Decimal32", "_Decimal64", "_Decimal128",
]);

/** In C these come from headers (<wchar.h>, <uchar.h>, <stdio.h>), so they're types, not keywords. */
const C_TYPES = new Set([...STANDARD_TYPES, "wchar_t", "char8_t", "char16_t", "char32_t", "FILE"]);

const WORDS: Record<CFamilyLanguage, { keywords: Set<string>; types: Set<string>; rawStrings: boolean }> = {
  c: { keywords: C_KEYWORDS, types: C_TYPES, rawStrings: false },
  cpp: { keywords: CPP_KEYWORDS, types: CPP_TYPES, rawStrings: true },
};

const STRING_PREFIXES = new Set(["L", "u", "U", "u8"]);
const RAW_STRING_PREFIXES = new Set(["R", "LR", "uR", "UR", "u8R"]);
const INCLUDE_DIRECTIVES = new Set(["include", "include_next", "import"]);

const IDENT_START = /[\p{L}_$]/u;
const IDENT_PART = /[\p{L}\p{N}_$]/u;

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

/** Index of the newline that ends the line starting at i, following backslash line continuations. */
function endOfLogicalLine(src: string, i: number): number {
  let j = i;
  for (;;) {
    const nl = src.indexOf("\n", j);
    if (nl === -1) {
      return src.length;
    }
    if (nl > 0 && src[nl - 1] === "\\") {
      j = nl + 1;
      continue;
    }
    return nl;
  }
}

/** End of a "..." or '...' literal starting at the quote at index i. Stops at an unescaped newline. */
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

/** End of a raw string R"delim( ... )delim" whose opening quote is at index i. */
function rawStringEnd(src: string, i: number): number {
  const open = src.indexOf("(", i + 1);
  const delimiter = open === -1 ? "" : src.slice(i + 1, open);
  if (open === -1 || delimiter.length > 16 || /[\s()\\"]/.test(delimiter)) {
    return quotedEnd(src, i);
  }
  const closing = ")" + delimiter + '"';
  const close = src.indexOf(closing, open + 1);
  return close === -1 ? src.length : close + closing.length;
}

/** End of a preprocessing number (covers 0x1F, 1'000, 3.14e-2f, 0b1010u, ...). */
function numberEnd(src: string, i: number): number {
  let j = src[i] === "." ? i + 2 : i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (isIdentPart(ch) || ch === ".") {
      j++;
    } else if (ch === "'" && isIdentPart(src[j + 1])) {
      j += 2;
    } else if ((ch === "+" || ch === "-") && /[eEpP]/.test(src[j - 1] ?? "")) {
      j++;
    } else {
      break;
    }
  }
  return j;
}

/**
 * Splits C or C++ source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizeCFamily(source: string, language: CFamilyLanguage): TokenLine[] {
  const { keywords, types, rawStrings } = WORDS[language];
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;

  let i = 0;
  let atLineStart = true;

  while (i < n) {
    const ch = source[i];

    if (ch === "\n") {
      push("plain", i, i + 1);
      i++;
      atLineStart = true;
      continue;
    }

    if (isInlineSpace(ch)) {
      let j = i + 1;
      while (j < n && isInlineSpace(source[j])) {
        j++;
      }
      push("plain", i, j);
      i = j;
      continue;
    }

    if (ch === "/" && source[i + 1] === "/") {
      const end = endOfLogicalLine(source, i);
      push("comment", i, end);
      i = end;
      continue;
    }

    if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      push("comment", i, end);
      i = end;
      atLineStart = false;
      continue;
    }

    if (ch === "#" && atLineStart) {
      atLineStart = false;
      let j = i + 1;
      while (j < n && (source[j] === " " || source[j] === "\t")) {
        j++;
      }
      let k = j;
      while (k < n && /[A-Za-z_]/.test(source[k] ?? "")) {
        k++;
      }
      const directive = source.slice(j, k);
      push("preprocessor", i, k);
      i = k;
      if (INCLUDE_DIRECTIVES.has(directive)) {
        let m = i;
        while (m < n && (source[m] === " " || source[m] === "\t")) {
          m++;
        }
        push("plain", i, m);
        i = m;
        if (source[i] === "<") {
          const nl = endOfLogicalLine(source, i);
          const close = source.indexOf(">", i + 1);
          const end = close !== -1 && close < nl ? close + 1 : nl;
          push("string", i, end);
          i = end;
        }
      }
      continue;
    }

    atLineStart = false;

    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < n && isIdentPart(source[j])) {
        j++;
      }
      const word = source.slice(i, j);
      const next = source[j];
      if (rawStrings && next === '"' && RAW_STRING_PREFIXES.has(word)) {
        const end = rawStringEnd(source, j);
        push("string", i, end);
        i = end;
        continue;
      }
      if ((next === '"' || next === "'") && STRING_PREFIXES.has(word)) {
        const end = quotedEnd(source, j);
        push("string", i, end);
        i = end;
        continue;
      }
      push(keywords.has(word) ? "keyword" : types.has(word) ? "type" : "plain", i, j);
      i = j;
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(source[i + 1]))) {
      const end = numberEnd(source, i);
      push("number", i, end);
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
