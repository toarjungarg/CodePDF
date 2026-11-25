// A small tokenizer for Lua syntax colouring. Like the others, it labels
// pieces of code without changing a single character, and it is
// pattern-based, not a full parser.
// The Lua-specific parts:
//   - Comments start with --. A comment that starts with --[[ (or --[==[, with
//     any number of = signs) is a long comment: it can span lines and only
//     ends at the closing bracket with the SAME number of = signs.
//     Anything else after -- is a one-line comment (so ---[[ is a one-line comment).
//   - Long strings ([[ ... ]] and [=[ ... ]=]) work the same way, but are
//     strings. A [ that is not followed by =*[ is only punctuation (t[i]).
//   - Quoted strings use ' or " with backslash escapes. A \z skips the white
//     space after it, even over line breaks, and a backslash before a line
//     break continues the string on the next line.
//   - Numbers can be hex (0xFF), hex floats (0xA.8p0, 0x1p4) or have an exponent (1e-3).
//   - ::name:: is a label and the name after goto is a label, so both get one colour.
//   - <const> and <close> after a local name are attributes.
//   - A first line that starts with #! is a comment.
//   - Standard library functions (print, pairs, require, ...) are coloured as
//     keywords when they are called, and library tables (string, table, math, ...)
//     as types when they are followed by a dot.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** All 22 Lua keywords. */
const KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function", "goto", "if", "in", "local",
  "nil", "not", "or", "repeat", "return", "then", "true", "until", "while",
]);

/** Standard functions. Only coloured when they are called, since `type == x` uses a variable called type. */
const BUILT_IN_FUNCTIONS = new Set([
  "assert", "collectgarbage", "dofile", "error", "getmetatable", "ipairs", "load", "loadfile", "loadstring",
  "next", "pairs", "pcall", "print", "rawequal", "rawget", "rawlen", "rawset", "require", "select",
  "setmetatable", "tonumber", "tostring", "type", "unpack", "xpcall",
]);

/** Standard library tables. Only coloured when a dot follows (`string.format`), so a variable called `table` stays plain. */
const BUILT_IN_LIBRARIES = new Set([
  "bit32", "coroutine", "debug", "io", "math", "os", "package", "string", "table", "utf8",
]);

/** Special global names, coloured as types. */
const BUILT_IN_GLOBALS = new Set(["_ENV", "_G", "_VERSION"]);

/** The two attributes allowed between a local name and its value. */
const ATTRIBUTE = /^<[ \t]*(const|close)[ \t]*>/;
/** A label like ::continue::, with optional spaces inside. */
const LABEL = /^::[ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]*::/;

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z_]/.test(ch);
}

function isIdentPart(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
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
 * If a long bracket opens at i ([[, [=[, [==[, ...), returns its level (the
 * number of = signs). Otherwise returns -1, so a lone [ stays punctuation.
 */
function longBracketLevel(src: string, i: number): number {
  if (src[i] !== "[") {
    return -1;
  }
  let j = i + 1;
  while (src[j] === "=") {
    j++;
  }
  return src[j] === "[" ? j - i - 1 : -1;
}

/**
 * End of a long bracket that opened at i with this level. It only closes at
 * ] + the same number of = + ], so a ]] inside a [=[ ... ]=] does not end it.
 * An unclosed one runs to the end of the file.
 */
function longBracketEnd(src: string, i: number, level: number): number {
  const closer = "]" + "=".repeat(level) + "]";
  const close = src.indexOf(closer, i + level + 2);
  return close === -1 ? src.length : close + closer.length;
}

/**
 * End of a "..." or '...' string whose quote is at i. A backslash skips the
 * next character (that covers \n, \", \x41, \065 and \u{48}, since the rest of
 * those are ordinary characters). \z also skips the white space after it,
 * line breaks included. An unescaped line break ends an unfinished string.
 */
function quotedEnd(src: string, i: number): number {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "\\") {
      if (src[j + 1] === "z") {
        j += 2;
        while (j < src.length && (isInlineSpace(src[j]) || src[j] === "\n")) {
          j++;
        }
      } else {
        j = Math.min(j + 2, src.length);
      }
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

/**
 * End of a number: 42, 3., 3.14, .5, 1e10, 1E-3, 0xFF, 0xA.8p0, 0x1p4, 0x.1p-2.
 * A "." only belongs to the number when it is not the start of "..", so 1..2 is 1, .., 2.
 * The sign after an exponent is only taken when digits follow it.
 */
function numberEnd(src: string, i: number): number {
  let j = i;
  const hex = src[i] === "0" && /[xX]/.test(src[i + 1] ?? "");
  const digit = hex ? /[0-9a-fA-F]/ : /[0-9]/;
  const exponent = hex ? /[pP]/ : /[eE]/;
  if (hex) {
    j = i + 2;
  }
  while (j < src.length && digit.test(src[j]!)) {
    j++;
  }
  if (src[j] === "." && src[j + 1] !== ".") {
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
  return j;
}

/**
 * Splits Lua source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizeLua(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;
  let i = 0;
  // True right after a single . or : (a field or method name comes next, never a built-in).
  let afterMember = false;
  // The last word of real code, to know a name after goto is a label.
  let lastWord = "";
  // Where we are in `local a, b <const>, c = ...`: 0 not in one, 1 a name comes next, 2 a name was just read,
  // 3 the function name after `local function` comes next.
  // The names declared there are plain, even if they match a built-in (`local table = {}`).
  let localState = 0;

  // Pushes a piece of real code that is not a word, comma or attribute, and resets what was remembered.
  const code = (kind: TokenKind, start: number, end: number): void => {
    push(kind, start, end);
    afterMember = false;
    lastWord = "";
    localState = 0;
  };

  // A shebang is only a comment on the very first line.
  if (source.startsWith("#!")) {
    const nl = source.indexOf("\n");
    i = nl === -1 ? n : nl;
    push("comment", 0, i);
  }

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

    // Comments don't change what was remembered, so a name on the next line after `t.` and a comment still counts as after a dot.
    if (ch === "-" && source[i + 1] === "-") {
      const level = longBracketLevel(source, i + 2);
      let end: number;
      if (level !== -1) {
        end = longBracketEnd(source, i + 2, level);
      } else {
        const nl = source.indexOf("\n", i);
        end = nl === -1 ? n : nl;
      }
      push("comment", i, end);
      i = end;
      continue;
    }

    if (isIdentStart(ch)) {
      const j = identEnd(source, i);
      const word = source.slice(i, j);
      const next = source[skipInlineSpace(source, j)];
      let kind: TokenKind = "plain";
      if (afterMember) {
        // A field or method (t.print, obj:type()): always plain.
        localState = 0;
      } else if (localState === 3) {
        // The name in `local function name`: plain, even if it matches a built-in.
        localState = 0;
      } else if (KEYWORDS.has(word)) {
        // Keywords are checked before declared names, so `local function` stays two keywords.
        kind = "keyword";
        if (word === "local") {
          localState = 1;
        } else if (word === "function" && localState === 1) {
          localState = 3;
        } else {
          localState = 0;
        }
      } else if (localState === 1) {
        // A name being declared with local.
        localState = 2;
      } else if (lastWord === "function") {
        // The name of the function being defined (`function print() end`), so it stays plain.
        localState = 0;
      } else if (lastWord === "goto") {
        kind = "preprocessor";
        localState = 0;
      } else {
        localState = 0;
        if (BUILT_IN_GLOBALS.has(word)) {
          kind = "type";
        } else if (BUILT_IN_LIBRARIES.has(word) && next === "." && source[skipInlineSpace(source, j) + 1] !== ".") {
          kind = "type";
        } else if (BUILT_IN_FUNCTIONS.has(word) && (next === "(" || next === '"' || next === "'" || next === "{" || longBracketLevel(source, skipInlineSpace(source, j)) !== -1)) {
          kind = "keyword";
        }
      }
      push(kind, i, j);
      afterMember = false;
      lastWord = word;
      i = j;
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(source[i + 1]))) {
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

    if (ch === "[") {
      const level = longBracketLevel(source, i);
      if (level !== -1) {
        const end = longBracketEnd(source, i, level);
        code("string", i, end);
        i = end;
        continue;
      }
      // Not a long bracket: an ordinary [ (like t[i]), handled with the other punctuation below.
    }

    if (ch === ":" && source[i + 1] === ":") {
      const label = LABEL.exec(source.slice(i, i + 200));
      if (label) {
        code("preprocessor", i, i + label[0].length);
        i += label[0].length;
      } else {
        code("plain", i, i + 2);
        i += 2;
      }
      continue;
    }

    // Attributes: local x <const> = 5. Only right after a local name.
    if (ch === "<" && localState === 2) {
      const attribute = ATTRIBUTE.exec(source.slice(i, i + 40));
      if (attribute) {
        const wordStart = i + attribute[0].indexOf(attribute[1]!);
        push("plain", i, wordStart);
        push("keyword", wordStart, wordStart + attribute[1]!.length);
        push("plain", wordStart + attribute[1]!.length, i + attribute[0].length);
        i += attribute[0].length;
        continue;
      }
    }

    // A comma keeps a local list going: `local a, b`.
    if (ch === ",") {
      const keepList = localState === 2;
      code("plain", i, i + 1);
      localState = keepList ? 1 : 0;
      i++;
      continue;
    }

    // .. and ... are operators, so they are never the start of a number or a member access.
    if (ch === "." && source[i + 1] === ".") {
      const end = source[i + 2] === "." ? i + 3 : i + 2;
      code("plain", i, end);
      i = end;
      continue;
    }

    // A single . or : means a field or method name comes next.
    if (ch === "." || ch === ":") {
      code("plain", i, i + 1);
      afterMember = true;
      i++;
      continue;
    }

    // Everything else (operators like // ~= << >> #, brackets, ;) is plain. Takes a surrogate pair as one character.
    const codePoint = source.codePointAt(i) ?? 0;
    const length = codePoint > 0xffff ? 2 : 1;
    code("plain", i, i + length);
    i += length;
  }

  return builder.lines();
}
