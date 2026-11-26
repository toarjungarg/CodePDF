// A small tokenizer for TOML syntax colouring (.toml). Like the others, it
// labels pieces of code without changing a single character: joining every
// token's text gives back the original. It is pattern-based, not a full
// parser, and it never throws.
//
// TOML reuses the shared colours like this (the same scheme as JSON and YAML):
//   keyword  table headers ([package] and [[bin]], dots and quoted parts included),
//            and the words true and false
//   type     keys (name, "quoted key", a.b.c), also inside inline tables { k = v }
//   string   "basic" and 'literal' strings, and the multi-line """ and ''' forms
//   number   numbers (1_000, 0xFF, 0o17, 0b101, 1.5e3, +inf, nan) and dates and
//            times (1979-05-27, 07:32:00, 1979-05-27T07:32:00Z)
//   comment  # to the end of the line (never inside a string)
//   plain    everything else
//
// Things worth knowing:
//   - A line starts as a header (it begins with [) or as a key (it ends in =).
//     The text after the = is a value. A word with no = after it is plain.
//   - A single line string with no closing quote ends at the end of its line.
//     A multi-line string with no closing delimiter runs to the end of the file.
//   - A multi-line string can end in up to two extra quotes: """a"" """ is fine,
//     and so is """a"""" (the extra quote is part of the text).
//   - Arrays [ ... ] can run over several lines. Inline tables { ... } stay on one
//     line, so a { that is never closed ends at the end of its line.
//   - If an array is never closed, the next line that looks like a key or a
//     header ends it, so one typo can't colour the rest of the file as an array.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** A whole bare value that is a number: ints (with _ between digits), floats, hex, octal, binary, inf and nan. */
const NUMBER = /^(?:[+-]?\d(?:_?\d)*(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?|0x[0-9a-fA-F](?:_?[0-9a-fA-F])*|0o[0-7](?:_?[0-7])*|0b[01](?:_?[01])*|[+-]?(?:inf|nan))$/;

/** A date and time, a date alone, or a time alone. The "y" flag makes each one match only at lastIndex. */
const DATE_TIME = /\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})?)?/y;
const LOCAL_TIME = /\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?/y;

/** What a header like [a.b] or [[a.b]] on its own line looks like, used to spot a header inside an unclosed array. */
const HEADER_LIKE = /\[\[?[ \t]*[A-Za-z_][^\]\[,=\n]*\]\]?[ \t\r]*(?:#[^\n]*)?(?:\n|$)/y;

/** Characters in a bare key (the part of a key that has no quotes). */
const isBareKeyChar = (ch: string | undefined): boolean => ch !== undefined && /[A-Za-z0-9_-]/.test(ch);

/** Characters a bare value (a number, true, false, inf and so on) can be made of. */
const isBareValueChar = (ch: string | undefined): boolean => ch !== undefined && /[A-Za-z0-9_+\-.:]/.test(ch);

const isSpaceOrTab = (ch: string | undefined): boolean => ch === " " || ch === "\t";

/** An open [ or { that has not been closed yet. A { is looking for a key until its next =. */
interface Open {
  bracket: "[" | "{";
  expectKey: boolean;
}

export function tokenizeToml(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;
  let i = 0;

  /** The [ and { that are open right now, innermost last. Empty at the top level. */
  const stack: Open[] = [];
  /** At the top level: "key" (a key or header comes next), "value" (right after =) or "after" (the rest of the line). */
  let mode: "key" | "value" | "after" = "key";

  const lineEnd = (pos: number): number => {
    const end = source.indexOf("\n", pos);
    return end === -1 ? n : end;
  };

  /**
   * Where a quoted string that starts at `start` ends, on one line. Returns the
   * end (after the closing quote), or -1 if the line ends first.
   */
  const scanQuoted = (start: number): number => {
    const quote = source[start]!;
    let j = start + 1;
    while (j < n) {
      const ch = source[j]!;
      if (ch === "\n") {
        return -1;
      }
      if (ch === "\\" && quote === '"') {
        // A backslash goes together with the character after it, so \" does not end the string.
        j += source[j + 1] === "\n" ? 1 : 2;
        continue;
      }
      if (ch === quote) {
        return j + 1;
      }
      j++;
    }
    return -1;
  };

  /** Where a string that starts at `start` ends. A string with no closing quote ends at the end of its line. */
  const singleLineStringEnd = (start: number): number => {
    const end = scanQuoted(start);
    return end === -1 ? lineEnd(start) : end;
  };

  /** Where a """ or ''' string that starts at `start` ends. With no closing delimiter it runs to the end of the file. */
  const multiLineStringEnd = (start: number): number => {
    const quote = source[start]!;
    let j = start + 3;
    while (j < n) {
      const ch = source[j]!;
      if (ch === "\\" && quote === '"') {
        j += 2;
        continue;
      }
      if (ch === quote) {
        let run = 1;
        while (source[j + run] === quote) {
          run++;
        }
        if (run >= 3) {
          // Up to two quotes before the closing delimiter belong to the text, so a run of 3 to 5 quotes closes it.
          return j + Math.min(run, 5);
        }
        j += run;
        continue;
      }
      j++;
    }
    return n;
  };

  /**
   * Reads a key (like a, "b c" or a . "b.c") that starts at `pos` and is followed by =.
   * Returns where the key starts and ends, and where the = is, or undefined if there is no key here.
   */
  const readKey = (pos: number): { start: number; end: number; eq: number } | undefined => {
    let j = pos;
    let start = -1;
    let last = -1;
    for (;;) {
      while (isSpaceOrTab(source[j])) {
        j++;
      }
      let end = j;
      if (source[j] === '"' || source[j] === "'") {
        end = scanQuoted(j);
        if (end === -1) {
          return undefined;
        }
      } else {
        while (isBareKeyChar(source[end])) {
          end++;
        }
        if (end === j) {
          return undefined;
        }
      }
      if (start === -1) {
        start = j;
      }
      last = end;
      j = end;
      while (isSpaceOrTab(source[j])) {
        j++;
      }
      if (source[j] === ".") {
        // A dot joins two parts of a dotted key.
        j++;
        continue;
      }
      break;
    }
    return source[j] === "=" ? { start, end: last, eq: j } : undefined;
  };

  /** Colours the key at `pos` (found by readKey) and the = after it. Returns false if there is no key here. */
  const pushKey = (pos: number): boolean => {
    const key = readKey(pos);
    if (!key) {
      return false;
    }
    push("plain", pos, key.start);
    push("type", key.start, key.end);
    push("plain", key.end, key.eq + 1);
    i = key.eq + 1;
    return true;
  };

  /** A table header like [a.b] or [[a."b.c"]] that starts at `pos`. It is all one keyword colour. */
  const pushHeader = (pos: number): void => {
    let j = pos + 1;
    const doubled = source[j] === "[";
    if (doubled) {
      j++;
    }
    let closed = false;
    while (j < n) {
      const ch = source[j]!;
      if (ch === "\n" || ch === "#") {
        break;
      }
      if (ch === '"' || ch === "'") {
        const end = scanQuoted(j);
        if (end === -1) {
          // A quote with no end: the rest of the line is part of the header.
          j = lineEnd(j);
          break;
        }
        j = end;
        continue;
      }
      j++;
      if (ch === "]") {
        if (doubled && source[j] === "]") {
          j++;
        }
        closed = true;
        break;
      }
    }
    let end = j;
    if (!closed) {
      // Leave spaces (and a \r) at the end of a header with no ] as plain text.
      while (end > pos && (isSpaceOrTab(source[end - 1]) || source[end - 1] === "\r")) {
        end--;
      }
    }
    push("keyword", pos, end);
    push("plain", end, j);
    i = j;
  };

  /** Colours one value that starts at i: a string, a number, a date, true or false. [ and { open a new level. */
  const readValue = (): void => {
    const ch = source[i]!;
    if (ch === '"' || ch === "'") {
      const end = source.startsWith(ch.repeat(3), i) ? multiLineStringEnd(i) : singleLineStringEnd(i);
      push("string", i, end);
      i = end;
      return;
    }
    if (ch === "[") {
      stack.push({ bracket: "[", expectKey: false });
      push("plain", i, i + 1);
      i++;
      return;
    }
    if (ch === "{") {
      stack.push({ bracket: "{", expectKey: true });
      push("plain", i, i + 1);
      i++;
      return;
    }
    // Dates and times come first, since they have : and - and a space in them.
    for (const pattern of [DATE_TIME, LOCAL_TIME]) {
      pattern.lastIndex = i;
      const match = pattern.exec(source);
      if (match && !isBareValueChar(source[i + match[0].length])) {
        push("number", i, i + match[0].length);
        i += match[0].length;
        return;
      }
    }
    let end = i;
    while (isBareValueChar(source[end])) {
      end++;
    }
    if (end === i) {
      // Not the start of any value (like a stray = or }): one plain character.
      push("plain", i, i + 1);
      i++;
      return;
    }
    const word = source.slice(i, end);
    const kind: TokenKind = word === "true" || word === "false" ? "keyword" : NUMBER.test(word) ? "number" : "plain";
    push(kind, i, end);
    i = end;
  };

  /** True when the line that starts at `pos` (after its spaces) looks like a key or a header. */
  const looksLikeStatement = (pos: number): boolean => {
    let j = pos;
    while (isSpaceOrTab(source[j])) {
      j++;
    }
    HEADER_LIKE.lastIndex = j;
    return readKey(j) !== undefined || HEADER_LIKE.test(source);
  };

  /** A line break was just read. An inline table ends here, and so does an array when a key or header follows. */
  const lineBreak = (): void => {
    const top = stack[stack.length - 1];
    if (top === undefined) {
      mode = "key";
    } else if (top.bracket === "{" || looksLikeStatement(i)) {
      stack.length = 0;
      mode = "key";
    }
  };

  while (i < n) {
    const ch = source[i]!;
    if (ch === "\n") {
      push("plain", i, i + 1);
      i++;
      lineBreak();
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      push("plain", i, i + 1);
      i++;
      continue;
    }
    if (ch === "#") {
      const end = lineEnd(i);
      push("comment", i, end);
      i = end;
      continue;
    }

    const top = stack[stack.length - 1];
    if (top === undefined) {
      if (mode === "key") {
        if (ch === "[") {
          pushHeader(i);
          mode = "after";
        } else if (pushKey(i)) {
          // The key and its = are done, so the value comes next.
          mode = "value";
        } else {
          // Not a key: the rest of the line is plain (a quote still counts as a string).
          if (ch === '"' || ch === "'") {
            const end = singleLineStringEnd(i);
            push("string", i, end);
            i = end;
          }
          mode = "after";
        }
      } else if (mode === "value") {
        mode = "after";
        readValue();
      } else {
        // The rest of the line after a value: plain, up to a space, a # or the line end.
        let end = i;
        while (end < n && !" \t\r\n#".includes(source[end]!)) {
          end++;
        }
        push("plain", i, Math.max(end, i + 1));
        i = Math.max(end, i + 1);
      }
    } else if (top.bracket === "[") {
      if (ch === "]") {
        stack.pop();
        push("plain", i, i + 1);
        i++;
      } else if (ch === ",") {
        push("plain", i, i + 1);
        i++;
      } else {
        readValue();
      }
    } else if (ch === "}") {
      stack.pop();
      push("plain", i, i + 1);
      i++;
    } else if (ch === ",") {
      top.expectKey = true;
      push("plain", i, i + 1);
      i++;
    } else if (top.expectKey) {
      if (pushKey(i)) {
        top.expectKey = false;
      } else {
        // Not a key: one plain character, so the loop always moves forward.
        push("plain", i, i + 1);
        i++;
      }
    } else {
      readValue();
    }
  }

  return builder.lines();
}
