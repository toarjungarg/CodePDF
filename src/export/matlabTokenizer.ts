// A small tokenizer for MATLAB syntax colouring. Like the others, it labels
// pieces of code without changing a single character, and it is
// pattern-based, not a full parser.
// The MATLAB-specific parts:
//   - Comments start with %. A line that holds only %{ is the start of a block
//     comment, and a line that holds only %} ends it. Block comments can nest.
//   - ... is a line continuation: the rest of the line after it is a comment.
//   - A ' is either a string or the transpose operator. It is a transpose when it
//     comes right after a name, a number, ), ], }, .' or another transpose, with
//     no space in between. A word like end counts as a name only when it is
//     inside brackets (x(end)'). Everywhere else a ' starts a string.
//   - Strings use ' or ". Inside them a doubled quote ('' or "") is a quote
//     character, and there are no backslash escapes. A string stops at the end of
//     its line, because MATLAB strings can't run over lines.
//   - Numbers: 1, 1.5, .5, 1e-3, 0x1F, 0b101, 0xFFu8, and the i or j ending (3i, 2.5j).
//     In 1.*2 and 1./x the dot belongs to the operator, not the number.
//   - A name after . (s.end, obj.method) is always plain.
//   - The names in a function line (function [a, b] = name(x)) are plain.
//   - properties, methods, events and enumeration are only keywords when they
//     sit alone on a line inside a file that has a classdef, and arguments is
//     only a keyword when it sits alone on a line.
//   - Standard functions (zeros, size, disp, ...) are coloured as keywords when
//     they are called, like Lua and R do.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** Words that are always keywords (when not right after a dot). */
const KEYWORDS = new Set([
  "break", "case", "catch", "classdef", "continue", "else", "elseif", "end", "for", "function", "global",
  "if", "otherwise", "parfor", "persistent", "return", "spmd", "switch", "try", "while",
]);

/** Words that only act as keywords at the start of a line (class sections and argument blocks). */
const CLASS_SECTIONS = new Set(["properties", "methods", "events", "enumeration"]);

/** Built-in values, coloured like keywords. The loop names i and j are left out, since they are usually just variables. */
const CONSTANTS = new Set(["true", "false", "pi", "Inf", "NaN", "NaT", "eps"]);

/** Common standard functions. Only coloured when they are called, so a variable called `size` or `max` stays plain. */
const BUILT_IN_FUNCTIONS = new Set([
  "abs", "acos", "all", "any", "arrayfun", "asin", "atan", "atan2", "axis", "bitand", "bitor", "bitshift", "bitxor",
  "cat", "ceil", "cell", "cell2mat", "cellfun", "char", "class", "close", "colorbar", "cos", "cosh", "cross",
  "cumprod", "cumsum", "det", "diag", "diff", "disp", "double", "dot", "eig", "error", "exp", "eye", "factorial",
  "feval", "fieldnames", "figure", "find", "fix", "fliplr", "flipud", "floor", "fclose", "fopen", "fprintf",
  "func2str", "gcd", "grid", "histogram", "hold", "horzcat", "input", "int2str", "int8", "int16", "int32", "int64",
  "interp1", "inv", "isa", "iscell", "ischar", "isempty", "isequal", "isfield", "isinf", "islogical", "isnan",
  "isnumeric", "isreal", "isstruct", "kron", "lcm", "legend", "length", "linspace", "log", "log10", "log2",
  "logical", "logspace", "lower", "mat2str", "max", "mean", "median", "meshgrid", "min", "mod", "nnz", "norm",
  "num2str", "numel", "ndims", "ones", "plot", "polyfit", "polyval", "prod", "rand", "randi", "randn", "rank",
  "regexp", "regexprep", "rem", "repmat", "reshape", "round", "save", "scatter", "set", "setdiff", "sign", "sin",
  "single", "sinh", "size", "sort", "sprintf", "sqrt", "std", "str2double", "str2func", "str2num", "strcat",
  "strcmp", "strcmpi", "strfind", "strjoin", "strrep", "strsplit", "strtrim", "struct", "subplot", "sum", "surf",
  "tan", "tanh", "tic", "title", "toc", "trace", "transpose", "trapz", "uint8", "uint16", "uint32", "uint64",
  "union", "unique", "upper", "var", "vertcat", "warning", "xlabel", "ylabel", "zeros", "zlabel",
]);

/** Number endings for whole-number types, like the u8 in 0xFFu8 or the s16 in 0b101s16. */
const INTEGER_SUFFIX = /^[us](8|16|32|64)/;

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string | undefined): boolean {
  return ch !== undefined && /\p{L}/u.test(ch);
}

function isIdentPart(ch: string | undefined): boolean {
  return ch !== undefined && (/[\p{L}\p{N}]/u.test(ch) || ch === "_");
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

/** True when only spaces or tabs sit between the start of the line and index i. */
function startsLine(src: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && isInlineSpace(src[j])) {
    j--;
  }
  return j < 0 || src[j] === "\n";
}

/** The index of the line break that ends the line holding index i (or the end of the file). */
function lineEndOf(src: string, i: number): number {
  const nl = src.indexOf("\n", i);
  return nl === -1 ? src.length : nl;
}

/** True when index i is at the end of its line (only spaces or tabs follow), or at a comment. */
function endsLine(src: string, i: number): boolean {
  const j = skipInlineSpace(src, i);
  return j >= src.length || src[j] === "\n" || src[j] === "%";
}

/** True when the % at index i is a %{ with nothing else on its line, so it opens a block comment. */
function opensBlockComment(src: string, i: number): boolean {
  return src[i + 1] === "{" && startsLine(src, i) && skipInlineSpace(src, i + 2) >= lineEndOf(src, i);
}

/**
 * End of a block comment whose %{ line starts at i. It ends at the first line
 * that holds only %}, and every %{ line inside it needs its own %}. An unclosed
 * block comment runs to the end of the file, like in MATLAB.
 */
function blockCommentEnd(src: string, i: number): number {
  let depth = 1;
  let lineEnd = src.indexOf("\n", i);
  while (lineEnd !== -1) {
    const start = lineEnd + 1;
    const next = src.indexOf("\n", start);
    const end = next === -1 ? src.length : next;
    const text = src.slice(start, end).trim();
    if (text === "%{") {
      depth++;
    } else if (text === "%}") {
      depth--;
      if (depth === 0) {
        return end;
      }
    }
    lineEnd = next;
  }
  return src.length;
}

/**
 * End of a string whose quote is at i. A doubled quote ('' or "") stays inside the
 * string. An unfinished string stops at the end of its line.
 */
function quotedEnd(src: string, i: number): number {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === quote) {
      if (src[j + 1] === quote) {
        j += 2;
        continue;
      }
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
 * End of a number: 42, 3., 3.14, .5, 1e10, 1E-3, 0xFF, 0b101, 0xFFu8, 3i, 2.5e3j.
 * A "." only belongs to the number when it is not the start of an operator (.* ./ .\ .^ .') or of "...".
 * The sign after an exponent is only taken when digits follow it.
 */
function numberEnd(src: string, i: number): number {
  let j = i;
  const radix = src[i] === "0" ? (src[i + 1] ?? "").toLowerCase() : "";
  if ((radix === "x" && /[0-9a-fA-F]/.test(src[i + 2] ?? "")) || (radix === "b" && /[01]/.test(src[i + 2] ?? ""))) {
    const digit = radix === "x" ? /[0-9a-fA-F]/ : /[01]/;
    j = i + 2;
    while (j < src.length && digit.test(src[j]!)) {
      j++;
    }
    const suffix = INTEGER_SUFFIX.exec(src.slice(j, j + 3));
    return suffix && !isIdentPart(src[j + suffix[0].length]) ? j + suffix[0].length : j;
  }
  while (j < src.length && isDigit(src[j])) {
    j++;
  }
  if (src[j] === "." && !"*/\\^'.".includes(src[j + 1] ?? " ")) {
    j++;
    while (j < src.length && isDigit(src[j])) {
      j++;
    }
  }
  if (src[j] === "e" || src[j] === "E") {
    const sign = src[j + 1] === "+" || src[j + 1] === "-" ? 1 : 0;
    if (isDigit(src[j + 1 + sign])) {
      j += 1 + sign;
      while (j < src.length && isDigit(src[j])) {
        j++;
      }
    }
  }
  // The imaginary ending, only when no other letter follows (so 3if isn't 3i then f).
  if ((src[j] === "i" || src[j] === "j") && !isIdentPart(src[j + 1])) {
    j++;
  }
  return j;
}

/**
 * Splits MATLAB source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizeMatlab(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;
  let i = 0;
  // True right after a single . (a field name comes next, never a keyword or built-in).
  let afterMember = false;
  // How many ( [ { are open. Used to tell an end inside an index (x(end)) from the end of a block.
  let depth = 0;
  // Where the last piece of code ended, and whether a ' right there would be a transpose.
  let lastEnd = -1;
  let lastCanTranspose = false;
  // True from a function keyword until its ( or the end of its line, since the names in between are plain.
  let inFunctionLine = false;
  // True after a ... so the line break after it doesn't end a function line.
  let continued = false;
  // Class sections only count as keywords in a file that has a classdef.
  let seenClassdef = false;

  // Pushes a piece of real code, and remembers where it ended for the transpose check.
  const code = (kind: TokenKind, start: number, end: number, canTranspose: boolean): void => {
    push(kind, start, end);
    afterMember = false;
    lastEnd = end;
    lastCanTranspose = canTranspose;
  };

  while (i < n) {
    const ch = source[i];

    if (ch === "\n" || isInlineSpace(ch)) {
      let j = i;
      while (j < n && (source[j] === "\n" || isInlineSpace(source[j]))) {
        if (source[j] === "\n") {
          if (!continued) {
            inFunctionLine = false;
          }
          continued = false;
        }
        j++;
      }
      push("plain", i, j);
      i = j;
      continue;
    }

    if (ch === "%") {
      const end = opensBlockComment(source, i) ? blockCommentEnd(source, i) : lineEndOf(source, i);
      push("comment", i, end);
      i = end;
      continue;
    }

    // ... continues the line, and the rest of the line is a comment.
    if (ch === "." && source[i + 1] === "." && source[i + 2] === ".") {
      const end = lineEndOf(source, i);
      push("comment", i, end);
      continued = true;
      i = end;
      continue;
    }

    if (isIdentStart(ch)) {
      const j = identEnd(source, i);
      const word = source.slice(i, j);
      let kind: TokenKind = "plain";
      let canTranspose = true;
      if (afterMember || inFunctionLine) {
        // A field name or a name in a function line: plain.
      } else if (KEYWORDS.has(word)) {
        kind = "keyword";
        // end inside brackets is an index (x(end)'), so a ' after it is a transpose.
        canTranspose = word === "end" && depth > 0;
        if (word === "function") {
          inFunctionLine = true;
        } else if (word === "classdef") {
          seenClassdef = true;
        }
      } else if (CLASS_SECTIONS.has(word) && seenClassdef && startsLine(source, i) && (endsLine(source, j) || source[skipInlineSpace(source, j)] === "(")) {
        kind = "keyword";
        canTranspose = false;
      } else if (word === "arguments" && startsLine(source, i) && endsLine(source, j)) {
        kind = "keyword";
        canTranspose = false;
      } else if (CONSTANTS.has(word)) {
        kind = "keyword";
      } else if (BUILT_IN_FUNCTIONS.has(word) && source[j] === "(") {
        kind = "keyword";
      }
      code(kind, i, j, canTranspose);
      i = j;
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(source[i + 1]))) {
      const end = numberEnd(source, i);
      code("number", i, end, true);
      i = end;
      continue;
    }

    if (ch === '"') {
      const end = quotedEnd(source, i);
      code("string", i, end, false);
      i = end;
      continue;
    }

    if (ch === "'") {
      if (lastEnd === i && lastCanTranspose) {
        // Right after a name, number, bracket or another transpose: the transpose operator.
        code("plain", i, i + 1, true);
        i++;
      } else {
        const end = quotedEnd(source, i);
        code("string", i, end, false);
        i = end;
      }
      continue;
    }

    // The dot operators. .' is the transpose, so a ' right after it is a transpose too.
    if (ch === "." && "*/\\^'".includes(source[i + 1] ?? " ")) {
      code("plain", i, i + 2, source[i + 1] === "'");
      i += 2;
      continue;
    }

    // A single . means a field name comes next.
    if (ch === ".") {
      code("plain", i, i + 1, false);
      afterMember = true;
      i++;
      continue;
    }

    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      // The ( of the argument list ends the function line, but the [ of the output list does not.
      if (ch === "(") {
        inFunctionLine = false;
      }
      code("plain", i, i + 1, false);
      i++;
      continue;
    }

    if (ch === ")" || ch === "]" || ch === "}") {
      depth = Math.max(0, depth - 1);
      code("plain", i, i + 1, true);
      i++;
      continue;
    }

    // Everything else (operators, commas, ;) is plain. Takes a surrogate pair as one character.
    const codePoint = source.codePointAt(i) ?? 0;
    const length = codePoint > 0xffff ? 2 : 1;
    code("plain", i, i + length, false);
    i += length;
  }

  return builder.lines();
}
