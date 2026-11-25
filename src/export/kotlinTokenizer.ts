// A small tokenizer for Kotlin syntax colouring. Like the others, it labels
// pieces of code without changing a single character, and it is
// pattern-based, not a full parser.
// The Kotlin-specific parts:
//   - Block comments nest (/* a /* b */ c */), and /** ... */ is just a comment.
//   - Strings have templates: $name and ${code}. The text is a string, and the
//     code inside ${...} is coloured as code (it can hold its own strings and
//     braces), the same way the JavaScript and C# tokenizers do it.
//   - Raw strings ("""...""") have no escapes, can span lines, and still have
//     templates. A run of 3 or more quotes ends one, so """a"""" is a" in quotes.
//   - Annotations (@Foo, @file:JvmName) get their own colour.
//   - A label like return@forEach or this@Outer keeps its @name part plain.
//   - `backtick names` are plain identifiers, even if they hold spaces or keywords.
//   - Hard keywords (fun, val, if, ...) are always keywords. Soft and modifier
//     words (data, sealed, override, by, get, set, value, ...) are only keywords
//     where they work as keywords, so `val value = 1` and `data.size` stay plain.
//   - A name that starts with a capital letter and has a lowercase letter is
//     coloured as a type (Int, String, List), following Kotlin's naming habits.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** Words that are always keywords. */
const HARD_KEYWORDS = new Set([
  "as", "break", "class", "continue", "do", "else", "false", "for", "fun", "if", "in", "interface", "is",
  "null", "object", "package", "return", "super", "this", "throw", "true", "try", "typealias", "typeof",
  "val", "var", "when", "while",
]);

/**
 * Modifier words that sit in front of a declaration (`data class`, `private val`,
 * `override fun`). They are keywords only when the next word on the line is a
 * declaration word or another modifier, so `val open = 1` and `value + 1` stay plain.
 */
const DECLARATION_MODIFIERS = new Set([
  "abstract", "actual", "annotation", "companion", "const", "data", "enum", "expect", "external", "final",
  "fun", "infix", "inline", "inner", "internal", "lateinit", "open", "operator", "override", "private",
  "protected", "public", "sealed", "suspend", "tailrec", "value",
]);

/** The words that may follow a modifier: the declaration itself, or another modifier. */
const DECLARATION_WORDS = new Set([
  ...DECLARATION_MODIFIERS, "class", "interface", "object", "val", "var", "typealias", "constructor", "get", "set",
]);

/** Modifiers in front of a parameter or type parameter (`vararg items: Int`, `<reified T>`). */
const PARAMETER_MODIFIERS = new Set(["vararg", "noinline", "crossinline", "reified"]);

const VISIBILITY = new Set(["public", "private", "protected", "internal"]);

const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}\p{M}_]/u;
const LOWERCASE = /\p{Ll}/u;
const UPPERCASE_START = /^\p{Lu}/u;

/** `get() = ...`, `get() { ...` or `get(): Int ...` right after the word get. */
const GETTER_SHAPE = /^[ \t]*\([ \t]*\)[ \t]*[:{=]/;
/** `set(value) { ...` or `set(v: Int) = ...` right after the word set. */
const SETTER_SHAPE = /^[ \t]*\([ \t]*[\p{L}_][\p{L}\p{N}_]*[ \t]*(?::[^)]*)?\)[ \t]*[{=]/u;
/** `where T : Comparable<T>` after the word where. */
const WHERE_SHAPE = /^[ \t]+[\p{L}_][\p{L}\p{N}_]*[ \t]*:(?!:)/u;

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
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\f";
}

function identEnd(src: string, i: number, limit: number): number {
  let j = i;
  while (j < limit && isIdentPart(src[j])) {
    j++;
  }
  return j;
}

/** A type name by convention: starts with a capital and has a lowercase letter (String, T, ArrayList), unlike a CONSTANT. */
function looksLikeType(word: string): boolean {
  return UPPERCASE_START.test(word) && (word.length === 1 || LOWERCASE.test(word));
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

/** End of a 'c' character literal whose quote is at i. Stops at an unescaped newline. */
function charEnd(src: string, i: number, limit: number): number {
  let j = i + 1;
  while (j < limit) {
    const ch = src[j];
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === "'") {
      return j + 1;
    }
    if (ch === "\n") {
      return j;
    }
    j++;
  }
  return limit;
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
 * End of a number: 42, 1_000, 0xFF, 0b1010, 3.14, 1.5e10, 2.5f, 10L, 7u, 0xFFuL.
 * A "." only belongs to the number when a digit follows, so `1..10` and `1.toString()` stop at the dot.
 */
function numberEnd(src: string, i: number, limit: number): number {
  let j = i;
  let decimal = true;
  const digits = (pattern: RegExp): void => {
    while (j < limit && pattern.test(src[j]!)) {
      j++;
    }
  };
  if (src[i] === "0" && /[xX]/.test(src[i + 1] ?? "")) {
    decimal = false;
    j = i + 2;
    digits(/[0-9a-fA-F_]/);
  } else if (src[i] === "0" && /[bB]/.test(src[i + 1] ?? "")) {
    decimal = false;
    j = i + 2;
    digits(/[01_]/);
  } else {
    digits(/[0-9_]/);
    if (src[j] === "." && isDigit(src[j + 1])) {
      j++;
      digits(/[0-9_]/);
    }
    if (/[eE]/.test(src[j] ?? "") && (isDigit(src[j + 1]) || (/[+-]/.test(src[j + 1] ?? "") && isDigit(src[j + 2])))) {
      j += 2;
      digits(/[0-9_]/);
    }
  }
  // Suffixes: f or F (decimal only), or u/U and/or L.
  if (decimal && /[fF]/.test(src[j] ?? "")) {
    j++;
  } else {
    if (/[uU]/.test(src[j] ?? "")) {
      j++;
    }
    if (src[j] === "L") {
      j++;
    }
  }
  return Math.min(j, limit);
}

/** One template inside a string: `$name` (the name is source[open..close)) or `${code}` (the code is source[open..close)). */
interface TemplatePart {
  /** Index of the `$`. */
  dollar: number;
  /** Where the name or the code starts. */
  open: number;
  /** Where the name or the code ends. */
  close: number;
  braces: boolean;
}

/**
 * Finds the end of a string literal whose first quote is at i, and every
 * template inside it. Both the colouring and the search for the end of a
 * `${...}` use this, so they always agree on where a string stops.
 */
function stringParts(src: string, i: number, limit: number): { end: number; parts: TemplatePart[] } {
  const parts: TemplatePart[] = [];
  const raw = runLength(src, i, '"', limit) >= 3;
  let j = raw ? i + 3 : i + 1;
  while (j < limit) {
    const ch = src[j]!;
    if (!raw && ch === "\\") {
      j += src[j + 1] === "\n" ? 1 : 2;
      continue;
    }
    if (!raw && ch === "\n") {
      return { end: j, parts }; // a "..." string can't span lines
    }
    if (ch === '"') {
      if (!raw) {
        return { end: j + 1, parts };
      }
      // In a raw string, a run of 3 or more quotes ends it, and the last 3 are the closing ones.
      const run = runLength(src, j, '"', limit);
      j += run;
      if (run >= 3) {
        return { end: j, parts };
      }
      continue;
    }
    if (ch === "$") {
      if (src[j + 1] === "{") {
        const close = holeClose(src, j + 2, raw ? limit : lineEnd(src, j, limit));
        if (close !== -1) {
          parts.push({ dollar: j, open: j + 2, close, braces: true });
          j = close + 1;
          continue;
        }
      } else if (j + 1 < limit && isIdentStart(src[j + 1])) {
        const close = identEnd(src, j + 1, limit);
        parts.push({ dollar: j, open: j + 1, close, braces: false });
        j = close;
        continue;
      }
    }
    j++;
  }
  return { end: limit, parts };
}

/**
 * Finds the `}` that closes a `${` whose code starts at `from`, or -1 if it
 * never closes before `limit`. Strings and characters inside are skipped, so a
 * "}" in them doesn't count.
 */
function holeClose(src: string, from: number, limit: number): number {
  let depth = 0;
  let j = from;
  while (j < limit) {
    const ch = src[j]!;
    if (ch === '"') {
      j = stringParts(src, j, limit).end;
      continue;
    }
    if (ch === "'") {
      j = charEnd(src, j, limit);
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
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
 * Splits Kotlin source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizeKotlin(source: string): TokenLine[] {
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

  /** The word before i (skipping spaces on the same line), or "". */
  const prevWord = (i: number): string => {
    let j = i;
    while (j > 0 && isInlineSpace(source[j - 1])) {
      j--;
    }
    const end = j;
    while (j > 0 && isIdentPart(source[j - 1])) {
      j--;
    }
    return source.slice(j, end);
  };

  /** Whether only spaces come before i on its line. */
  const firstOnLine = (i: number): boolean => {
    let j = i - 1;
    while (j >= 0 && isInlineSpace(source[j])) {
      j--;
    }
    return j < 0 || source[j] === "\n";
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

  /** Whether the word at i comes after a "." or "::" (like `list.get` or `Foo::get`), so it is a name and not a keyword. */
  const afterMember = (i: number): boolean => {
    const prev = prevSignificant(i);
    return prev !== undefined && (prev.ch === "." || (prev.ch === ":" && source[prev.at - 1] === ":"));
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
      // A function type like `suspend () -> Unit`.
      return word === "suspend" && next === "(" && prev !== undefined && ":<,(=".includes(prev.ch) ? "keyword" : "plain";
    }
    if (PARAMETER_MODIFIERS.has(word)) {
      return nextWord && !HARD_KEYWORDS.has(nextWord) ? "keyword" : "plain";
    }
    switch (word) {
      case "out":
        // `<out T>` in a generic, but not `System.out` or a variable named out.
        return nextWord && prev !== undefined && "<,".includes(prev.ch) ? "keyword" : "plain";
      case "by":
        // `val x by lazy { }` and `class A : B by c`: a name or bracket before, a name after.
        return nextWord && !HARD_KEYWORDS.has(nextWord) && prev !== undefined && (isIdentPart(prev.ch) || ")>?]".includes(prev.ch)) ? "keyword" : "plain";
      case "get":
        // `fun get() = ...` declares a function named get, which is not a getter.
        return (GETTER_SHAPE.test(rest) && prevWord(start) !== "fun") || (VISIBILITY.has(prevWord(start)) && endsStatement(next)) ? "keyword" : "plain";
      case "set":
        return SETTER_SHAPE.test(rest) || (VISIBILITY.has(prevWord(start)) && endsStatement(next)) ? "keyword" : "plain";
      case "init":
        return next === "{" && (firstOnLine(start) || (prev !== undefined && "{};".includes(prev.ch))) ? "keyword" : "plain";
      case "constructor":
        return next === "(" ? "keyword" : "plain";
      case "import":
        return firstOnLine(start) && nextWord ? "keyword" : "plain";
      case "catch":
        return next === "(" ? "keyword" : "plain";
      case "finally":
        return next === "{" ? "keyword" : "plain";
      case "where":
        return WHERE_SHAPE.test(rest) ? "keyword" : "plain";
    }
    return "plain";
  };

  /** What follows a bare `private set`: the end of the line, or the end of a block or comment. */
  function endsStatement(next: string | undefined): boolean {
    return next === undefined || next === "\n" || next === "}" || next === ";" || next === "/";
  }

  const kindOfWord = (word: string, start: number, end: number): TokenKind => {
    if (HARD_KEYWORDS.has(word)) {
      return "keyword";
    }
    if (!afterMember(start)) {
      const soft = softKind(word, start, end);
      if (soft !== "plain") {
        return soft;
      }
    }
    return looksLikeType(word) ? "type" : "plain";
  };

  /** Colours the string whose first quote is at i: the text as string, the code inside ${...} as code. Returns where it ends. */
  const stringLiteral = (i: number, limit: number): number => {
    const { end, parts } = stringParts(source, i, limit);
    let textStart = i;
    for (const part of parts) {
      push("string", textStart, part.dollar);
      if (part.braces) {
        push("plain", part.dollar, part.open);
        scan(part.open, part.close);
        push("plain", part.close, part.close + 1);
        textStart = part.close + 1;
      } else {
        push("plain", part.dollar, part.close);
        textStart = part.close;
      }
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

      // A #! line at the very top of a .kts script.
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

      if (ch === "@") {
        const nameEnd = isIdentStart(source[i + 1]) ? identEnd(source, i + 1, limit) : i + 1;
        // Right after a name (return@forEach, this@Outer) or on its own, it is a label, left plain.
        if (nameEnd === i + 1 || isIdentPart(source[i - 1])) {
          push("plain", i, nameEnd);
          i = nameEnd;
          continue;
        }
        let end = nameEnd;
        // A use-site target like @file:JvmName or @get:Rule.
        if (source[end] === ":" && source[end + 1] !== ":" && isIdentStart(source[end + 1])) {
          end = identEnd(source, end + 1, limit);
        }
        // A qualified name like @kotlin.jvm.JvmStatic.
        while (source[end] === "." && isIdentStart(source[end + 1])) {
          end = identEnd(source, end + 1, limit);
        }
        push("preprocessor", i, end);
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
        const end = numberEnd(source, i, limit);
        push("number", i, end);
        i = end;
        continue;
      }

      if (ch === '"') {
        i = stringLiteral(i, limit);
        continue;
      }

      if (ch === "'") {
        const end = charEnd(source, i, limit);
        push("string", i, end);
        i = end;
        continue;
      }

      // Operators, punctuation and anything else: one character (or one surrogate pair).
      // That covers ?. ?: !! :: .. and ..< too, which stay plain.
      const codePoint = source.codePointAt(i) ?? 0;
      const length = codePoint > 0xffff ? 2 : 1;
      push("plain", i, i + length);
      i += length;
    }
  };

  scan(0, n);
  return builder.lines();
}
