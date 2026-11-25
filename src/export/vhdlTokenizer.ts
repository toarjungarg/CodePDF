// A small tokenizer for VHDL syntax colouring. Like the others, it labels
// pieces of code without changing a single character, and it is
// pattern-based, not a full parser.
// The VHDL-specific parts:
//   - The language is NOT case-sensitive: `ENTITY`, `Entity` and `entity` are
//     all the same keyword, so words are lower-cased before the lookup.
//   - Comments are -- to the end of the line, and /* ... */ (VHDL-2008, no nesting).
//   - Strings use "..." and a doubled "" is a quote inside the string. A string
//     ends at the line break, since VHDL strings cannot span lines.
//   - The apostrophe is the tricky part. It is a character literal ('0', 'Z')
//     or an attribute tick (clk'event, x'length, a'range). After a name, a type
//     or a closing bracket it is an attribute tick, anywhere else it can start
//     a character literal. '''  is the character literal for a quote.
//   - The word right after an attribute tick (event, range, length) is plain.
//   - Bit string literals (x"FF", b"1010", 8x"FF", UX"..") are one number token.
//   - Numbers: 42, 1_000, 3.14, 1.0e-3, based ones like 16#FF# and 2#1010_1010#,
//     and a time unit after a number (10 ns) is part of the number.
//   - An extended identifier (\my signal\) is one plain token.
//   - Types (std_logic, integer, unsigned, ...) are coloured as types, and the
//     rest of the reserved words as keywords. rising_edge is a function, so it is plain.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** Reserved words from VHDL-2008, all lower case (the lookup lower-cases the source word first). */
const KEYWORDS = new Set([
  "abs", "access", "after", "alias", "all", "and", "architecture", "array", "assert", "assume",
  "assume_guarantee", "attribute", "begin", "block", "body", "buffer", "bus", "case", "component",
  "configuration", "constant", "context", "cover", "default", "disconnect", "downto", "else", "elsif", "end",
  "entity", "exit", "fairness", "file", "for", "force", "function", "generate", "generic", "group", "guarded",
  "if", "impure", "in", "inertial", "inout", "is", "label", "library", "linkage", "literal", "loop", "map",
  "mod", "nand", "new", "next", "nor", "not", "null", "of", "on", "open", "or", "others", "out", "package",
  "parameter", "port", "postponed", "procedure", "process", "property", "protected", "pure", "range",
  "record", "register", "reject", "release", "rem", "report", "restrict", "restrict_guarantee", "return",
  "rol", "ror", "select", "sequence", "severity", "shared", "signal", "sla", "sll", "sra", "srl", "strong",
  "subtype", "then", "to", "transport", "type", "unaffected", "units", "until", "use", "variable", "vmode",
  "vprop", "vunit", "wait", "when", "while", "with", "xnor", "xor",
]);

/** The standard types from the std, ieee.std_logic_1164 and ieee.numeric_std packages, coloured as types. */
const TYPES = new Set([
  "bit", "bit_vector", "boolean", "boolean_vector", "character", "delay_length", "file_open_kind",
  "file_open_status", "integer", "integer_vector", "line", "natural", "positive", "real", "real_vector",
  "severity_level", "sfixed", "signed", "std_logic", "std_logic_vector", "std_ulogic", "std_ulogic_vector",
  "string", "text", "time", "time_vector", "ufixed", "unsigned",
]);

/** The units a time value can end with (10 ns, 2.5 us). Only read right after a number. */
const TIME_UNITS = new Set(["fs", "ps", "ns", "us", "ms", "sec", "min", "hr"]);

/** A bit string starts with an optional size and a base letter, then a quote: x"FF", 8x"FF", UB"10", d"15". */
const BIT_STRING_START = /(?:\d[\d_]*)?(?:[us]?[box]|d)"/iy;

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z_]/.test(ch);
}

function isIdentPart(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

function isHexDigit(ch: string | undefined): boolean {
  return ch !== undefined && /[0-9A-Fa-f]/.test(ch);
}

function isInlineSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v";
}

function isWhite(ch: string | undefined): boolean {
  return isInlineSpace(ch) || ch === "\n";
}

function identEnd(src: string, i: number): number {
  let j = i;
  while (j < src.length && isIdentPart(src[j])) {
    j++;
  }
  return j;
}

/** Skips digits and underscores (1_000). */
function digitsEnd(src: string, i: number): number {
  let j = i;
  while (j < src.length && (isDigit(src[j]) || src[j] === "_")) {
    j++;
  }
  return j;
}

/** Skips hex digits and underscores (FF_00). */
function hexDigitsEnd(src: string, i: number): number {
  let j = i;
  while (j < src.length && (isHexDigit(src[j]) || src[j] === "_")) {
    j++;
  }
  return j;
}

/** Skips an exponent (e-3, E+2, e4) if there is one at i. The sign only counts when digits follow. */
function exponentEnd(src: string, i: number): number {
  if (src[i] !== "e" && src[i] !== "E") {
    return i;
  }
  const sign = src[i + 1] === "+" || src[i + 1] === "-" ? 1 : 0;
  return isDigit(src[i + 1 + sign]) ? digitsEnd(src, i + 1 + sign) : i;
}

/** If a time unit (ns, ps, ...) follows at i after spaces or tabs, returns where it ends. Otherwise i itself. */
function timeUnitEnd(src: string, i: number): number {
  let j = i;
  while (isInlineSpace(src[j])) {
    j++;
  }
  const end = identEnd(src, j);
  return end > j && TIME_UNITS.has(src.slice(j, end).toLowerCase()) ? end : i;
}

/** End of a number that starts with a digit at i: 42, 1_000, 3.14, 1.0e-3, 16#FF#, 16#F.F#E2, 10 ns. */
function numberEnd(src: string, i: number): number {
  let j = digitsEnd(src, i);
  // A based literal: 16#FF#. It has to close with a second #, or it is just the number before the #.
  if (src[j] === "#" && isHexDigit(src[j + 1])) {
    let k = hexDigitsEnd(src, j + 1);
    if (src[k] === "." && isHexDigit(src[k + 1])) {
      k = hexDigitsEnd(src, k + 1);
    }
    if (src[k] === "#") {
      return timeUnitEnd(src, exponentEnd(src, k + 1));
    }
  }
  // A fraction. The digit after the dot keeps a dot that is not part of the number out of it.
  if (src[j] === "." && isDigit(src[j + 1])) {
    j = digitsEnd(src, j + 1);
  }
  return timeUnitEnd(src, exponentEnd(src, j));
}

/**
 * End of a "..." string whose opening quote is at i. A doubled "" is a quote
 * inside the string. An unfinished string ends at the line break.
 */
function stringEnd(src: string, i: number): number {
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === '"') {
      if (src[j + 1] === '"') {
        j += 2;
        continue;
      }
      return j + 1;
    }
    if (src[j] === "\n") {
      return j;
    }
    j++;
  }
  return src.length;
}

/** End of an extended identifier whose opening backslash is at i. A doubled \\ is a backslash inside it. It ends at the line break if never closed. */
function extendedIdentEnd(src: string, i: number): number {
  let j = i + 1;
  while (j < src.length && src[j] !== "\n") {
    if (src[j] === "\\") {
      if (src[j + 1] === "\\") {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j++;
  }
  return j;
}

/**
 * Splits VHDL source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizeVhdl(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;
  let i = 0;
  // True when the last real token was a name, a type, `all` or a closing bracket. A ' right after one of
  // these is an attribute tick (clk'event), not the start of a character literal. Spaces and comments don't change it.
  let tickIsAttribute = false;
  // True right after an attribute tick, so the attribute's name (event, range, length) stays plain.
  let afterTick = false;

  while (i < n) {
    const ch = source[i]!;

    if (isWhite(ch)) {
      let j = i + 1;
      while (j < n && isWhite(source[j])) {
        j++;
      }
      push("plain", i, j);
      i = j;
      continue;
    }

    if (ch === "-" && source[i + 1] === "-") {
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

    if (ch === '"') {
      const end = stringEnd(source, i);
      push("string", i, end);
      tickIsAttribute = false;
      afterTick = false;
      i = end;
      continue;
    }

    if (ch === "\\") {
      const end = extendedIdentEnd(source, i);
      push("plain", i, end);
      tickIsAttribute = true;
      afterTick = false;
      i = end;
      continue;
    }

    // A bit string (x"FF", 8x"FF") has to be checked before plain words and numbers, since it starts like one.
    if (isIdentStart(ch) || isDigit(ch)) {
      BIT_STRING_START.lastIndex = i;
      const match = BIT_STRING_START.exec(source);
      if (match) {
        const end = stringEnd(source, i + match[0].length - 1);
        push("number", i, end);
        tickIsAttribute = false;
        afterTick = false;
        i = end;
        continue;
      }
    }

    if (isIdentStart(ch)) {
      const j = identEnd(source, i);
      const word = source.slice(i, j).toLowerCase();
      let kind: TokenKind = "plain";
      if (!afterTick) {
        if (TYPES.has(word)) {
          kind = "type";
        } else if (KEYWORDS.has(word)) {
          kind = "keyword";
        }
      }
      push(kind, i, j);
      // A name or a type can have an attribute (clk'event, integer'image). `all` can too (p.all'length).
      tickIsAttribute = kind === "plain" || kind === "type" || word === "all";
      afterTick = false;
      i = j;
      continue;
    }

    if (isDigit(ch)) {
      const end = numberEnd(source, i);
      push("number", i, end);
      tickIsAttribute = false;
      afterTick = false;
      i = end;
      continue;
    }

    if (ch === "'") {
      // After a name this is an attribute tick (clk'event) or the tick of a qualified expression (std_logic'('1')).
      if (tickIsAttribute) {
        push("plain", i, i + 1);
        tickIsAttribute = false;
        afterTick = true;
        i++;
        continue;
      }
      // Otherwise 'x' is a character literal, and ''' is the literal for a quote.
      if (source[i + 2] === "'" && source[i + 1] !== undefined && source[i + 1] !== "\n") {
        push("string", i, i + 3);
        tickIsAttribute = false;
        afterTick = false;
        i += 3;
        continue;
      }
    }

    // Everything else (operators, brackets, ;) is plain. Takes a surrogate pair as one character.
    const codePoint = source.codePointAt(i) ?? 0;
    const length = codePoint > 0xffff ? 2 : 1;
    push("plain", i, i + length);
    tickIsAttribute = ch === ")" || ch === "]";
    afterTick = false;
    i += length;
  }

  return builder.lines();
}
