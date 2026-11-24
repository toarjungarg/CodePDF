// A small tokenizer for C# syntax colouring. Like the others, it labels
// pieces of code without changing a single character, and it is
// pattern-based, not a full parser.
// The C#-specific parts: verbatim strings (@"..."), interpolated strings
// ($"...{code}...") whose code is coloured as code, raw strings ("""..."""),
// attributes ([Obsolete]) and #region lines, and words like var, get and
// where that are only keywords where they're used as keywords.
// Types can't follow a capital-letter rule like Java's, since C# method names
// are capitalized too (Console.WriteLine). So a word is a type if it's a common
// .NET type, a type declared in the same file, the name after `new`, or a
// type parameter or interface by C#'s naming habits (T, TValue, IDish).

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

const KEYWORDS = new Set([
  "abstract", "as", "base", "break", "case", "catch", "checked", "class", "const", "continue", "default",
  "delegate", "do", "else", "enum", "event", "explicit", "extern", "finally", "fixed", "for", "foreach",
  "goto", "if", "implicit", "in", "interface", "internal", "is", "lock", "namespace", "new", "operator",
  "out", "override", "params", "private", "protected", "public", "readonly", "ref", "return", "sealed",
  "sizeof", "stackalloc", "static", "struct", "switch", "this", "throw", "try", "typeof", "unchecked",
  "unsafe", "using", "virtual", "volatile", "while", "true", "false", "null",
  // Built-in types are coloured like keywords, as in VS Code's default theme.
  "bool", "byte", "char", "decimal", "double", "float", "int", "long", "object", "sbyte", "short",
  "string", "uint", "ulong", "ushort", "void",
]);

/**
 * Words that are keywords only when a name follows on the same line
 * (`partial class`, `from item in pantry`, `where T : IDish`) and ordinary
 * names everywhere else (`var from = 1;`).
 */
const KEYWORDS_BEFORE_NAME = new Set([
  "partial", "record", "required", "scoped", "file",
  // LINQ query words.
  "from", "where", "select", "orderby", "group", "by", "into", "join", "on", "equals", "let",
]);

/** Property and event accessors: keywords inside `{ get; set; }` and similar. */
const ACCESSORS = new Set(["get", "set", "init", "add", "remove"]);
const ACCESS_MODIFIERS = new Set(["public", "private", "protected", "internal", "readonly"]);

/** Common .NET types. Coloured as types unless they follow a dot (`order.Type` is a property). */
const COMMON_TYPES = new Set([
  "Object", "String", "Boolean", "Char", "Byte", "Int16", "Int32", "Int64", "UInt32", "UInt64", "Single",
  "Double", "Decimal", "Console", "Math", "Convert", "Environment", "DateTime", "DateOnly", "TimeOnly",
  "TimeSpan", "Guid", "Random", "Array", "List", "Dictionary", "HashSet", "Queue", "Stack", "LinkedList",
  "SortedDictionary", "SortedSet", "KeyValuePair", "Tuple", "ValueTuple", "Nullable", "Span", "ReadOnlySpan",
  "Memory", "Enumerable", "Func", "Action", "Predicate", "Task", "ValueTask", "Thread", "CancellationToken",
  "Lazy", "StringBuilder", "Encoding", "Regex", "Uri", "File", "Directory", "Path", "Stream", "Type",
  "Attribute", "Exception", "ArgumentException", "ArgumentNullException", "ArgumentOutOfRangeException",
  "InvalidOperationException", "NotImplementedException", "NotSupportedException", "FormatException",
  "IndexOutOfRangeException", "NullReferenceException",
]);

const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}\p{M}_]/u;
/** Type parameters (TValue) and interfaces (IDish) by C#'s naming habits: T or I, a capital, and a lowercase letter somewhere. */
const NAMING_HABIT_TYPE = /^[TI]\p{Lu}[\p{L}\p{N}_]*\p{Ll}/u;
/** `class Kitchen`, `record struct Point`, ...: the names this file declares. */
const DECLARATION = /\b(?:class|struct|interface|enum|record)[ \t]+(?:(?:class|struct)[ \t]+)?([\p{Lu}_][\p{L}\p{N}_]*)/gu;

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

function identEnd(src: string, i: number): number {
  let j = i;
  while (j < src.length && isIdentPart(src[j])) {
    j++;
  }
  return j;
}

/** How many times `ch` repeats starting at i (never past `limit`). */
function runLength(src: string, i: number, ch: string, limit: number): number {
  let j = i;
  while (j < limit && src[j] === ch) {
    j++;
  }
  return j - i;
}

/** The first index at or after i that isn't a space or tab, on the same line. */
function skipInlineSpace(src: string, i: number): number {
  let j = i;
  while (j < src.length && isInlineSpace(src[j])) {
    j++;
  }
  return j;
}

/** End of a "..." or '...' literal whose quote is at i. Stops at a newline. */
function quotedEnd(src: string, i: number, limit: number): number {
  const quote = src[i];
  let j = i + 1;
  while (j < limit) {
    const ch = src[j];
    if (ch === "\\" && src[j + 1] !== "\n") {
      j += 2;
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
  return limit;
}

/** End of a number: 42, 1_000, 0xFF, 0b1010, 3.14, .5, 1e-9, 2.5f, 9.99m, 10UL. Stops before `..` (a range) and `.Method()`. */
function numberEnd(src: string, i: number): number {
  const hex = src[i] === "0" && /[xX]/.test(src[i + 1] ?? "");
  let j = src[i] === "." ? i + 2 : i + 1;
  while (j < src.length) {
    const ch = src[j]!;
    if (/[A-Za-z0-9_]/.test(ch)) {
      j++;
    } else if (ch === "." && src[j + 1] !== "." && !isIdentStart(src[j + 1])) {
      j++;
    } else if (!hex && (ch === "+" || ch === "-") && /[eE]/.test(src[j - 1] ?? "") && isDigit(src[j + 1])) {
      j++;
    } else {
      break;
    }
  }
  return j;
}

/**
 * Finds the end of an interpolation hole ({name} or {cups:F1}) whose code
 * starts at `from`. Returns where the code ends (at a ":" format, or the
 * closing brace), where the closing brace is, and where the closing braces
 * end, or undefined if the hole never closes.
 */
function holeEnd(
  src: string,
  from: number,
  closeBraces: number,
  singleLine: boolean,
  limit: number,
): { codeEnd: number; close: number; closeEnd: number } | undefined {
  let depth = 0;
  let codeEnd = -1;
  let j = from;
  while (j < limit) {
    const ch = src[j]!;
    if (ch === "\n" && singleLine) {
      return undefined;
    }
    if (codeEnd === -1 && (ch === '"' || ch === "'")) {
      j = quotedEnd(src, j, limit);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]") {
      depth = Math.max(0, depth - 1);
    } else if (ch === "}") {
      if (depth === 0) {
        const closeEnd = j + Math.min(runLength(src, j, "}", limit), closeBraces);
        return { codeEnd: codeEnd === -1 ? j : codeEnd, close: j, closeEnd };
      }
      depth--;
    } else if (codeEnd === -1 && depth === 0 && ch === ":" && src[j + 1] !== ":" && src[j - 1] !== ":") {
      codeEnd = j; // the rest, up to the closing brace, is the format (like F1)
    }
    j++;
  }
  return undefined;
}

/**
 * Whether the `[` at i starts an attribute like [Obsolete("old")], and isn't
 * an index like [key] = 1 in a dictionary initializer.
 */
function attributeAhead(src: string, i: number): boolean {
  if (!isIdentStart(src[skipInlineSpace(src, i + 1)])) {
    return false;
  }
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const ch = src[j]!;
    if (ch === '"' || ch === "'") {
      j = quotedEnd(src, j, src.length);
      continue;
    }
    if (ch === ";" || ch === "{" || ch === "}") {
      return false;
    }
    if (ch === "[") {
      depth++;
    } else if (ch === "]" && --depth === 0) {
      break;
    }
    j++;
  }
  let k = j + 1;
  while (k < src.length && (src[k] === "\n" || isInlineSpace(src[k]))) {
    k++;
  }
  return k >= src.length || !"=.;),?".includes(src[k]!);
}

/**
 * Splits C# source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizeCSharp(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;
  const declaredTypes = new Set([...source.matchAll(DECLARATION)].map((match) => match[1]!));

  // The last piece of code seen (comments and # lines don't count), used to
  // tell keywords from names: `private set;` versus `x = set;`.
  let lastChar = ";";
  let lastWord = "";
  // Inside an attribute's [...]: how many brackets are open, and whether the next name is an attribute name.
  let attribute: { depth: number; expectName: boolean } | undefined;
  let attributeJustClosed = false;

  const wordAt = (i: number): string => source.slice(i, identEnd(source, i));

  const isContextualKeyword = (word: string, end: number): boolean => {
    if (lastChar === ".") {
      return false;
    }
    const k = skipInlineSpace(source, end);
    const next = source[k];
    const nextWord = isIdentStart(next) ? wordAt(k) : "";
    // `foreach (var file in files)`: a name followed by `in` is a variable.
    const nameNext = isIdentStart(next) && !["in", "is", "as", "switch", "and", "or"].includes(nextWord);
    switch (word) {
      case "var":
      case "async":
      case "await":
        return nameNext || next === "(";
      case "when":
        return nameNext || next === "(" || next === "!" || isDigit(next);
      case "yield":
        return nextWord === "return" || nextWord === "break";
      case "nameof":
        return next === "(";
      case "with":
        return next === "{";
      case "global":
        return source.startsWith("::", k) || nextWord === "using";
      case "dynamic":
      case "nint":
      case "nuint":
        return nameNext || (next !== undefined && "?[>,)".includes(next));
      case "and":
      case "or":
      case "not":
        // Pattern words, as in `is not null` or `is > 0 and < 10`.
        return (
          (isIdentPart(lastChar) || ")]\"'".includes(lastChar)) &&
          (isIdentStart(next) || isDigit(next) || (next !== undefined && "\"'(<>[{-!".includes(next)))
        );
    }
    if (ACCESSORS.has(word)) {
      return (
        (next === ";" || next === "{" || source.startsWith("=>", k)) &&
        ("{;}]".includes(lastChar) || ACCESS_MODIFIERS.has(lastWord))
      );
    }
    return KEYWORDS_BEFORE_NAME.has(word) && nameNext;
  };

  const kindOfWord = (word: string, end: number): TokenKind => {
    if (KEYWORDS.has(word) || isContextualKeyword(word, end)) {
      return "keyword";
    }
    if (
      lastWord === "new" ||
      declaredTypes.has(word) ||
      NAMING_HABIT_TYPE.test(word) ||
      word === "T" ||
      (COMMON_TYPES.has(word) && lastChar !== ".")
    ) {
      return "type";
    }
    return "plain";
  };

  /**
   * Colours a string literal that starts at `start` (its $ and @ prefix) with
   * its opening quote at `quoteAt`. The text is a string; the code inside each
   * {...} of an interpolated string is coloured as code. Returns where it ends.
   */
  const stringLiteral = (start: number, quoteAt: number, verbatim: boolean, dollars: number, limit: number): number => {
    const run = runLength(source, quoteAt, '"', limit);
    const quotes = !verbatim && run >= 3 ? run : 1;
    const raw = quotes >= 3;
    const singleLine = !verbatim && !raw;
    let textStart = start;
    let j = quoteAt + quotes;
    let closed = false;
    while (j < limit) {
      const ch = source[j]!;
      if (ch === "\n" && singleLine) {
        break;
      }
      if (ch === "\\" && singleLine) {
        j += source[j + 1] === "\n" ? 1 : 2;
        continue;
      }
      if (ch === '"') {
        if (raw) {
          const closing = runLength(source, j, '"', limit);
          j += closing;
          if (closing >= quotes) {
            closed = true;
            break;
          }
          continue;
        }
        if (verbatim && source[j + 1] === '"') {
          j += 2; // "" is a quote inside a verbatim string
          continue;
        }
        j++;
        closed = true;
        break;
      }
      if (dollars > 0 && (ch === "{" || ch === "}")) {
        const braces = runLength(source, j, ch, limit);
        // In $"..." a doubled brace ({{) is a plain brace. In $$"""...""" it
        // takes as many braces as there are $ signs to open a hole.
        const opensHole = ch === "{" && (raw ? braces >= dollars : braces % 2 === 1);
        if (!opensHole) {
          j += braces;
          continue;
        }
        const openLength = raw ? dollars : 1;
        const open = j + braces - openLength;
        const hole = holeEnd(source, open + openLength, openLength, singleLine, limit);
        if (!hole) {
          j += braces;
          continue;
        }
        push("string", textStart, open);
        push("plain", open, open + openLength);
        scan(open + openLength, hole.codeEnd, false);
        push("string", hole.codeEnd, hole.close);
        push("plain", hole.close, hole.closeEnd);
        j = hole.closeEnd;
        textStart = j;
        continue;
      }
      j++;
    }
    let end = Math.min(j, limit);
    // "flour"u8 is a UTF-8 string.
    if (closed && dollars === 0 && /[uU]/.test(source[end] ?? "") && source[end + 1] === "8" && end + 2 <= limit && !isIdentPart(source[end + 2])) {
      end += 2;
    }
    push("string", textStart, end);
    return end;
  };

  /** Colours source[start..end). `topLevel` is false for the code inside an interpolation hole. */
  const scan = (start: number, end: number, topLevel: boolean): void => {
    let i = start;
    let lineStart = topLevel; // true while only spaces have been seen on the current line

    const code = (kind: TokenKind, from: number, to: number, last: string, word = ""): void => {
      push(kind, from, to);
      lastChar = last;
      lastWord = word;
      lineStart = false;
      attributeJustClosed = false;
    };

    while (i < end) {
      const ch = source[i]!;

      if (ch === "\n" || isInlineSpace(ch)) {
        let j = i + 1;
        while (j < end && (source[j] === "\n" || isInlineSpace(source[j]))) {
          j++;
        }
        if (topLevel && source.slice(i, j).includes("\n")) {
          lineStart = true;
        }
        push("plain", i, j);
        i = j;
        continue;
      }

      if (ch === "/" && (source[i + 1] === "/" || source[i + 1] === "*")) {
        const close = source[i + 1] === "/" ? source.indexOf("\n", i) : source.indexOf("*/", i + 2);
        const stop = close === -1 ? end : Math.min(source[i + 1] === "/" ? close : close + 2, end);
        push("comment", i, stop);
        lineStart = false;
        i = stop;
        continue;
      }

      // #region, #if DEBUG, #nullable enable: the whole line, up to a // comment.
      if (ch === "#" && lineStart) {
        let j = i + 1;
        while (j < end && source[j] !== "\n" && !source.startsWith("//", j)) {
          j++;
        }
        push("preprocessor", i, j);
        lineStart = false;
        i = j;
        continue;
      }

      if (isIdentStart(ch)) {
        let j = identEnd(source, i);
        const word = source.slice(i, j);
        if (attribute && attribute.depth === 1 && attribute.expectName) {
          const after = skipInlineSpace(source, j);
          if (source[after] === ":" && source[after + 1] !== ":") {
            // A target, as in [assembly: ...] or [return: ...].
            code("keyword", i, j, word[word.length - 1]!, word);
          } else {
            // The attribute name, including a qualified one like System.Obsolete.
            while (source[j] === "." && isIdentStart(source[j + 1])) {
              j = identEnd(source, j + 1);
            }
            attribute.expectName = false;
            code("preprocessor", i, j, source[j - 1]!);
          }
          i = j;
          continue;
        }
        code(kindOfWord(word, j), i, j, word[word.length - 1]!, word);
        i = j;
        continue;
      }

      if (isDigit(ch) || (ch === "." && isDigit(source[i + 1]) && source[i - 1] !== ".")) {
        const stop = Math.min(numberEnd(source, i), end);
        code("number", i, stop, "0");
        i = stop;
        continue;
      }

      if (ch === '"') {
        const stop = stringLiteral(i, i, false, 0, end);
        code("string", i, i, '"');
        i = stop;
        continue;
      }

      if (ch === "'") {
        const stop = quotedEnd(source, i, end);
        code("string", i, stop, "'");
        i = stop;
        continue;
      }

      if (ch === "$" || ch === "@") {
        let j = i;
        let dollars = 0;
        let verbatim = false;
        while (source[j] === "$" || (source[j] === "@" && !verbatim)) {
          if (source[j] === "$") {
            dollars++;
          } else {
            verbatim = true;
          }
          j++;
        }
        if (source[j] === '"' && j < end) {
          const stop = stringLiteral(i, j, verbatim, dollars, end);
          code("string", i, i, '"');
          i = stop;
          continue;
        }
        if (ch === "@" && isIdentStart(source[i + 1])) {
          // @class: a keyword used as a name.
          const stop = identEnd(source, i + 1);
          code("plain", i, stop, "a");
          i = stop;
          continue;
        }
      }

      // Operators, punctuation and anything else: one character (or one surrogate pair).
      const codePoint = source.codePointAt(i) ?? 0;
      const length = codePoint > 0xffff ? 2 : 1;
      const closesAttribute = attribute !== undefined && ch === "]" && attribute.depth === 1;
      if (ch === "[" && topLevel && !attribute && ("{;}".includes(lastChar) || attributeJustClosed) && attributeAhead(source, i)) {
        attribute = { depth: 1, expectName: true };
      } else if (attribute) {
        if (ch === "[" || ch === "(") {
          attribute.depth++;
        } else if (ch === "]" || ch === ")") {
          attribute.depth--;
          if (closesAttribute) {
            attribute = undefined;
          }
        } else if (ch === "," && attribute.depth === 1) {
          attribute.expectName = true;
        }
      }
      code("plain", i, i + length, ch);
      attributeJustClosed = closesAttribute;
      i += length;
    }
  };

  scan(0, n, true);
  return builder.lines();
}
