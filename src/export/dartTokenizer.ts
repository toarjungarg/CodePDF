// A small tokenizer for Dart syntax colouring. Like the others, it labels
// pieces of code without changing a single character, and it is
// pattern-based, not a full parser.
// The Dart-specific parts:
//   - Block comments nest (/* a /* b */ c */), and // and /// are line comments.
//   - Strings use ' or ", and ''' or """ for several lines. A string can't
//     span lines unless it is triple-quoted.
//   - Raw strings (r'...' and r"""...""") have no escapes and no interpolation.
//   - Interpolation: $name and ${code}. The text is a string, and the code
//     inside ${...} is coloured as code (it can hold its own strings and
//     braces), the same way the Kotlin tokenizer does it.
//   - Annotations (@override, @Deprecated('x')) get their own colour.
//   - A #symbol (#foo, #foo.bar, #+) gets the number colour, like symbols in Ruby.
//   - Reserved words are always keywords. Built-in and contextual words
//     (get, set, late, required, sealed, base, on, show, hide, async, await, ...)
//     are only keywords where they work as keywords, so a variable named
//     `get` or `base` stays plain.
//   - A name that starts with a capital letter (after any leading _) and has a
//     lowercase letter is coloured as a type (String, List, _Counter).

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** Reserved words: always keywords. */
const RESERVED = new Set([
  "assert", "break", "case", "catch", "class", "const", "continue", "default", "do", "else", "enum", "extends",
  "false", "final", "finally", "for", "if", "in", "is", "new", "null", "rethrow", "return", "super", "switch",
  "this", "throw", "true", "try", "var", "while", "with",
]);

/**
 * Built-in words that are practically always keywords (`static`, `factory`, `as`, ...).
 * They are only left plain after a dot (`x.static`) or as a named argument (`static: true`).
 */
const BUILT_IN = new Set([
  "abstract", "as", "covariant", "deferred", "external", "factory", "implements", "static",
]);

/** The built-in lowercase types, coloured like keywords (the same way the Java and C tokenizers colour int and void). */
const BUILT_IN_TYPES = new Set(["bool", "double", "dynamic", "int", "num", "void"]);

/** Words that may follow `sealed`, `base` or `interface`: the declaration, or another modifier. */
const CLASS_MODIFIER_NEXT = new Set(["abstract", "base", "class", "final", "interface", "mixin", "sealed"]);

/** After these, a word like `when` is a plain name (`return when(x)`), not a pattern guard. */
const NOT_BEFORE_GUARD = new Set(["await", "else", "in", "is", "return", "throw", "yield"]);

const IDENT_START = /[\p{L}_$]/u;
const IDENT_PART = /[\p{L}\p{N}\p{M}_$]/u;
/** Inside a string, `$name` can't contain a $. */
const NAME_START = /[\p{L}_]/u;
const NAME_PART = /[\p{L}\p{N}\p{M}_]/u;
const LOWERCASE = /\p{Ll}/u;
const UPPERCASE_START = /^\p{Lu}/u;

/** `get length => ...`, `get length {`, `get length;` right after the word get. */
const GETTER_SHAPE = /^[ \t]+[\p{L}_$][\p{L}\p{N}_$]*[ \t]*(?:=>|\{|;|async\b|sync\b)/u;
/** `set name(` right after the word set. */
const SETTER_SHAPE = /^[ \t]+[\p{L}_$][\p{L}\p{N}_$]*[ \t]*\(/u;
/** An operator name right after the word operator: `operator ==`, `operator []=`, `operator +`. */
const OPERATOR_SHAPE = /^[ \t]*(?:\[\]=?|==|<=|>=|<<|>>>?|~\/|[<>+\-*/%&|^~])/;
/** The operator symbols that can follow a # in a symbol literal like #+ or #[]=. */
const SYMBOL_OPERATOR = /^(?:\[\]=?|==|<=|>=|<<|>>>?|~\/|[<>+\-*/%&|^~])/;

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string | undefined): boolean {
  return ch !== undefined && IDENT_START.test(ch);
}

function isIdentPart(ch: string | undefined): boolean {
  return ch !== undefined && IDENT_PART.test(ch);
}

function isNameStart(ch: string | undefined): boolean {
  return ch !== undefined && NAME_START.test(ch);
}

function isInlineSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\f";
}

function isQuote(ch: string | undefined): boolean {
  return ch === "'" || ch === '"';
}

function identEnd(src: string, i: number, limit: number): number {
  let j = i;
  while (j < limit && isIdentPart(src[j])) {
    j++;
  }
  return j;
}

/** End of the `$name` in a string: letters, digits and _ only. */
function nameEnd(src: string, i: number, limit: number): number {
  let j = i;
  while (j < limit && NAME_PART.test(src[j]!)) {
    j++;
  }
  return j;
}

/** A type name by convention: starts with a capital (after any leading _) and has a lowercase letter, or is one letter (T). */
function looksLikeType(word: string): boolean {
  const bare = word.replace(/^_+/, "");
  return UPPERCASE_START.test(bare) && (bare.length === 1 || LOWERCASE.test(bare));
}

/** The index of the next newline at or after i, or `limit`. */
function lineEnd(src: string, i: number, limit: number): number {
  const nl = src.indexOf("\n", i);
  return nl === -1 || nl > limit ? limit : nl;
}

/**
 * End of a number: 42, 1_000, 0xFF, 3.14, 1.5e10, .5.
 * A "." only belongs to the number when a digit follows, so `1.abs()` stops at the dot.
 */
function numberEnd(src: string, i: number, limit: number): number {
  let j = i;
  const digits = (pattern: RegExp): void => {
    // An _ only counts when a digit follows it, so a name like 1_a is not swallowed.
    while (j < limit && (pattern.test(src[j]!) || (src[j] === "_" && pattern.test(src[j + 1] ?? "")))) {
      j++;
    }
  };
  if (src[i] === "0" && /[xX]/.test(src[i + 1] ?? "")) {
    j = i + 2;
    digits(/[0-9a-fA-F]/);
    return Math.min(j, limit);
  }
  digits(/[0-9]/);
  if (src[j] === "." && isDigit(src[j + 1])) {
    j++;
    digits(/[0-9]/);
  }
  if (/[eE]/.test(src[j] ?? "") && (isDigit(src[j + 1]) || (/[+-]/.test(src[j + 1] ?? "") && isDigit(src[j + 2])))) {
    j += 2;
    digits(/[0-9]/);
  }
  return Math.min(j, limit);
}

/** One interpolation inside a string: `$name` (the name is source[open..close)) or `${code}` (the code is source[open..close)). */
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
 * interpolation inside it. Both the colouring and the search for the end of a
 * `${...}` use this, so they always agree on where a string stops.
 * `raw` is true for r'...' strings: no escapes and no interpolation.
 */
function stringParts(src: string, i: number, limit: number, raw: boolean): { end: number; parts: TemplatePart[] } {
  const parts: TemplatePart[] = [];
  const quote = src[i]!;
  const triple = src[i + 1] === quote && src[i + 2] === quote;
  let j = triple ? i + 3 : i + 1;
  while (j < limit) {
    const ch = src[j]!;
    if (!raw && ch === "\\") {
      j += src[j + 1] === "\n" ? 1 : 2;
      continue;
    }
    if (!triple && ch === "\n") {
      return { end: j, parts }; // a one-line string can't span lines
    }
    if (ch === quote) {
      if (!triple) {
        return { end: j + 1, parts };
      }
      if (src[j + 1] === quote && src[j + 2] === quote) {
        return { end: j + 3, parts };
      }
      j++;
      continue;
    }
    if (!raw && ch === "$") {
      if (src[j + 1] === "{") {
        const close = holeClose(src, j + 2, triple ? limit : lineEnd(src, j, limit));
        if (close !== -1) {
          parts.push({ dollar: j, open: j + 2, close, braces: true });
          j = close + 1;
          continue;
        }
      } else if (j + 1 < limit && isNameStart(src[j + 1])) {
        const close = nameEnd(src, j + 1, limit);
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
 * never closes before `limit`. Strings inside are skipped, so a "}" in them
 * doesn't count.
 */
function holeClose(src: string, from: number, limit: number): number {
  let depth = 0;
  let j = from;
  while (j < limit) {
    const ch = src[j]!;
    if (isQuote(ch)) {
      j = stringParts(src, j, limit, false).end;
      continue;
    }
    // A raw string inside the hole, like r'}'.
    if (ch === "r" && isQuote(src[j + 1]) && !isIdentPart(src[j - 1])) {
      j = stringParts(src, j + 1, limit, true).end;
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
 * Splits Dart source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizeDart(source: string): TokenLine[] {
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

  /** The word that ends before i (skipping spaces on the same line), or "". */
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

  /** The text on the line before i. */
  const lineBefore = (i: number): string => source.slice(source.lastIndexOf("\n", i - 1) + 1, i);

  /** Whether only spaces come before i on its line. */
  const firstOnLine = (i: number): boolean => lineBefore(i).trim() === "";

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

  /** Whether the word at i comes after a "." (like `list.length` or `a?.length`), but not after a spread `...`. */
  const afterMember = (i: number): boolean => {
    const prev = prevSignificant(i);
    return prev !== undefined && prev.ch === "." && source.slice(prev.at - 2, prev.at + 1) !== "...";
  };

  /** The colour for a word that isn't reserved, using what is around it. */
  const softKind = (word: string, start: number, end: number): TokenKind => {
    const next = source[skipSpace(end)];
    const nextWord = wordAfter(end);
    const rest = source.slice(end, end + 200);
    const prev = prevSignificant(start);
    const before = lineBefore(start);

    switch (word) {
      case "get":
        return GETTER_SHAPE.test(rest) ? "keyword" : "plain";
      case "set":
        return SETTER_SHAPE.test(rest) ? "keyword" : "plain";
      case "operator":
        return OPERATOR_SHAPE.test(rest) ? "keyword" : "plain";
      case "late":
      case "required":
        // `late final int x`, `required this.name`: another word follows on the line.
        return nextWord && nextWord !== "in" && nextWord !== "is" && nextWord !== "as" ? "keyword" : "plain";
      case "sealed":
      case "base":
      case "interface":
        return CLASS_MODIFIER_NEXT.has(nextWord) ? "keyword" : "plain";
      case "mixin":
        return nextWord && nextWord !== "in" && nextWord !== "is" ? "keyword" : "plain";
      case "extension":
        return nextWord || next === "<" ? "keyword" : "plain";
      case "typedef":
        return nextWord ? "keyword" : "plain";
      case "type":
        // Only in `extension type Name(...)`.
        return prevWord(start) === "extension" && nextWord ? "keyword" : "plain";
      case "import":
      case "export":
        return firstOnLine(start) && isQuote(next) ? "keyword" : "plain";
      case "library":
        return firstOnLine(start) && (next === ";" || nextWord !== "") ? "keyword" : "plain";
      case "part":
        return firstOnLine(start) && (isQuote(next) || nextWord === "of") ? "keyword" : "plain";
      case "of":
        return prevWord(start) === "part" ? "keyword" : "plain";
      case "show":
      case "hide":
        // Only in an import or export line: `import 'a.dart' show A, B;`.
        return nextWord && (/^\s*(?:import|export)\b/.test(before) || (prev !== undefined && isQuote(prev.ch))) ? "keyword" : "plain";
      case "on":
        // `on FormatException catch (e)`, `mixin M on A`, `extension E on String`.
        return nextWord && (firstOnLine(start) || prev?.ch === "}" || /\b(?:extension|mixin|class|type)\b/.test(before)) ? "keyword" : "plain";
      case "await":
      case "yield":
        // An expression follows. `await = 1` or `await;` is just a name.
        return next !== undefined && !"=;.,)]}:?\n".includes(next) ? "keyword" : "plain";
      case "async":
      case "sync":
        // `) async {`, `) async =>`, `) async*`, `) sync*`.
        return prev?.ch === ")" && next !== undefined && "{=*".includes(next) ? "keyword" : "plain";
      case "when":
        // A guard comes after a pattern (`case int x when x > 1`). `when(x)` at the start of a statement is a call.
        return prev !== undefined && (isIdentPart(prev.ch) || ")]'\"".includes(prev.ch)) && !NOT_BEFORE_GUARD.has(prevWord(start)) && next !== undefined && !"=.,;".includes(next) ? "keyword" : "plain";
    }
    return "plain";
  };

  const kindOfWord = (word: string, start: number, end: number): TokenKind => {
    // After a dot every word is a member name, even `x.new` or `a.is`.
    if (afterMember(start)) {
      return looksLikeType(word) ? "type" : "plain";
    }
    if (RESERVED.has(word)) {
      return "keyword";
    }
    // A named argument like `required: true` or `static: false`.
    const prev = prevSignificant(start);
    const next = source[skipSpace(end)];
    const isLabel = next === ":" && source[skipSpace(end) + 1] !== ":" && prev !== undefined && "(,{".includes(prev.ch);
    if (isLabel) {
      return "plain";
    }
    if (BUILT_IN.has(word) || BUILT_IN_TYPES.has(word)) {
      return "keyword";
    }
    const soft = softKind(word, start, end);
    if (soft !== "plain") {
      return soft;
    }
    return looksLikeType(word) ? "type" : "plain";
  };

  /** Colours the string whose first quote is at i: the text as string, the code inside ${...} as code. Returns where it ends. */
  const stringLiteral = (i: number, limit: number, raw: boolean, from: number): number => {
    const { end, parts } = stringParts(source, i, limit, raw);
    let textStart = from;
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

      // An annotation: @override, @Deprecated('x'), @pragma('vm:prefer-inline'), @prefix.Name.
      if (ch === "@" && isIdentStart(source[i + 1])) {
        let end = identEnd(source, i + 1, limit);
        while (source[end] === "." && isIdentStart(source[end + 1])) {
          end = identEnd(source, end + 1, limit);
        }
        push("preprocessor", i, end);
        i = end;
        continue;
      }

      // A symbol literal: #foo, #foo.bar, #+, #[]=.
      if (ch === "#") {
        let end = i + 1;
        if (isIdentStart(source[end])) {
          end = identEnd(source, end, limit);
          while (source[end] === "." && isIdentStart(source[end + 1])) {
            end = identEnd(source, end + 1, limit);
          }
        } else {
          const op = SYMBOL_OPERATOR.exec(source.slice(end, end + 3));
          end += op ? op[0].length : 0;
        }
        push(end > i + 1 ? "number" : "plain", i, end);
        i = end;
        continue;
      }

      if (isIdentStart(ch)) {
        const end = identEnd(source, i, limit);
        // r'...' or r"""...""": a raw string. The r belongs to the string.
        if (ch === "r" && end === i + 1 && isQuote(source[end])) {
          i = stringLiteral(end, limit, true, i);
          continue;
        }
        push(kindOfWord(source.slice(i, end), i, end), i, end);
        i = end;
        continue;
      }

      // A number, or a leading-dot one like .5 (when nothing that could own the dot comes before it).
      if (isDigit(ch) || (ch === "." && isDigit(source[i + 1]) && !isIdentPart(source[i - 1]) && !")]}.".includes(source[i - 1] ?? " "))) {
        const end = ch === "." ? numberEnd(source, i + 1, limit) : numberEnd(source, i, limit);
        push("number", i, end);
        i = end;
        continue;
      }

      if (isQuote(ch)) {
        i = stringLiteral(i, limit, false, i);
        continue;
      }

      // Operators, punctuation and anything else: one character (or one surrogate pair).
      // That covers ?. ?? ??= .. ...? and => too, which stay plain.
      const codePoint = source.codePointAt(i) ?? 0;
      const length = codePoint > 0xffff ? 2 : 1;
      push("plain", i, i + length);
      i += length;
    }
  };

  scan(0, n);
  return builder.lines();
}
