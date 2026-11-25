// A small tokenizer for Swift syntax colouring. Like the others, it labels
// pieces of code without changing a single character, and it is
// pattern-based, not a full parser.
// The Swift-specific parts:
//   - Block comments nest (/* a /* b */ c */), and /// is just a comment.
//   - Strings can hold \(code) pieces. The text is a string, and the code
//     inside the brackets is coloured as code (it can hold its own brackets and
//     strings), the same way the Kotlin and JavaScript tokenizers do it.
//   - Multi-line strings ("""...""") can span lines and end at the first """.
//   - Raw strings (#"..."#, ##"..."##, #"""..."""#) end only at a quote followed
//     by the same number of #. In them a backslash is plain text, and the escapes
//     and \( pieces need the hashes too (\#n, \#(code)).
//   - Attributes (@MainActor, @objc, @available) and # directives (#if, #endif,
//     #available, #selector) get their own colour.
//   - `backtick names` are plain identifiers, even if they hold keywords.
//   - $0, $1 and $name are plain names, so their digits are not numbers.
//   - Hard keywords (func, let, if, ...) are always keywords, except right after
//     a "." (like .default), where they are names. Contextual words (get, set,
//     willSet, didSet, some, any, async, await, actor, and modifiers like final
//     and lazy) are only keywords where they work as keywords, so a variable
//     named get or some stays plain.
//   - A name that starts with a capital letter is coloured as a type, because
//     Swift names types that way (Int, String, URL, View).
// Regex literals (/.../ and #/.../#) are not recognised: a "/" is just an operator.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** Words that are always keywords. */
const HARD_KEYWORDS = new Set([
  "associatedtype", "as", "break", "case", "catch", "class", "continue", "default", "defer", "deinit", "do",
  "else", "enum", "extension", "fallthrough", "false", "fileprivate", "for", "func", "guard", "if", "import",
  "in", "init", "inout", "internal", "is", "let", "nil", "operator", "precedencegroup", "private", "protocol",
  "public", "repeat", "rethrows", "return", "self", "static", "struct", "subscript", "super", "switch", "throw",
  "throws", "true", "try", "typealias", "var", "where", "while",
]);

/** Hard keywords that still count as keywords right after a ".", like `self.init()` or `type.self`. */
const KEYWORDS_AFTER_DOT = new Set(["self", "init"]);

/**
 * Modifier words that sit in front of a declaration (`final class`, `override func`,
 * `lazy var`). They are keywords only when the next word is a declaration word or
 * another modifier, so `let open = 1` and `open + 1` stay plain.
 */
const DECLARATION_MODIFIERS = new Set([
  "open", "final", "lazy", "mutating", "nonmutating", "override", "required", "convenience", "dynamic",
  "indirect", "optional", "prefix", "postfix", "infix", "weak", "unowned", "nonisolated", "distributed",
  "package", "consuming", "borrowing",
]);

/** The words that may follow a modifier: the declaration itself, or another modifier. */
const DECLARATION_WORDS = new Set([
  ...DECLARATION_MODIFIERS, "class", "struct", "enum", "protocol", "extension", "func", "var", "let", "init",
  "subscript", "typealias", "associatedtype", "deinit", "case", "operator", "actor", "static", "public",
  "private", "internal", "fileprivate", "get", "set",
]);

/** Modifiers in front of a parameter type (`isolated MyActor`, `consuming Loaf`). */
const PARAMETER_MODIFIERS = new Set(["isolated", "consuming", "borrowing", "sending"]);

/** Access words that can come before `(set)`, as in `private(set) var`. */
const VISIBILITY = new Set(["open", "public", "package", "internal", "fileprivate", "private"]);

/** Words that can come right before an accessor like get or set, besides a { } or ;. */
const BEFORE_ACCESSOR = new Set(["mutating", "nonmutating", "get", "set"]);

/** Words that can follow a bare accessor in a protocol, like `{ get async throws }`. */
const AFTER_ACCESSOR = new Set(["get", "set", "async", "throws", "rethrows"]);

/** Words after `await` that mean it is just a name, as in `await in` or `await as Int`. */
const NOT_AFTER_AWAIT = new Set(["in", "as", "is", "where", "else"]);

const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}\p{M}_]/u;
const UPPERCASE_START = /^\p{Lu}/u;

/** `set(newValue) {` or `willSet(v) {` right after the word set. */
const SETTER_SHAPE = /^[ \t]*\([ \t]*[\p{L}_][\p{L}\p{N}_]*[ \t]*(?::[^)]*)?\)[ \t]*\{/u;
/** `actor Counter {`, `actor Cache<T> {` or `actor Store: Base {` after the word actor. */
const ACTOR_SHAPE = /^[ \t]+([\p{L}_][\p{L}\p{N}_]*)[ \t]*[{:<]/u;
/** `(safe)` or `(unsafe)` after unowned or nonisolated. */
const SAFETY_SHAPE = /^[ \t]*\((?:safe|unsafe)\)/;

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isHexDigit(ch: string | undefined): boolean {
  return ch !== undefined && /[0-9a-fA-F]/.test(ch);
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

function identEnd(src: string, i: number, limit: number): number {
  let j = i;
  while (j < limit && isIdentPart(src[j])) {
    j++;
  }
  return j;
}

/** A type name by convention: starts with a capital letter (Int, URL, View). */
function looksLikeType(word: string): boolean {
  return UPPERCASE_START.test(word);
}

/** How many times `ch` repeats starting at i (never past `limit`). */
function runLength(src: string, i: number, ch: string, limit: number): number {
  let j = i;
  while (j < limit && src[j] === ch) {
    j++;
  }
  return j - i;
}

/** The index of the next newline at or after i, or `limit`. */
function lineEnd(src: string, i: number, limit: number): number {
  const nl = src.indexOf("\n", i);
  return nl === -1 || nl > limit ? limit : nl;
}

/** End of a `backtick name` whose backtick is at i. Stops at a newline if it never closes. */
function backtickEnd(src: string, i: number, limit: number): number {
  let j = i + 1;
  while (j < limit && src[j] !== "`" && src[j] !== "\n") {
    j++;
  }
  return src[j] === "`" && j < limit ? j + 1 : j;
}

/**
 * End of a number: 42, 1_000, 0xFF, 0b1010, 0o755, 3.14, 1.5e10, 0x1.8p3.
 * A "." only belongs to the number when a digit follows, so `1...10` and `1.5.rounded()` stop at the right dot.
 * With `memberIndex` (the number comes right after a ".", like the 0 in `pair.0.1`) only whole digits count.
 */
function numberEnd(src: string, i: number, limit: number, memberIndex: boolean): number {
  let j = i;
  const digits = (pattern: RegExp): void => {
    while (j < limit && pattern.test(src[j]!)) {
      j++;
    }
  };
  const exponent = (marker: RegExp): void => {
    if (marker.test(src[j] ?? "") && (isDigit(src[j + 1]) || (/[+-]/.test(src[j + 1] ?? "") && isDigit(src[j + 2])))) {
      j += 2;
      digits(/[0-9_]/);
    }
  };
  if (memberIndex) {
    digits(/[0-9]/);
  } else if (src[i] === "0" && /[xX]/.test(src[i + 1] ?? "")) {
    j = i + 2;
    digits(/[0-9a-fA-F_]/);
    // A hex float needs a p exponent. Without one, the "." is a member access (0xFF.description).
    if (src[j] === "." && isHexDigit(src[j + 1])) {
      let k = j + 1;
      while (k < limit && /[0-9a-fA-F_]/.test(src[k]!)) {
        k++;
      }
      if (/[pP]/.test(src[k] ?? "")) {
        j = k;
      }
    }
    exponent(/[pP]/);
  } else if (src[i] === "0" && /[bB]/.test(src[i + 1] ?? "")) {
    j = i + 2;
    digits(/[01_]/);
  } else if (src[i] === "0" && /[oO]/.test(src[i + 1] ?? "")) {
    j = i + 2;
    digits(/[0-7_]/);
  } else {
    digits(/[0-9_]/);
    if (src[j] === "." && isDigit(src[j + 1])) {
      j++;
      digits(/[0-9_]/);
    }
    exponent(/[eE]/);
  }
  return Math.min(j, limit);
}

/** One `\(code)` piece inside a string: the code is source[open..close). */
interface InterpolationPart {
  /** Index of the backslash. */
  start: number;
  /** Where the code starts (just after the "("). */
  open: number;
  /** Index of the ")" that ends the code. */
  close: number;
}

/** Whether a string literal (with its # marks, if any) starts at i. */
function stringStartsAt(src: string, i: number, limit: number): boolean {
  return src[i + runLength(src, i, "#", limit)] === '"';
}

/**
 * Finds the end of a string literal that starts at i (at its first # or its
 * first quote), and every \(code) piece inside it. Both the colouring and the
 * search for the end of a \( ... ) use this, so they always agree on where a
 * string stops.
 */
function stringParts(src: string, i: number, limit: number): { end: number; parts: InterpolationPart[] } {
  const parts: InterpolationPart[] = [];
  const hashes = runLength(src, i, "#", limit);
  const hashText = "#".repeat(hashes);
  const quoteAt = i + hashes;
  const multiline = runLength(src, quoteAt, '"', limit) >= 3;
  const closing = (multiline ? '"""' : '"') + hashText;
  let j = quoteAt + (multiline ? 3 : 1);
  while (j < limit) {
    const ch = src[j]!;
    if (ch === "\\") {
      // In a raw string a backslash only means something when the same # marks follow it.
      if (hashes > 0 && !src.startsWith(hashText, j + 1)) {
        j++;
        continue;
      }
      const afterMarks = j + 1 + hashes;
      if (src[afterMarks] === "(") {
        const close = holeClose(src, afterMarks + 1, multiline ? limit : lineEnd(src, j, limit));
        if (close !== -1) {
          parts.push({ start: j, open: afterMarks + 1, close });
          j = close + 1;
          continue;
        }
      }
      // Any other escape (\n, \", \\, \u{...}) skips the character after it. A "..." string can't span lines.
      j = afterMarks + (src[afterMarks] === "\n" && !multiline ? 0 : 1);
      continue;
    }
    if (ch === "\n" && !multiline) {
      return { end: j, parts };
    }
    if (ch === '"' && src.startsWith(closing, j)) {
      return { end: Math.min(j + closing.length, limit), parts };
    }
    j++;
  }
  return { end: limit, parts };
}

/**
 * Finds the ")" that closes a `\(` whose code starts at `from`, or -1 if it
 * never closes before `limit`. Strings inside are skipped, so a ")" in them
 * doesn't count.
 */
function holeClose(src: string, from: number, limit: number): number {
  let depth = 0;
  let j = from;
  while (j < limit) {
    const ch = src[j]!;
    if ((ch === '"' || ch === "#") && stringStartsAt(src, j, limit)) {
      j = stringParts(src, j, limit).end;
      continue;
    }
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      if (depth === 0) {
        return j;
      }
      depth--;
    }
    j++;
  }
  return -1;
}

/**
 * Splits Swift source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizeSwift(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;

  /** The last character before i that isn't a space or newline, and where it is. */
  const prevSignificant = (i: number): { ch: string; at: number } | undefined => {
    let j = i - 1;
    while (j >= 0 && (source[j] === "\n" || isInlineSpace(source[j]))) {
      j--;
    }
    return j >= 0 ? { ch: source[j]!, at: j } : undefined;
  };

  /** The word that ends right before i (skipping spaces and newlines), or "". */
  const prevWord = (i: number): string => {
    const prev = prevSignificant(i);
    if (prev === undefined || !isIdentPart(prev.ch)) {
      return "";
    }
    let from = prev.at;
    while (from > 0 && isIdentPart(source[from - 1])) {
      from--;
    }
    return source.slice(from, prev.at + 1);
  };

  /** The first index at or after i that isn't a space or tab. */
  const skipSpace = (i: number): number => {
    let j = i;
    while (j < n && isInlineSpace(source[j])) {
      j++;
    }
    return j;
  };

  /** The word that follows on the same line (after spaces), or "". */
  const wordAfter = (i: number): string => {
    const j = skipSpace(i);
    return isIdentStart(source[j]) ? source.slice(j, identEnd(source, j, n)) : "";
  };

  /**
   * Whether the word at i comes right after a single "." (like `.default` or `list.get`), so it is a name and not a keyword.
   * Only the character straight before counts, so a comment that ends with a full stop doesn't fool it.
   */
  const afterMember = (i: number): boolean => source[i - 1] === "." && source[i - 2] !== ".";

  /** Whether a get/set/willSet/didSet at i is where an accessor can start: after { } ; or a modifier like mutating. */
  const accessorStart = (i: number): boolean => {
    const prev = prevSignificant(i);
    return prev === undefined || "{};".includes(prev.ch) || BEFORE_ACCESSOR.has(prevWord(i));
  };

  /** The colour for a word that isn't a hard keyword, using what is around it. */
  const softKind = (word: string, start: number, end: number): TokenKind => {
    const next = source[skipSpace(end)];
    const nextWord = wordAfter(end);
    const rest = source.slice(end, end + 200);
    const prev = prevSignificant(start);

    if (DECLARATION_MODIFIERS.has(word)) {
      if (DECLARATION_WORDS.has(nextWord)) {
        return "keyword";
      }
      // `unowned(unsafe) var` and `nonisolated(unsafe) let`.
      if ((word === "unowned" || word === "nonisolated") && SAFETY_SHAPE.test(rest)) {
        return "keyword";
      }
    }
    if (PARAMETER_MODIFIERS.has(word)) {
      return nextWord && !HARD_KEYWORDS.has(nextWord) ? "keyword" : "plain";
    }
    switch (word) {
      case "get": {
        // `{ get }`, `get {`, `get async throws`, but not a call like `get(1)`.
        const shape = next === "{" || next === "}" || next === ";" || next === "/" || next === "\n" || next === undefined || AFTER_ACCESSOR.has(nextWord);
        return accessorStart(start) && shape ? "keyword" : "plain";
      }
      case "set": {
        const shape = next === "{" || next === "}" || next === ";" || next === "/" || next === "\n" || next === undefined || AFTER_ACCESSOR.has(nextWord);
        if (accessorStart(start) && (shape || SETTER_SHAPE.test(rest))) {
          return "keyword";
        }
        // The set in `private(set) var`.
        return prev !== undefined && prev.ch === "(" && VISIBILITY.has(prevWord(prev.at)) && next === ")" ? "keyword" : "plain";
      }
      case "willSet":
      case "didSet":
        return accessorStart(start) && (next === "{" || next === "(") ? "keyword" : "plain";
      case "some":
      case "any":
        // `some View` or `any Shape` in a type spot: after a : -> ( , < = [ or as/is, and before a name.
        return nextWord && !HARD_KEYWORDS.has(nextWord) && ((prev !== undefined && ":>(,<=[?!".includes(prev.ch)) || prevWord(start) === "as" || prevWord(start) === "is") ? "keyword" : "plain";
      case "async":
        // `func f() async`, `() async -> Int`, `async throws`, and `async let x = ...`.
        return (prev !== undefined && prev.ch === ")") || nextWord === "throws" || nextWord === "rethrows" || nextWord === "let" ? "keyword" : "plain";
      case "await":
        return (nextWord && !NOT_AFTER_AWAIT.has(nextWord)) || (next !== undefined && '([\\"'.includes(next)) ? "keyword" : "plain";
      case "actor": {
        // `actor Counter {`: a name and then { : or <.
        const shape = ACTOR_SHAPE.exec(rest);
        return shape !== null && !HARD_KEYWORDS.has(shape[1]!) ? "keyword" : "plain";
      }
    }
    return "plain";
  };

  const kindOfWord = (word: string, start: number, end: number): TokenKind => {
    if (afterMember(start)) {
      if (KEYWORDS_AFTER_DOT.has(word)) {
        return "keyword";
      }
    } else if (HARD_KEYWORDS.has(word)) {
      return "keyword";
    } else {
      const soft = softKind(word, start, end);
      if (soft !== "plain") {
        return soft;
      }
    }
    return looksLikeType(word) ? "type" : "plain";
  };

  /** Colours the string that starts at i: the text as string, the code inside \( ) as code. Returns where it ends. */
  const stringLiteral = (i: number, limit: number): number => {
    const { end, parts } = stringParts(source, i, limit);
    let textStart = i;
    for (const part of parts) {
      push("string", textStart, part.start);
      push("plain", part.start, part.open);
      scan(part.open, part.close);
      push("plain", part.close, part.close + 1);
      textStart = part.close + 1;
    }
    push("string", textStart, end);
    return end;
  };

  /** Colours source[start..limit). A nested block comment or string never goes past `limit`. */
  const scan = (start: number, limit: number): void => {
    let i = start;

    while (i < limit) {
      const ch = source[i]!;

      if (ch === "\n" || isInlineSpace(ch)) {
        let j = i + 1;
        while (j < limit && (source[j] === "\n" || isInlineSpace(source[j]))) {
          j++;
        }
        push("plain", i, j);
        i = j;
        continue;
      }

      // A #! line at the very top of a script.
      if (ch === "#" && i === 0 && source[1] === "!") {
        const end = lineEnd(source, 0, limit);
        push("comment", 0, end);
        i = end;
        continue;
      }

      if (ch === "/" && source[i + 1] === "/") {
        const end = lineEnd(source, i, limit);
        push("comment", i, end);
        i = end;
        continue;
      }

      if (ch === "/" && source[i + 1] === "*") {
        // Block comments nest: count how many are open, and stop when they are all closed.
        let depth = 1;
        let j = i + 2;
        while (j < limit && depth > 0) {
          if (source[j] === "/" && source[j + 1] === "*") {
            depth++;
            j += 2;
          } else if (source[j] === "*" && source[j + 1] === "/") {
            depth--;
            j += 2;
          } else {
            j++;
          }
        }
        push("comment", i, j);
        i = j;
        continue;
      }

      if (ch === '"' || (ch === "#" && stringStartsAt(source, i, limit))) {
        i = stringLiteral(i, limit);
        continue;
      }

      // A # directive or macro: #if, #endif, #available, #selector, #Preview.
      if (ch === "#" && isIdentStart(source[i + 1])) {
        const end = identEnd(source, i + 1, limit);
        push("preprocessor", i, end);
        i = end;
        continue;
      }

      // An attribute like @MainActor or @objc (or a qualified one like @Foo.Bar).
      if (ch === "@" && isIdentStart(source[i + 1])) {
        let end = identEnd(source, i + 1, limit);
        while (source[end] === "." && isIdentStart(source[end + 1])) {
          end = identEnd(source, end + 1, limit);
        }
        push("preprocessor", i, end);
        i = end;
        continue;
      }

      // $0, $1 and $name (closure arguments and property wrapper values) are plain names.
      if (ch === "$" && isIdentPart(source[i + 1])) {
        const end = identEnd(source, i + 1, limit);
        push("plain", i, end);
        i = end;
        continue;
      }

      if (ch === "`") {
        const end = backtickEnd(source, i, limit);
        push("plain", i, end);
        i = end;
        continue;
      }

      if (isIdentStart(ch)) {
        const end = identEnd(source, i, limit);
        push(kindOfWord(source.slice(i, end), i, end), i, end);
        i = end;
        continue;
      }

      if (isDigit(ch)) {
        const memberIndex = source[i - 1] === "." && source[i - 2] !== ".";
        const end = numberEnd(source, i, limit, memberIndex);
        push("number", i, end);
        i = end;
        continue;
      }

      // Operators, punctuation and anything else: one character (or one surrogate pair).
      // That covers -> ... ..< ?? ? ! and custom operators too, which stay plain.
      const codePoint = source.codePointAt(i) ?? 0;
      const length = codePoint > 0xffff ? 2 : 1;
      push("plain", i, i + length);
      i += length;
    }
  };

  scan(0, n);
  return builder.lines();
}
