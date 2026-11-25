// A small tokenizer for PHP syntax colouring. Like the others, it labels
// pieces of code without changing a single character, and it is
// pattern-based, not a full parser.
// The PHP-specific parts: a file is plain text (usually HTML) until a
// <?php or <?= tag, and code ends at ?> (even inside a // or # comment).
// Strings can span lines. Double-quoted strings and heredocs (<<<EOT) show
// their $variables and {$expressions} in the plain colour, so they stand out
// from the string text. Nowdocs (<<<'EOT') and single quotes have no
// interpolation. #[Attribute] is an attribute, not a # comment. Keywords
// ignore case (IF, Function, NULL), and class names are found by the words
// around them (new Foo, extends Foo, Foo::bar, Foo $x), since PHP has no
// naming rule to go by.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** Keywords and constants, in lower case because PHP ignores case for them. */
const KEYWORDS = new Set([
  "abstract", "and", "array", "as", "break", "callable", "case", "catch", "class", "clone", "const",
  "continue", "declare", "default", "die", "do", "echo", "else", "elseif", "empty", "enddeclare", "endfor",
  "endforeach", "endif", "endswitch", "endwhile", "eval", "exit", "extends", "final", "finally", "fn",
  "for", "foreach", "function", "global", "goto", "if", "implements", "include", "include_once",
  "instanceof", "insteadof", "interface", "isset", "list", "match", "namespace", "new", "or", "print",
  "private", "protected", "public", "readonly", "require", "require_once", "return", "static", "switch",
  "throw", "trait", "try", "unset", "use", "var", "while", "xor", "yield",
  "true", "false", "null", "self", "parent",
  "__class__", "__dir__", "__file__", "__function__", "__line__", "__method__", "__namespace__", "__trait__",
]);

/** Built-in types, coloured as types (lower case). */
const BUILT_IN_TYPES = new Set(["int", "float", "bool", "string", "object", "mixed", "void", "never", "iterable"]);

/** A name right after one of these words is a class name (lower case). */
const TYPE_AFTER = new Set(["new", "extends", "implements", "instanceof", "class", "interface", "trait", "enum", "use"]);

/** After these words a comma means another class name follows (implements A, B). */
const LIST_STARTERS = new Set(["extends", "implements", "use"]);

const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}\p{M}_]/u;
const HEREDOC_START = /<<<[ \t]*(?:"([\p{L}_][\p{L}\p{N}_]*)"|'([\p{L}_][\p{L}\p{N}_]*)'|([\p{L}_][\p{L}\p{N}_]*))[ \t]*(?=\r?\n)/uy;
const OPEN_TAG = /<\?(?:php(?=\s|$)|=)/iy;

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

/** End of a '...' string whose quote is at i. Only \' and \\ are escapes. It can span lines. */
function singleQuotedEnd(src: string, i: number): number {
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "\\" && (src[j + 1] === "'" || src[j + 1] === "\\")) {
      j += 2;
    } else if (ch === "'") {
      return j + 1;
    } else {
      j++;
    }
  }
  return src.length;
}

/** End of a "..." string whose quote is at i, with no interpolation. Used for quotes inside {$...} and attributes. */
function plainDoubleQuotedEnd(src: string, i: number): number {
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === "\\") {
      j += 2;
    } else if (src[j] === '"') {
      return j + 1;
    } else {
      j++;
    }
  }
  return src.length;
}

/**
 * End of the {$expr} or ${name} part of a string whose opening { is at i.
 * Matches nested braces and skips quotes. Returns -1 if it never closes before the limit,
 * so a stray "{$" in a string doesn't swallow the rest of the file.
 */
function holeEnd(src: string, i: number, limit: number): number {
  let depth = 0;
  let j = i;
  while (j < limit) {
    const ch = src[j];
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return j + 1;
      }
    } else if (ch === "'") {
      j = singleQuotedEnd(src, j);
      continue;
    } else if (ch === '"') {
      j = plainDoubleQuotedEnd(src, j);
      continue;
    }
    j++;
  }
  return -1;
}

/** End of an attribute #[...] whose [ is at i, matching nested brackets and skipping strings. */
function attributeEnd(src: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0) {
        return j + 1;
      }
    } else if (ch === "'") {
      j = singleQuotedEnd(src, j);
      continue;
    } else if (ch === '"') {
      j = plainDoubleQuotedEnd(src, j);
      continue;
    }
    j++;
  }
  return src.length;
}

/**
 * End of a number: 42, 1_000, 0xFF, 0b101, 0o17, 017, 3.14, .5, 1e10, 2.5E-3.
 * The exponent sign (+ or -) is part of the number only after e or E, and not in hex.
 */
function numberEnd(src: string, i: number): number {
  const prefixed = src[i] === "0" && /[xXbBoO]/.test(src[i + 1] ?? "");
  let j = src[i] === "." ? i + 2 : i + 1;
  let seenDot = src[i] === ".";
  while (j < src.length) {
    const ch = src[j]!;
    if (/[A-Za-z0-9_]/.test(ch)) {
      j++;
    } else if (ch === "." && !seenDot && !prefixed && isDigit(src[j + 1])) {
      seenDot = true;
      j++;
    } else if ((ch === "+" || ch === "-") && !prefixed && /[eE]/.test(src[j - 1] ?? "") && isDigit(src[j + 1])) {
      j++;
    } else {
      break;
    }
  }
  return j;
}

/** The end of a // or # comment: the end of the line, or the ?> that closes PHP, whichever comes first. */
function lineCommentEnd(src: string, i: number): number {
  const nl = src.indexOf("\n", i);
  const close = src.indexOf("?>", i);
  const lineEnd = nl === -1 ? src.length : nl;
  return close !== -1 && close < lineEnd ? close : lineEnd;
}

/**
 * Where a heredoc ends. `from` is the start of the first body line. The closing label can be
 * indented (PHP 7.3+) and may be followed by anything that isn't a name character.
 * Returns where the body stops (the start of the closing line) and where the label ends.
 * An unclosed heredoc runs to the end of the file.
 */
function heredocEnd(src: string, from: number, label: string): { bodyEnd: number; end: number } {
  let lineStart = from;
  while (lineStart <= src.length) {
    const q = skipInlineSpace(src, lineStart);
    if (src.startsWith(label, q) && !isIdentPart(src[q + label.length])) {
      return { bodyEnd: lineStart, end: q + label.length };
    }
    const nl = src.indexOf("\n", lineStart);
    if (nl === -1) {
      break;
    }
    lineStart = nl + 1;
  }
  return { bodyEnd: src.length, end: src.length };
}

/** The names this file declares with class, interface, trait or enum (lower case). They're coloured as types wherever they're used. */
function declaredTypes(source: string): Set<string> {
  const names = new Set<string>();
  const declaration = /^[ \t]*(?:(?:abstract|final|readonly)[ \t]+)*(?:class|interface|trait|enum)[ \t]+([\p{L}_][\p{L}\p{N}_]*)/gimu;
  for (const match of source.matchAll(declaration)) {
    names.add(match[1]!.toLowerCase());
  }
  return names;
}

/**
 * Splits PHP source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizePhp(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;
  const ownTypes = declaredTypes(source);
  let i = 0;
  let inPhp = false;
  // The last two characters and the last word of real code (spaces and comments don't count).
  // They tell us things like "this name comes right after ->" or "right after new".
  let recent = "";
  let lastWord = "";
  // True after extends, implements or use, until a ; { ( or ), so "implements A, B" colours B too.
  let listMode = false;

  const code = (kind: TokenKind, start: number, end: number): void => {
    push(kind, start, end);
    recent = (recent + source.slice(start, end)).slice(-2);
    lastWord = "";
  };

  /**
   * Colours a string that has $variables or {$expressions} in it, starting at its first character (i).
   * The string ends at `quote` (or at `limit` when quote is empty, for heredocs).
   * The interpolated parts are pushed as plain, the rest as string. Returns where it ends.
   */
  const interpolated = (start: number, quote: string, limit: number): number => {
    let segStart = start;
    let j = quote ? start + 1 : start;
    const flush = (to: number): void => push("string", segStart, to);
    while (j < limit) {
      const ch = source[j];
      if (ch === "\\") {
        j += 2;
        continue;
      }
      if (quote && ch === quote) {
        flush(j + 1);
        return j + 1;
      }
      if (ch === "$" && isIdentStart(source[j + 1])) {
        flush(j);
        let k = identEnd(source, j + 1);
        // "$obj->name" interpolates the property too.
        if (source[k] === "-" && source[k + 1] === ">" && isIdentStart(source[k + 2])) {
          k = identEnd(source, k + 2);
        }
        push("plain", j, k);
        segStart = k;
        j = k;
        continue;
      }
      if ((ch === "{" && source[j + 1] === "$") || (ch === "$" && source[j + 1] === "{")) {
        const end = holeEnd(source, ch === "{" ? j : j + 1, limit);
        if (end !== -1) {
          flush(j);
          push("plain", j, end);
          segStart = end;
          j = end;
          continue;
        }
      }
      j++;
    }
    flush(Math.min(j, limit));
    return limit;
  };

  while (i < n) {
    // Outside <?php ... ?> everything is plain text (usually HTML), up to the next opening tag.
    if (!inPhp) {
      let j = i;
      let found = false;
      while (j < n) {
        j = source.indexOf("<?", j);
        if (j === -1) {
          j = n;
          break;
        }
        OPEN_TAG.lastIndex = j;
        if (OPEN_TAG.test(source)) {
          found = true;
          break;
        }
        j += 2;
      }
      push("plain", i, j);
      if (found) {
        OPEN_TAG.lastIndex = j;
        OPEN_TAG.test(source);
        push("preprocessor", j, OPEN_TAG.lastIndex);
        i = OPEN_TAG.lastIndex;
        inPhp = true;
        recent = "";
        lastWord = "";
        listMode = false;
      } else {
        i = n;
      }
      continue;
    }

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

    // ?> goes back to plain text. This check comes before ?-> and ??.
    if (ch === "?" && source[i + 1] === ">") {
      push("preprocessor", i, i + 2);
      i += 2;
      inPhp = false;
      continue;
    }

    // #[ starts an attribute, so it has to be checked before the # comment.
    if (ch === "#" && source[i + 1] === "[") {
      const end = attributeEnd(source, i + 1);
      push("preprocessor", i, end);
      i = end;
      continue;
    }

    if (ch === "#" || (ch === "/" && source[i + 1] === "/")) {
      const end = lineCommentEnd(source, i);
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

    // Variables: $name and $$name. $this gets the keyword colour.
    if (ch === "$") {
      let j = i;
      while (source[j] === "$") {
        j++;
      }
      if (isIdentStart(source[j])) {
        const end = identEnd(source, j);
        const isThis = j === i + 1 && source.slice(j, end) === "this";
        code(isThis ? "keyword" : "plain", i, end);
        i = end;
        continue;
      }
    }

    // A name, possibly with namespace parts: Foo, \Foo, App\Models\Dish.
    if (isIdentStart(ch) || (ch === "\\" && isIdentStart(source[i + 1]))) {
      let j = ch === "\\" ? i + 1 : i;
      j = identEnd(source, j);
      while (source[j] === "\\" && isIdentStart(source[j + 1])) {
        j = identEnd(source, j + 1);
      }
      const word = source.slice(i, j);
      const qualified = word.includes("\\");
      const lower = word.toLowerCase();
      const lastSegment = lower.slice(lower.lastIndexOf("\\") + 1);
      const afterMember = recent === "->" || recent === "::";
      const after = source.slice(skipInlineSpace(source, j), skipInlineSpace(source, j) + 4);
      let kind: TokenKind = "plain";
      if (afterMember) {
        // $a->list is a property and Foo::bar a constant, but Foo::class is the keyword.
        kind = recent === "::" && lower === "class" ? "keyword" : "plain";
      } else if (lastWord === "function" || lastWord === "const") {
        // The name of a function or constant can look like a keyword.
        kind = "plain";
      } else if (!qualified && lower === "enum") {
        kind = isIdentStart(source[skipInlineSpace(source, j)]) ? "keyword" : "plain";
      } else if (!qualified && lower === "from") {
        // Only a keyword in "yield from".
        kind = lastWord === "yield" ? "keyword" : "plain";
      } else if (!qualified && KEYWORDS.has(lower)) {
        kind = "keyword";
      } else if (
        TYPE_AFTER.has(lastWord) ||
        (listMode && recent.endsWith(",") && lastWord === "") ||
        after.startsWith("::") ||
        // A type hint: Dish $d, ?Dish &$d, Dish ...$ds.
        /^(?:&\s*)?(?:\.\.\.\s*)?\$/.test(after) ||
        // A return type: function f(): Dish
        recent === "):" ||
        ownTypes.has(lastSegment) ||
        (!qualified && BUILT_IN_TYPES.has(lower))
      ) {
        kind = "type";
      }
      if (!qualified && LIST_STARTERS.has(lower) && kind === "keyword") {
        listMode = true;
      }
      push(kind, i, j);
      recent = (recent + word).slice(-2);
      lastWord = qualified ? "" : lower;
      i = j;
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(source[i + 1]) && source[i - 1] !== ".")) {
      const end = numberEnd(source, i);
      code("number", i, end);
      i = end;
      continue;
    }

    if (ch === "'") {
      const end = singleQuotedEnd(source, i);
      code("string", i, end);
      i = end;
      continue;
    }

    // "..." strings and `shell command` strings have interpolation.
    if (ch === '"' || ch === "`") {
      const end = interpolated(i, ch, n);
      recent = (recent + source[end - 1]).slice(-2);
      lastWord = "";
      i = end;
      continue;
    }

    // Heredoc <<<EOT or <<<"EOT", and nowdoc <<<'EOT'. Only a marker followed by a line end counts.
    if (ch === "<" && source.startsWith("<<<", i)) {
      HEREDOC_START.lastIndex = i;
      const match = HEREDOC_START.exec(source);
      if (match) {
        const label = (match[1] ?? match[2] ?? match[3])!;
        const nowdoc = match[2] !== undefined;
        const bodyStart = source.indexOf("\n", HEREDOC_START.lastIndex) + 1;
        const { bodyEnd, end } = heredocEnd(source, bodyStart, label);
        if (nowdoc) {
          push("string", i, end);
        } else {
          push("string", i, bodyStart);
          interpolated(bodyStart, "", bodyEnd);
          push("string", bodyEnd, end);
        }
        recent = (recent + label).slice(-2);
        lastWord = "";
        i = end;
        continue;
      }
    }

    // Operators and punctuation (::, ->, ?->, =>, ...), one character at a time.
    // They are all plain, so they merge into one token. Takes a surrogate pair as one character.
    if (ch === ";" || ch === "{" || ch === "(" || ch === ")") {
      listMode = false;
    }
    const codePoint = source.codePointAt(i) ?? 0;
    const length = codePoint > 0xffff ? 2 : 1;
    code("plain", i, i + length);
    i += length;
  }

  return builder.lines();
}
