// A small tokenizer for Verilog and SystemVerilog syntax colouring. Like the
// others, it labels pieces of code without changing a single character, and
// it is pattern-based, not a full parser. Both languages share it, since
// SystemVerilog is Verilog plus more words.
// The Verilog-specific parts:
//   - The language is case-sensitive: `Begin` is not a keyword.
//   - Comments are // to the end of the line and /* ... */ (these do not nest).
//   - Strings use "..." with backslash escapes. A string ends at the first
//     line break that is not escaped. SystemVerilog also has """...""" strings
//     that can span lines.
//   - A backtick plus a name (`define, `include, `timescale, `ifdef, or a
//     macro use like `WIDTH) is one "preprocessor" token.
//   - A $ plus a name ($display, $clog2, $finish) is a system task or function,
//     coloured as a keyword.
//   - Numbers: 42, 1_000, sized and based literals (8'hFF, 4'b10_1x, 16'sd5,
//     'd10), unsized ones ('0 '1 'x 'z), reals (1.5, 2.0e-3) and times (10ns).
//   - An apostrophe is never a string quote. '{a, b} and int'(x) leave it plain.
//   - An escaped identifier is a backslash plus every character up to the next
//     white space (\bus+index ), so it can hold symbols and keywords.
//   - (* full_case *) is an attribute, but (*) is not, so `always @(*)` is
//     safe. An attribute that never closes is not treated as one.
//   - Data types (wire, reg, logic, int, ...) are coloured as types, and the
//     rest of the reserved words as keywords.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** Reserved words from Verilog-2005 and SystemVerilog (not the data types, which are below). */
const KEYWORDS = new Set([
  // Verilog-2005
  "always", "and", "assign", "automatic", "begin", "buf", "bufif0", "bufif1", "case", "casex", "casez", "cell",
  "cmos", "config", "deassign", "default", "defparam", "design", "disable", "edge", "else", "end", "endcase",
  "endconfig", "endfunction", "endgenerate", "endmodule", "endprimitive", "endspecify", "endtable", "endtask",
  "for", "force", "forever", "fork", "function", "generate", "highz0", "highz1", "if", "ifnone", "incdir",
  "include", "initial", "inout", "input", "instance", "join", "large", "liblist", "library", "localparam",
  "macromodule", "medium", "module", "nand", "negedge", "nmos", "nor", "noshowcancelled", "not", "notif0",
  "notif1", "or", "output", "parameter", "pmos", "posedge", "primitive", "pull0", "pull1", "pulldown", "pullup",
  "pulsestyle_ondetect", "pulsestyle_onevent", "rcmos", "release", "repeat", "rnmos", "rpmos", "rtran",
  "rtranif0", "rtranif1", "scalared", "showcancelled", "signed", "small", "specify", "specparam", "strong0",
  "strong1", "table", "task", "tran", "tranif0", "tranif1", "unsigned", "use", "vectored", "wait", "weak0",
  "weak1", "while", "xnor", "xor",
  // SystemVerilog
  "accept_on", "alias", "always_comb", "always_ff", "always_latch", "assert", "assume", "before", "bind",
  "bins", "binsof", "break", "checker", "class", "clocking", "const", "constraint", "context", "continue",
  "cover", "covergroup", "coverpoint", "cross", "dist", "do", "endchecker", "endclass", "endclocking",
  "endgroup", "endinterface", "endpackage", "endprogram", "endproperty", "endsequence", "enum", "eventually",
  "expect", "export", "extends", "extern", "final", "first_match", "foreach", "forkjoin", "global", "iff",
  "ignore_bins", "illegal_bins", "implements", "implies", "import", "inside", "interface", "intersect",
  "join_any", "join_none", "let", "local", "matches", "modport", "new", "nexttime", "null", "package", "packed",
  "priority", "program", "property", "protected", "pure", "rand", "randc", "randcase", "randsequence", "ref",
  "reject_on", "restrict", "return", "s_always", "s_eventually", "s_nexttime", "s_until", "s_until_with",
  "sequence", "soft", "solve", "static", "strong", "struct", "super", "sync_accept_on", "sync_reject_on",
  "tagged", "this", "throughout", "timeprecision", "timeunit", "type", "typedef", "union", "unique", "unique0",
  "until", "until_with", "untyped", "var", "virtual", "wait_order", "weak", "wildcard", "with", "within",
]);

/** Data types and net types, coloured as types. */
const TYPES = new Set([
  "bit", "byte", "chandle", "event", "genvar", "int", "integer", "interconnect", "logic", "longint", "real",
  "realtime", "reg", "shortint", "shortreal", "string", "supply0", "supply1", "time", "tri", "tri0", "tri1",
  "triand", "trior", "trireg", "uwire", "void", "wand", "wire", "wor",
]);

/** The units a time literal can end with (10ns, 1.5ps). "step" is for `#1step`. */
const TIME_UNITS = ["step", "ms", "us", "ns", "ps", "fs", "s"];

/** Longest an attribute can be before it is not treated as one, so a stray `(*` can't swallow a huge part of the file. */
const MAX_ATTRIBUTE_LENGTH = 400;

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z_]/.test(ch);
}

/** Letters, digits, _ and $ can all be inside a name. */
function isIdentPart(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
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

/** The characters allowed in the value part of a based literal, for each base letter. */
function valuePattern(base: string): RegExp {
  switch (base.toLowerCase()) {
    case "b":
      return /[01xXzZ?_]/;
    case "o":
      return /[0-7xXzZ?_]/;
    case "d":
      return /[0-9xXzZ?_]/;
    default:
      return /[0-9a-fA-FxXzZ?_]/;
  }
}

/**
 * If a based literal starts at the apostrophe at i ('hFF, 'sd5, 'b1010, and
 * what follows a size like the 8 in 8'hFF), returns where it ends. Otherwise -1.
 * Spaces or tabs are allowed after the base (8'h FF) when a value follows them.
 */
function basedEnd(src: string, i: number): number {
  let j = i + 1;
  if (src[j] === "s" || src[j] === "S") {
    j++;
  }
  const base = src[j];
  if (base === undefined || !/[bBoOdDhH]/.test(base)) {
    return -1;
  }
  const value = valuePattern(base);
  j++;
  let k = j;
  while (isInlineSpace(src[k])) {
    k++;
  }
  if (!value.test(src[k] ?? "")) {
    // No value yet (8'h at the end of a line): the base letter alone still counts, but only with no space.
    return k === j ? j : -1;
  }
  while (k < src.length && value.test(src[k]!)) {
    k++;
  }
  return k;
}

/** The end of a time unit (ns, ps, ...) at i, or i itself if there isn't one. */
function timeUnitEnd(src: string, i: number): number {
  for (const unit of TIME_UNITS) {
    if (src.startsWith(unit, i) && !isIdentPart(src[i + unit.length])) {
      return i + unit.length;
    }
  }
  return i;
}

/**
 * End of a number that starts with a digit at i: 42, 1_000, 3.14, 2.0e-3,
 * 10ns, and sized literals like 8'hFF or 16 'sd5.
 */
function numberEnd(src: string, i: number): number {
  let j = i;
  while (j < src.length && (isDigit(src[j]) || src[j] === "_")) {
    j++;
  }
  // A size followed by a base: 8'hFF. Spaces are allowed before the apostrophe.
  let k = j;
  while (isInlineSpace(src[k])) {
    k++;
  }
  if (src[k] === "'") {
    const based = basedEnd(src, k);
    if (based !== -1) {
      return based;
    }
  }
  // A fraction: 1.5. The digit after the dot keeps `1.` from being taken in `a[1].b`.
  if (src[j] === "." && isDigit(src[j + 1])) {
    j++;
    while (j < src.length && (isDigit(src[j]) || src[j] === "_")) {
      j++;
    }
  }
  // An exponent: 2.0e-3. The sign only counts when digits follow.
  if (src[j] === "e" || src[j] === "E") {
    const sign = src[j + 1] === "+" || src[j + 1] === "-" ? 1 : 0;
    if (isDigit(src[j + 1 + sign])) {
      j += 1 + sign;
      while (j < src.length && (isDigit(src[j]) || src[j] === "_")) {
        j++;
      }
    }
  }
  return timeUnitEnd(src, j);
}

/**
 * End of a "..." string whose quote is at i. A backslash skips the next
 * character (so \" does not end it, and a backslash before a line break
 * continues the string). An unescaped line break ends an unfinished string.
 */
function quotedEnd(src: string, i: number): number {
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "\\") {
      j = Math.min(j + 2, src.length);
      continue;
    }
    if (ch === '"') {
      return j + 1;
    }
    if (ch === "\n") {
      return j;
    }
    j++;
  }
  return src.length;
}

/** End of a """...""" string whose opening quotes are at i. It can span lines and runs to the end of the file if unclosed. */
function tripleQuotedEnd(src: string, i: number): number {
  let j = i + 3;
  while (j < src.length) {
    if (src[j] === "\\") {
      j += 2;
      continue;
    }
    if (src.startsWith('"""', j)) {
      return j + 3;
    }
    j++;
  }
  return src.length;
}

/**
 * If an attribute (* ... *) starts at i, returns where it ends. Otherwise -1.
 * `(*)` is the "any signal" list in `always @(*)`, so it never counts, and an
 * attribute with no closing *) (or a very long one) is left as plain code.
 */
function attributeEnd(src: string, i: number): number {
  if (src[i] !== "(" || src[i + 1] !== "*" || src[i + 2] === ")") {
    return -1;
  }
  const close = src.indexOf("*)", i + 2);
  if (close === -1 || close + 2 - i > MAX_ATTRIBUTE_LENGTH) {
    return -1;
  }
  return close + 2;
}

/**
 * Splits Verilog / SystemVerilog source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizeVerilog(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;
  let i = 0;
  // True right after a dot (a port or field name like .clk or q.size), which is never a keyword.
  let afterDot = false;

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

    if (ch === '"') {
      const end = source.startsWith('"""', i) ? tripleQuotedEnd(source, i) : quotedEnd(source, i);
      push("string", i, end);
      afterDot = false;
      i = end;
      continue;
    }

    // `define, `include, a macro use like `WIDTH. `` (pasting two words together) and `" (a quote
    // inside a macro) are two characters, and a backtick on its own is one.
    if (ch === "`") {
      let end = i + 1;
      if (isIdentStart(source[i + 1])) {
        end = identEnd(source, i + 1);
      } else if (source[i + 1] === "`" || source[i + 1] === '"') {
        end = i + 2;
      }
      push("preprocessor", i, end);
      afterDot = false;
      i = end;
      continue;
    }

    // System tasks and functions. A lone $ (as in a queue range [$]) stays plain.
    if (ch === "$") {
      const end = identEnd(source, i + 1);
      push(end > i + 1 ? "keyword" : "plain", i, end);
      afterDot = false;
      i = end;
      continue;
    }

    // An escaped identifier runs to the next white space and can hold any character.
    if (ch === "\\") {
      let j = i + 1;
      while (j < n && !isWhite(source[j])) {
        j++;
      }
      push("plain", i, j);
      afterDot = false;
      i = j;
      continue;
    }

    if (ch === "(" && source[i + 1] === "*") {
      const end = attributeEnd(source, i);
      if (end !== -1) {
        push("preprocessor", i, end);
        afterDot = false;
        i = end;
        continue;
      }
    }

    if (isIdentStart(ch)) {
      const j = identEnd(source, i);
      const word = source.slice(i, j);
      let kind: TokenKind = "plain";
      if (!afterDot) {
        if (TYPES.has(word)) {
          kind = "type";
        } else if (KEYWORDS.has(word)) {
          kind = "keyword";
        }
      }
      push(kind, i, j);
      afterDot = false;
      i = j;
      continue;
    }

    if (isDigit(ch)) {
      const end = numberEnd(source, i);
      push("number", i, end);
      afterDot = false;
      i = end;
      continue;
    }

    // An apostrophe is never a string quote. It starts a based literal ('hFF), an unsized one ('0, '1, 'x, 'z)
    // or is plain, as in '{a, b} and int'(x).
    if (ch === "'") {
      const based = basedEnd(source, i);
      if (based !== -1) {
        push("number", i, based);
        afterDot = false;
        i = based;
        continue;
      }
      if (/[01xXzZ]/.test(source[i + 1] ?? "") && !isIdentPart(source[i + 2])) {
        push("number", i, i + 2);
        afterDot = false;
        i += 2;
        continue;
      }
    }

    // Everything else (operators, brackets, ;) is plain. Takes a surrogate pair as one character.
    const codePoint = source.codePointAt(i) ?? 0;
    const length = codePoint > 0xffff ? 2 : 1;
    push("plain", i, i + length);
    afterDot = ch === ".";
    i += length;
  }

  return builder.lines();
}
