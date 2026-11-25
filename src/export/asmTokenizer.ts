// A small tokenizer for assembly syntax colouring. Like the others, it labels
// pieces of code without changing a single character, and it is
// pattern-based, not a full parser.
// Assembly is different on every chip and every assembler (GNU as, NASM, MASM,
// ARM, RISC-V, MIPS, AVR), so this one is general. It never needs to know which
// one a file is, it just reads a few common shapes:
//   - A line looks like:  label:  mnemonic  operand, operand   ; comment
//   - Comments: `;`, `//`, `/* ... */`, `@` (ARM) and `#` (x86, RISC-V, MIPS).
//   - The `#` is the tricky one. At the start of a line it is a comment, unless
//     it is a C preprocessor line like `#include` or `#define` (those show up in
//     .S files). In the middle of a line, `#5` after a comma, a bracket or the
//     instruction name is an ARM immediate value (a number). After anything else
//     (a number, a register, a name) it starts a comment.
//   - The `@` is a comment when it follows a space, except after a comma, so
//     `.type f, @function` is not a comment, and `foo@PLT` is just a name.
//   - Labels are a name followed by `:` at the start of a line (`main:`, `.Lloop:`, `1:`).
//   - The first word on a line (after an optional label) is the instruction name
//     and is coloured as a keyword. Words that start with `.` are directives.
//   - Registers are coloured as types. `%rax`, `$t0` and `r0` all count.
//   - Numbers: 42, 0x2A, 0b101, 0FFh and 1010b (NASM), `$42` (x86 GAS) and `#5` (ARM).
//   - Strings stop at the end of the line if they are never closed.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** The biggest register number for each name prefix, so `r15` is a register and `r99` is not. */
const NUMBERED_REGISTERS: Readonly<Record<string, number>> = {
  r: 31, x: 31, w: 30, // ARM, AVR and RISC-V
  s: 31, d: 31, q: 31, v: 31, // ARM floating point and vector, RISC-V saved registers
  a: 7, t: 9, f: 31, ft: 11, fa: 7, fs: 11, // RISC-V and MIPS
  k: 7, mm: 7, st: 7, cr: 15, xmm: 31, ymm: 31, zmm: 31, // x86
};

/** Registers with a fixed name (everything that is not a name plus a number). */
const FIXED_REGISTERS = new Set([
  "rax", "rbx", "rcx", "rdx", "rsi", "rdi", "rbp", "rsp", "rip",
  "eax", "ebx", "ecx", "edx", "esi", "edi", "ebp", "esp", "eip",
  "ax", "bx", "cx", "dx", "si", "di", "bp", "sp", "ip",
  "al", "ah", "bl", "bh", "cl", "ch", "dl", "dh", "sil", "dil", "bpl", "spl",
  "cs", "ds", "es", "fs", "gs", "ss", "eflags", "rflags", "flags",
  "lr", "pc", "fp", "xzr", "wzr", "wsp", "cpsr", "spsr", // ARM
  "zero", "ra", "gp", "tp", // RISC-V and MIPS
]);

/** Names that are only registers after a `$` (MIPS), like `$at`. */
const DOLLAR_ONLY_REGISTERS = new Set(["at"]);

/** The size and placement words in an operand: `mov dword [x], 5`, `lea rax, [rel msg]`. */
const SIZE_WORDS = new Set([
  "byte", "word", "dword", "qword", "tword", "xmmword", "ymmword", "ptr", "rel", "offset", "short", "near", "far",
]);

/** NASM words for data and constants. They are coloured wherever they appear, since a name can come before them (`len equ 5`). */
const DATA_WORDS = new Set([
  "db", "dw", "dd", "dq", "dt", "do", "dy", "dz", "resb", "resw", "resd", "resq", "rest", "reso", "resy", "resz", "equ", "times", "incbin",
]);

/** NASM directives that only count as the first word of a line. */
const LEADING_DIRECTIVES = new Set([
  "section", "segment", "global", "extern", "bits", "default", "align", "alignb", "org", "use16", "use32", "use64", "absolute", "common", "cpu", "static", "struc", "endstruc",
]);

/** Words that go before an instruction on the same line (`rep movsb`), so the next word is still the instruction name. */
const PREFIX_WORDS = new Set(["lock", "rep", "repe", "repz", "repne", "repnz", "bnd", "notrack"]);

/** C preprocessor words. A line starting with `#` and one of these (no space after the `#`) is a directive, not a comment. */
const PREPROCESSOR_WORDS = new Set([
  "include", "include_next", "define", "undef", "if", "ifdef", "ifndef", "else", "elif", "elifdef", "elifndef", "endif", "error", "warning", "pragma", "line",
]);

/** Ends of a name like `foo@PLT` or `foo@PAGE`. Only these keep an `@` inside a word, so an ARM `@` comment right after a register stays a comment. */
const RELOCATION_SUFFIXES = new Set([
  "plt", "got", "gotoff", "gotpcrel", "gotpcrelx", "tpoff", "ntpoff", "gottpoff", "gotntpoff", "tlsgd", "tlsld", "dtpoff", "pltoff", "page", "pageoff", "gotpage", "gotpageoff", "tlvppage", "tlvppageoff",
]);

/** Characters that can start an ARM immediate after a comma or an open bracket (`#5`, `#-4`, `#label`, `#(1 << 3)`). */
const IMMEDIATE_AFTER_COMMA = /[0-9A-Za-z_\-+(~'$:.&]/;
/** Right after the instruction name only a clear number counts, so `ret #done` stays a comment but `svc #0` is an immediate. */
const IMMEDIATE_AFTER_NAME = /[0-9\-+(~']/;

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z_]/.test(ch);
}

function isWordPart(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_.$]/.test(ch);
}

function isAlphaNumeric(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

function isInlineSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v";
}

/** True for rax, r15, x0, w30, $t0 style names (without the `%` or `$`). Upper or lower case. */
function isRegister(word: string): boolean {
  const w = word.toLowerCase();
  if (FIXED_REGISTERS.has(w)) {
    return true;
  }
  // r8d, r9w, r10b ...: the 64-bit x86 registers with a size letter.
  const sized = /^r(\d+)[dwb]$/.exec(w);
  if (sized) {
    const n = Number(sized[1]);
    return n >= 8 && n <= 31;
  }
  const match = /^([a-z]+)(\d+)$/.exec(w);
  if (!match) {
    return false;
  }
  const max = NUMBERED_REGISTERS[match[1]!];
  const digits = match[2]!;
  if (max === undefined || (digits.length > 1 && digits.startsWith("0"))) {
    return false;
  }
  return Number(digits) <= max;
}

/** End of a word made of letters, digits, `_`, `.` and `$`, starting at i. A `@` stays in only for names like foo@PLT. */
function wordEnd(src: string, i: number): number {
  let j = i;
  while (j < src.length) {
    if (isWordPart(src[j])) {
      j++;
    } else if (src[j] === "@" && j > i) {
      const end = j + 1 + (src.slice(j + 1).match(/^[A-Za-z]*/)?.[0].length ?? 0);
      if (RELOCATION_SUFFIXES.has(src.slice(j + 1, end).toLowerCase())) {
        j = end;
      }
      break;
    } else {
      break;
    }
  }
  return j;
}

/**
 * End of a number that starts with a digit at i: 42, 1_000, 0x2A, 0b101, 0FFh, 1010b, 3.14, 1e-3, and 1f / 1b (local label references).
 * Anything that is not a clean number but starts with a digit is still taken as one word, so no text is lost.
 */
function numberEnd(src: string, i: number): number {
  let j = i;
  while (j < src.length && isAlphaNumeric(src[j])) {
    j++;
  }
  // A fraction: the digit after the dot keeps a dot that is not part of the number out of it.
  if (/^\d[\d_]*$/.test(src.slice(i, j)) && src[j] === "." && isDigit(src[j + 1])) {
    j++;
    while (j < src.length && isAlphaNumeric(src[j])) {
      j++;
    }
  }
  // An exponent with a sign (1.5e-3). A hex number like 0x1e+5 is a sum, so it is left alone.
  if (/^\d[\d_.]*e$/i.test(src.slice(i, j)) && (src[j] === "+" || src[j] === "-") && isDigit(src[j + 1])) {
    j++;
    while (j < src.length && isAlphaNumeric(src[j])) {
      j++;
    }
  }
  return j;
}

/**
 * End of a quoted string or character whose opening quote is at i. A backslash
 * skips the next character, and a line break always ends it, so an unclosed
 * string never swallows the lines below it. `closed` says if the quote was found.
 */
function quotedEnd(src: string, i: number): { end: number; closed: boolean } {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "\n") {
      return { end: j, closed: false };
    }
    if (ch === "\\" && j + 1 < src.length && src[j + 1] !== "\n") {
      j += 2;
      continue;
    }
    if (ch === quote) {
      return { end: j + 1, closed: true };
    }
    j++;
  }
  return { end: src.length, closed: false };
}

/**
 * End of a single-quoted piece whose opening ' is at i. It never reads past the end of the line.
 * GNU as writes one character with no closing quote ('a, '\n), and NASM writes longer
 * strings ('hello'). The two look alike, so: if the number of unescaped ' from here to the
 * end of the line is even, the next ' closes a string. Otherwise it is one character
 * (or one backslash escape) with an optional closing ' right after it.
 */
function singleQuoteEnd(src: string, i: number): number {
  let quotes = 0;
  let k = i;
  while (k < src.length && src[k] !== "\n") {
    if (src[k] === "\\" && k + 1 < src.length && src[k + 1] !== "\n") {
      k += 2;
      continue;
    }
    if (src[k] === "'") {
      quotes++;
    }
    k++;
  }
  if (quotes % 2 === 0) {
    return quotedEnd(src, i).end;
  }
  let j = i + 1;
  if (src[j] === "\\" && j + 1 < src.length && src[j + 1] !== "\n") {
    j += 2;
  } else if (j < src.length && src[j] !== "\n") {
    j += src.codePointAt(j)! > 0xffff ? 2 : 1;
  }
  return src[j] === "'" ? j + 1 : j;
}

/**
 * Splits assembly source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizeAsm(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const n = source.length;
  let i = 0;
  // The state of the current line, reset at every line break.
  let tokensOnLine = 0; // real tokens so far (spaces and comments don't count)
  let nameNext = true; // true while the next word is the instruction name (only a label may come first)
  let lastWasName = false; // true when the last token was the instruction name

  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  /** Adds a real token and remembers it for the `#` rules. */
  const pushToken = (kind: TokenKind, start: number, end: number, isName = false): void => {
    push(kind, start, end);
    tokensOnLine++;
    lastWasName = isName;
  };
  const newLine = (): void => {
    tokensOnLine = 0;
    nameNext = true;
    lastWasName = false;
  };
  /** The last character before i on this line that is not a space, or "" if there is none. */
  const charBefore = (pos: number): string => {
    let k = pos - 1;
    while (k >= 0 && isInlineSpace(source[k])) {
      k--;
    }
    return k >= 0 && source[k] !== "\n" ? source[k]! : "";
  };
  const afterSpace = (pos: number): boolean => pos === 0 || isInlineSpace(source[pos - 1]) || source[pos - 1] === "\n";
  /** The next word after spaces, lower-cased, to spot `len equ 5` (the first word is a name, not an instruction). */
  const wordAfterSpaces = (pos: number): string => {
    let k = pos;
    while (isInlineSpace(source[k])) {
      k++;
    }
    const end = wordEnd(source, k);
    return end > k && isLetter(source[k]) ? source.slice(k, end).toLowerCase() : "";
  };
  /** Pushes a comment from i to the end of the line. */
  const lineComment = (): void => {
    const nl = source.indexOf("\n", i);
    const end = nl === -1 ? n : nl;
    push("comment", i, end);
    i = end;
  };

  while (i < n) {
    const ch = source[i]!;

    if (ch === "\n") {
      push("plain", i, i + 1);
      newLine();
      i++;
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

    // Comments that work the same everywhere.
    if (ch === ";" || (ch === "/" && source[i + 1] === "/")) {
      lineComment();
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      push("comment", i, end);
      // A comment over several lines ends the line it started on, so what comes after it starts a fresh line.
      if (source.slice(i, end).includes("\n")) {
        newLine();
      }
      i = end;
      continue;
    }

    // A # at the start of a line is a C preprocessor line (#include, #define) or a comment.
    if (ch === "#" && tokensOnLine === 0) {
      let k = i + 1;
      while (isLetter(source[k])) {
        k++;
      }
      if (PREPROCESSOR_WORDS.has(source.slice(i + 1, k))) {
        pushToken("preprocessor", i, k);
        nameNext = false;
        i = k;
      } else {
        lineComment();
      }
      continue;
    }

    // A # later in the line is an ARM immediate (a number) or the start of a comment.
    if (ch === "#") {
      const before = charBefore(i);
      const next = source[i + 1];
      let immediate = false;
      if (before === "," || before === "[" || before === "{" || before === "(" || before === "=") {
        immediate = next !== undefined && IMMEDIATE_AFTER_COMMA.test(next);
      } else if (lastWasName) {
        immediate = next !== undefined && IMMEDIATE_AFTER_NAME.test(next);
      }
      if (!immediate) {
        lineComment();
        continue;
      }
      // #5, #0x10 and #-4 are one number, and #'A' is one character. #label and #(1 << 3) just get a plain #.
      const signed = next === "-" || next === "+" ? 1 : 0;
      if (next === "'") {
        const end = singleQuoteEnd(source, i + 1);
        pushToken("string", i, end);
        nameNext = false;
        i = end;
      } else if (isDigit(source[i + 1 + signed])) {
        const end = numberEnd(source, i + 1 + signed);
        pushToken("number", i, end);
        nameNext = false;
        i = end;
      } else {
        pushToken("plain", i, i + 1);
        nameNext = false;
        i++;
      }
      continue;
    }

    // An @ is an ARM comment after a space, but not after a comma (.type f, @function).
    if (ch === "@") {
      if (afterSpace(i) && charBefore(i) !== ",") {
        lineComment();
      } else {
        pushToken("plain", i, i + 1);
        nameNext = false;
        i++;
      }
      continue;
    }

    // Strings and characters. A string that is never closed stops at the end of the line.
    if (ch === '"' || ch === "`") {
      const { end } = quotedEnd(source, i);
      pushToken("string", i, end);
      nameNext = false;
      i = end;
      continue;
    }
    if (ch === "'") {
      const end = singleQuoteEnd(source, i);
      pushToken("string", i, end);
      nameNext = false;
      i = end;
      continue;
    }

    // A label: a name and a colon at the start of the line (main:, .Lloop:, 1:).
    if (nameNext && isWordPart(ch)) {
      let k = i;
      while (k < n && isWordPart(source[k])) {
        k++;
      }
      if (k > i && source[k] === ":") {
        pushToken("plain", i, k + 1);
        i = k + 1;
        continue;
      }
    }

    // A NASM bracket line like [bits 32] or [org 0x7c00]: the directive is still the first word.
    if (ch === "[" && nameNext && tokensOnLine === 0) {
      pushToken("plain", i, i + 1);
      i++;
      continue;
    }

    // %define and %macro (NASM) at the start of a line, and AT&T registers like %rax and %function.
    if (ch === "%") {
      let k = i + 1;
      while (isAlphaNumeric(source[k])) {
        k++;
      }
      const word = source.slice(i + 1, k);
      if (tokensOnLine === 0 && isLetter(source[i + 1])) {
        pushToken("preprocessor", i, k);
        nameNext = false;
      } else if (k > i + 1 && isLetter(source[i + 1]) && isRegister(word)) {
        pushToken("type", i, k);
        nameNext = false;
      } else {
        pushToken("plain", i, i + 1);
        nameNext = false;
        k = i + 1;
      }
      i = k;
      continue;
    }

    // A $: x86 immediates ($42), MIPS registers ($t0) or the NASM current address ($).
    if (ch === "$") {
      const next = source[i + 1];
      const signed = next === "-" || next === "+" ? 1 : 0;
      let end = i + 1;
      let kind: TokenKind = "plain";
      if (isDigit(source[i + 1 + signed])) {
        end = numberEnd(source, i + 1 + signed);
        kind = "number";
      } else if (isLetter(next)) {
        while (isAlphaNumeric(source[end])) {
          end++;
        }
        const word = source.slice(i + 1, end).toLowerCase();
        kind = isRegister(word) || DOLLAR_ONLY_REGISTERS.has(word) ? "type" : "plain";
      }
      pushToken(kind, i, end);
      nameNext = false;
      i = end;
      continue;
    }

    if (isDigit(ch)) {
      const end = numberEnd(source, i);
      pushToken("number", i, end);
      nameNext = false;
      i = end;
      continue;
    }

    if (isLetter(ch) || ch === ".") {
      const end = wordEnd(source, i);
      const word = source.slice(i, end);
      const lower = word.toLowerCase();

      if (nameNext) {
        if (word.length > 1 && ch === ".") {
          pushToken("preprocessor", i, end);
          nameNext = false;
        } else if (LEADING_DIRECTIVES.has(lower) || DATA_WORDS.has(lower)) {
          pushToken("preprocessor", i, end);
          nameNext = false;
        } else if (DATA_WORDS.has(wordAfterSpaces(end))) {
          // A name before db, equ, resb ... (msg db "hi"), so it is a label with no colon.
          pushToken("plain", i, end);
        } else if (PREFIX_WORDS.has(lower)) {
          pushToken("keyword", i, end);
        } else if (ch === ".") {
          // A lone . is the current address, not an instruction.
          pushToken("plain", i, end);
          nameNext = false;
        } else {
          pushToken("keyword", i, end, true);
          nameNext = false;
        }
        i = end;
        continue;
      }

      if (DATA_WORDS.has(lower)) {
        pushToken("preprocessor", i, end);
      } else if (SIZE_WORDS.has(lower)) {
        pushToken("type", i, end);
      } else {
        // A register with something after a dot, like v0.16b: the register is one token and the rest another.
        const dot = word.indexOf(".");
        const base = dot > 0 ? word.slice(0, dot) : word;
        if (isRegister(base)) {
          pushToken("type", i, i + base.length);
          push("plain", i + base.length, end);
        } else {
          pushToken("plain", i, end);
        }
      }
      i = end;
      continue;
    }

    // Everything else (operators, brackets, commas) is plain. Takes a surrogate pair as one character.
    const codePoint = source.codePointAt(i) ?? 0;
    const length = codePoint > 0xffff ? 2 : 1;
    pushToken("plain", i, i + length);
    nameNext = false;
    i += length;
  }

  return builder.lines();
}
