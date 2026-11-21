// A small tokenizer for CSS syntax colouring. Like the other tokenizers, it
// labels pieces of code without changing a single character: joining every
// token's text gives back the original. It is pattern-based, not a full parser.
//
// CSS has no keywords like C or Python, so the colours mean:
//   keyword       selectors (body, .card, #main, :hover, &) and !important
//   type          property names (color, margin, --custom-name)
//   preprocessor  at-rules (@media, @import, @keyframes)
//   number        numbers with their unit (12px, 50%, 1.5rem) and hex colours (#ff0000)
//   string        "strings" and the address inside url(...)
//   comment       /* comments */
//
// Inside a block, a statement is a nested rule if a "{" comes before the next
// ";" or "}" (as in `&:hover { ... }`), and a declaration otherwise (as in `color: red;`).

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** Words coloured as keywords in an at-rule's condition, as in `@media screen and (min-width: 600px)`. */
const CONDITION_WORDS = new Set(["and", "not", "only", "or"]);

/** A number: 12, -3, 1.5, .5, 1e3. Its unit or % is added after. The "y" flag makes it match only at lastIndex. */
const NUMBER = /[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/y;

type Mode =
  | "start" // between statements, nothing seen yet
  | "selector" // before the "{" of a rule
  | "atRule" // after an @name, before its "{" or ";"
  | "property" // a declaration's name, before the ":"
  | "value"; // a declaration's value, after the ":"

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

/** Letters, "_", "\" (an escape) and anything outside ASCII can start a name. */
function isNameStart(ch: string | undefined): boolean {
  return ch !== undefined && (/[A-Za-z_\\]/.test(ch) || ch > "\u007f");
}

function isNamePart(ch: string | undefined): boolean {
  return ch !== undefined && (isNameStart(ch) || isDigit(ch) || ch === "-");
}

/**
 * Splits CSS source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizeCss(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;

  /** Whether a name starts at i: a name-start character, or "-" or "--" followed by one. */
  const nameStartsAt = (i: number): boolean => {
    if (isNameStart(source[i])) {
      return true;
    }
    if (source[i] !== "-") {
      return false;
    }
    return isNameStart(source[i + 1]) || source[i + 1] === "-";
  };

  /** End of the name starting at i. A backslash escape (like `\:`) counts as part of the name. */
  const nameEnd = (i: number): number => {
    let j = i;
    while (j < n && isNamePart(source[j])) {
      j += source[j] === "\\" && j + 1 < n && source[j + 1] !== "\n" ? 2 : 1;
    }
    return j;
  };

  /** End of the comment that starts with the "/*" at i (the end of the file if it never closes). */
  const commentEnd = (i: number): number => {
    const close = source.indexOf("*/", i + 2);
    return close === -1 ? n : close + 2;
  };

  /** End of the string whose quote is at i. A string stops before an unescaped line break. */
  const stringEnd = (i: number): number => {
    const quote = source[i];
    let j = i + 1;
    while (j < n) {
      const ch = source[j];
      if (ch === "\\") {
        j += 2;
        continue;
      }
      if (ch === "\n") {
        return j;
      }
      if (ch === quote) {
        return j + 1;
      }
      j++;
    }
    return n;
  };

  /** Whether a "{" comes before the next ";" or "}" (skipping comments, strings and brackets). */
  const ruleAhead = (i: number): boolean => {
    let depth = 0; // open ( and [, so a ";" inside url(data:...;...) doesn't count
    let j = i;
    while (j < n) {
      const ch = source[j];
      if (ch === "/" && source[j + 1] === "*") {
        j = commentEnd(j);
        continue;
      }
      if (ch === '"' || ch === "'") {
        j = stringEnd(j);
        continue;
      }
      if (ch === "(" || ch === "[") {
        depth++;
      } else if (ch === ")" || ch === "]") {
        depth = Math.max(0, depth - 1);
      } else if (depth === 0 && (ch === ";" || ch === "}")) {
        return false;
      } else if (ch === "{") {
        return true;
      }
      j++;
    }
    return false;
  };

  /** Whether a "+" or "-" at i is a number's sign: a digit follows, and it isn't joined to the name or number before it. */
  const isSignedNumber = (i: number): boolean => {
    const next = source[i + 1];
    if (!(isDigit(next) || (next === "." && isDigit(source[i + 2])))) {
      return false;
    }
    const before = source[i - 1];
    return !(isNamePart(before) || before === ")" || before === "%");
  };

  /** Colours the number at i together with its unit or %, and returns where it ends. */
  const number = (i: number): number => {
    NUMBER.lastIndex = i;
    const match = NUMBER.exec(source);
    let j = i + (match ? match[0].length : 1);
    if (source[j] === "%") {
      j++;
    } else if (nameStartsAt(j)) {
      j = nameEnd(j);
    }
    push("number", i, j);
    return j;
  };

  let mode: Mode = "start";
  let inAttribute = false; // inside [...] in a selector, as in a[href^="http"]
  let i = 0;

  while (i < n) {
    const ch = source[i]!;

    if (isSpace(ch)) {
      let j = i + 1;
      while (j < n && isSpace(source[j])) {
        j++;
      }
      push("plain", i, j);
      i = j;
      continue;
    }

    if (ch === "/" && source[i + 1] === "*") {
      const stop = commentEnd(i);
      push("comment", i, stop);
      i = stop;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const stop = stringEnd(i);
      push("string", i, stop);
      i = stop;
      continue;
    }

    if (ch === "{" || ch === "}" || ch === ";") {
      push("plain", i, i + 1);
      mode = "start";
      inAttribute = false;
      i++;
      continue;
    }

    if (mode === "start") {
      if (ch === "@" && nameStartsAt(i + 1)) {
        const stop = nameEnd(i + 1);
        push("preprocessor", i, stop);
        mode = "atRule";
        i = stop;
        continue;
      }
      mode = ruleAhead(i) ? "selector" : "property";
    }

    if (mode === "selector") {
      if (ch === "[" || ch === "]") {
        inAttribute = ch === "[";
        push("plain", i, i + 1);
        i++;
        continue;
      }
      if (inAttribute) {
        const stop = nameStartsAt(i) ? nameEnd(i) : i + 1;
        push("plain", i, stop);
        i = stop;
        continue;
      }
      if (isDigit(ch) || (ch === "." && isDigit(source[i + 1]))) {
        i = number(i); // keyframe steps like 50% and 12.5%
        continue;
      }
      // .class, #id, :hover, ::before and plain names like body or h1.
      const colons = ch === ":" ? (source[i + 1] === ":" ? 2 : 1) : 0;
      const nameAt = ch === "." || ch === "#" ? i + 1 : i + colons;
      if (nameStartsAt(nameAt) || (ch === "#" && isNamePart(source[i + 1]))) {
        const stop = nameEnd(nameAt);
        push("keyword", i, stop);
        i = stop;
        continue;
      }
      push(ch === "&" ? "keyword" : "plain", i, i + 1);
      i++;
      continue;
    }

    if (mode === "property") {
      if (ch === ":") {
        push("plain", i, i + 1);
        mode = "value";
        i++;
        continue;
      }
      if (nameStartsAt(i)) {
        const stop = nameEnd(i);
        push("type", i, stop);
        i = stop;
        continue;
      }
      push("plain", i, i + 1);
      i++;
      continue;
    }

    // An at-rule's condition or a declaration's value.

    if (isDigit(ch) || (ch === "." && isDigit(source[i + 1])) || ((ch === "+" || ch === "-") && isSignedNumber(i))) {
      i = number(i);
      continue;
    }

    if (mode === "value" && ch === "#" && isNamePart(source[i + 1])) {
      const stop = nameEnd(i + 1);
      push("number", i, stop); // a hex colour like #ff0000
      i = stop;
      continue;
    }

    if (mode === "value" && ch === "!") {
      let j = i + 1;
      while (j < n && (source[j] === " " || source[j] === "\t")) {
        j++;
      }
      if (nameStartsAt(j) && source.slice(j, nameEnd(j)).toLowerCase() === "important") {
        const stop = nameEnd(j);
        push("keyword", i, stop);
        i = stop;
        continue;
      }
    }

    if (nameStartsAt(i)) {
      const stop = nameEnd(i);
      const word = source.slice(i, stop).toLowerCase();
      const kind = mode === "atRule" && CONDITION_WORDS.has(word) ? "keyword" : "plain";
      push(kind, i, stop);
      i = stop;
      // url(address) without quotes: the address is a string.
      if (word === "url" && source[i] === "(") {
        push("plain", i, i + 1);
        i++;
        let start = i;
        while (start < n && (source[start] === " " || source[start] === "\t")) {
          start++;
        }
        push("plain", i, start);
        i = start;
        if (source[i] !== '"' && source[i] !== "'") {
          let j = i;
          while (j < n && source[j] !== ")" && source[j] !== "\n") {
            j += source[j] === "\\" && j + 1 < n ? 2 : 1;
          }
          push("string", i, j);
          i = j;
        }
      }
      continue;
    }

    // Operators, punctuation and anything else: one character (or one surrogate pair).
    const codePoint = source.codePointAt(i) ?? 0;
    const length = codePoint > 0xffff && i + 1 < n ? 2 : 1;
    push("plain", i, i + length);
    i += length;
  }

  return builder.lines();
}
