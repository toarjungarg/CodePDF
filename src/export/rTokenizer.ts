// A small tokenizer for R syntax colouring. Like the others, it labels
// pieces of code without changing a single character, and it is
// pattern-based, not a full parser.
// The R-specific parts:
//   - Comments start with # and run to the end of the line (#' roxygen lines too).
//   - Strings use " or ' with backslash escapes, and they may run over several lines.
//   - Raw strings look like r"(...)", R'[...]' or r"{...}", and can have dashes
//     like r"-(...)-". They only end at the matching bracket, the same dashes
//     and the same quote, so no escapes are read inside them.
//   - A name in backticks (`my var`) is a name, not a string, so it stays plain.
//   - Numbers: 1, 1.5, .5, 1e-3, 0x1F, hex floats (0x1p4), and the L and i
//     endings (1L, 0x10L, 2i).
//   - Names can hold dots and underscores and can start with a dot (.hidden,
//     is.na, my_var.2). A dot followed by a digit (.5) is a number instead.
//   - %...% is one operator (%in%, %%, %>%), so a # or a quote inside it
//     can't start a comment or a string.
//   - A name right before :: or ::: is a package name and gets the type colour.
//   - Standard functions (print, paste, library, ...) are coloured as keywords
//     when they are called, like Lua and Go do.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** The reserved words. */
const KEYWORDS = new Set(["if", "else", "repeat", "while", "function", "for", "in", "next", "break"]);

/** Built-in values, coloured like keywords. */
const CONSTANTS = new Set([
  "TRUE", "FALSE", "NULL", "Inf", "NaN", "NA", "NA_integer_", "NA_real_", "NA_character_", "NA_complex_",
]);

/** Common standard functions. Only coloured when they are called, so a variable called `names` or `table` stays plain. */
const BUILT_IN_FUNCTIONS = new Set([
  "abs", "all", "any", "apply", "as.character", "as.integer", "as.logical", "as.numeric", "assign", "c", "cat",
  "cbind", "character", "class", "cumsum", "data.frame", "do.call", "environment", "exists", "exp", "factor",
  "Filter", "format", "get", "getwd", "gsub", "grepl", "head", "identical", "ifelse", "inherits", "integer",
  "invisible", "is.na", "is.null", "is.numeric", "is.character", "lapply", "length", "library", "list", "log",
  "logical", "makeActiveBinding", "Map", "mapply", "matrix", "max", "mean", "median", "message", "min", "names",
  "nchar", "ncol", "new.env", "nrow", "numeric", "on.exit", "order", "paste", "paste0", "plot", "print", "rbind",
  "read.csv", "readline", "readRDS", "Reduce", "rep", "require", "return", "rev", "rm", "rnorm", "round", "runif",
  "sample", "sapply", "sd", "seq", "seq_along", "seq_len", "set.seed", "setwd", "sort", "source", "sprintf", "sqrt",
  "stop", "stopifnot", "str", "strsplit", "structure", "sub", "substr", "sum", "summary", "suppressMessages",
  "suppressWarnings", "switch", "Sys.time", "table", "tail", "tolower", "toupper", "try", "tryCatch", "unique",
  "unlist", "UseMethod", "NextMethod", "vapply", "var", "vector", "warning", "which", "write.csv",
]);

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string | undefined): boolean {
  return ch !== undefined && /\p{L}/u.test(ch);
}

function isIdentPart(ch: string | undefined): boolean {
  return ch !== undefined && (/[\p{L}\p{N}]/u.test(ch) || ch === "." || ch === "_");
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

/**
 * End of a "..." or '...' string whose quote is at i. A backslash skips the
 * next character, so \" and \\ work. The string may span lines, and an
 * unfinished one runs to the end of the file, like in R.
 */
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
    j++;
  }
  return src.length;
}

/**
 * If a raw string starts at i (the r or R), returns where it ends. Otherwise returns -1.
 * The shape is r, a quote, any number of dashes, an opening ( [ or {, the text,
 * then the matching ) ] or }, the same dashes and the same quote.
 * An unclosed one runs to the end of the file.
 */
function rawStringEnd(src: string, i: number): number {
  const quote = src[i + 1];
  if (quote !== '"' && quote !== "'") {
    return -1;
  }
  let j = i + 2;
  while (src[j] === "-") {
    j++;
  }
  const dashes = src.slice(i + 2, j);
  const open = src[j];
  const close = open === "(" ? ")" : open === "[" ? "]" : open === "{" ? "}" : "";
  if (close === "") {
    return -1;
  }
  const closer = close + dashes + quote;
  const found = src.indexOf(closer, j + 1);
  return found === -1 ? src.length : found + closer.length;
}

/** End of a `backtick name`. A backslash skips the next character. It stops at a line break if there is no closing backtick. */
function backtickEnd(src: string, i: number): number {
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "\\" && src[j + 1] !== "\n") {
      j += 2;
      continue;
    }
    if (ch === "`") {
      return j + 1;
    }
    if (ch === "\n") {
      return j;
    }
    j++;
  }
  return src.length;
}

/**
 * End of a number: 42, 1.5, 1., .5, 1e-3, 0x1F, 0x1p4, then an optional L or i.
 * The sign after an exponent is only taken when digits follow it.
 */
function numberEnd(src: string, i: number): number {
  let j = i;
  const hex = src[i] === "0" && (src[i + 1] === "x" || src[i + 1] === "X");
  const digit = hex ? /[0-9a-fA-F]/ : /[0-9]/;
  const exponent = hex ? /[pP]/ : /[eE]/;
  if (hex) {
    j = i + 2;
  }
  while (j < src.length && digit.test(src[j]!)) {
    j++;
  }
  if (src[j] === ".") {
    j++;
    while (j < src.length && digit.test(src[j]!)) {
      j++;
    }
  }
  if (exponent.test(src[j] ?? "")) {
    const sign = src[j + 1] === "+" || src[j + 1] === "-" ? 1 : 0;
    if (isDigit(src[j + 1 + sign])) {
      j += 1 + sign;
      while (j < src.length && isDigit(src[j])) {
        j++;
      }
    }
  }
  // L makes an integer and i makes a complex number.
  if (src[j] === "L" || src[j] === "i") {
    j++;
  }
  return j;
}

/**
 * Splits R source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizeR(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;
  let i = 0;
  // True right after $, @, :: or ::: (a member or package item comes next, never a keyword or built-in).
  let afterMember = false;

  // Pushes a piece of real code that is not a name, and resets what was remembered.
  const code = (kind: TokenKind, start: number, end: number): void => {
    push(kind, start, end);
    afterMember = false;
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

    // Comments don't change what was remembered, so `x$ # note` then a name still counts as after a $.
    if (ch === "#") {
      const nl = source.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      push("comment", i, end);
      i = end;
      continue;
    }

    // A raw string has to be checked before names, since it starts with the letter r.
    if (ch === "r" || ch === "R") {
      const end = rawStringEnd(source, i);
      if (end !== -1) {
        code("string", i, end);
        i = end;
        continue;
      }
    }

    // A dot followed by a digit is a number (.5). Any other dot starts a name (.hidden, ...).
    if (isIdentStart(ch) || (ch === "." && !isDigit(source[i + 1]))) {
      const j = identEnd(source, i);
      const word = source.slice(i, j);
      const afterWord = skipInlineSpace(source, j);
      let kind: TokenKind = "plain";
      if (afterMember) {
        // Something after $ or :: is always plain.
        kind = "plain";
      } else if (KEYWORDS.has(word) || CONSTANTS.has(word)) {
        kind = "keyword";
      } else if (source[j] === ":" && source[j + 1] === ":") {
        // A package name, like stats in stats::sd.
        kind = "type";
      } else if (BUILT_IN_FUNCTIONS.has(word) && source[afterWord] === "(") {
        kind = "keyword";
      }
      push(kind, i, j);
      afterMember = false;
      i = j;
      continue;
    }

    if (isDigit(ch) || ch === ".") {
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

    // A backtick name is plain, so a word like `if` in backticks is not a keyword.
    if (ch === "`") {
      const end = backtickEnd(source, i);
      code("plain", i, end);
      i = end;
      continue;
    }

    // %in%, %%, %>% and so on are one operator. It has to close on the same line.
    if (ch === "%") {
      const close = source.indexOf("%", i + 1);
      const nl = source.indexOf("\n", i);
      const end = close !== -1 && (nl === -1 || close < nl) ? close + 1 : i + 1;
      code("plain", i, end);
      i = end;
      continue;
    }

    // :: and ::: lead to a name inside a package.
    if (ch === ":" && source[i + 1] === ":") {
      const end = source[i + 2] === ":" ? i + 3 : i + 2;
      code("plain", i, end);
      afterMember = true;
      i = end;
      continue;
    }

    if (ch === "$" || ch === "@") {
      code("plain", i, i + 1);
      afterMember = true;
      i++;
      continue;
    }

    // Everything else (operators like <- |> \ , brackets, ;) is plain. Takes a surrogate pair as one character.
    const codePoint = source.codePointAt(i) ?? 0;
    const length = codePoint > 0xffff ? 2 : 1;
    code("plain", i, i + length);
    i += length;
  }

  return builder.lines();
}
