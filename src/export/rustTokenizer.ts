// A small tokenizer for Rust syntax colouring. Like the others, it labels
// pieces of code without changing a single character, and it is
// pattern-based, not a full parser.
// The Rust-specific parts: a ' starts either a char ('a', '\n') or a
// lifetime ('a, 'static), raw strings (r"...", r#"..."#) have no escapes and
// end at a quote followed by the same number of #, block comments nest, and
// macros (println!) and attributes (#[derive(Debug)]) get their own colour.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

const KEYWORDS = new Set([
  "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum", "extern", "false",
  "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return",
  "self", "Self", "static", "struct", "super", "trait", "true", "type", "unsafe", "use", "where", "while",
  // Reserved for future use, so never a name.
  "abstract", "become", "box", "do", "final", "gen", "macro", "override", "priv", "try", "typeof", "unsized",
  "virtual", "yield",
]);

/** Built-in types and the standard library's most common types and variants, coloured as types. */
const TYPES = new Set([
  "i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize", "f32", "f64",
  "bool", "char", "str",
  "String", "Vec", "Option", "Result", "Box", "Rc", "Arc", "Cell", "RefCell", "Mutex", "HashMap", "HashSet",
  "BTreeMap", "BTreeSet", "VecDeque", "Some", "None", "Ok", "Err",
]);

/** Letters that can come right before a quote to make a byte string (b"), C string (c") or raw string (r", br", cr"). */
const STRING_PREFIXES = new Set(["b", "c"]);
const RAW_STRING_PREFIXES = new Set(["r", "br", "cr"]);

const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}_]/u;

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

/** End of a /* ... *\/ comment starting at i. Rust block comments nest, so each /* needs its own *\/. */
function blockCommentEnd(src: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    if (src[j] === "/" && src[j + 1] === "*") {
      depth++;
      j += 2;
    } else if (src[j] === "*" && src[j + 1] === "/") {
      depth--;
      j += 2;
      if (depth === 0) {
        return j;
      }
    } else {
      j++;
    }
  }
  return src.length;
}

/** End of a "..." string whose quote is at i. Rust strings may span lines; an unclosed one runs to the end. */
function stringEnd(src: string, i: number): number {
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

/** End of a raw string, given the index just after its prefix (r, br or cr), where zero or more # then " follow. */
function rawStringEnd(src: string, afterPrefix: number): number {
  let j = afterPrefix;
  while (src[j] === "#") {
    j++;
  }
  const closing = '"' + "#".repeat(j - afterPrefix);
  const close = src.indexOf(closing, j + 1);
  return close === -1 ? src.length : close + closing.length;
}

/** Number of # after i followed by a quote (a raw string), or -1 if it isn't one. */
function rawStringHashes(src: string, i: number): number {
  let j = i;
  while (src[j] === "#") {
    j++;
  }
  return src[j] === '"' ? j - i : -1;
}

/**
 * If a char literal ('a', '\n', '\u{1F600}', '中') starts at the quote at i,
 * its end; otherwise -1 (the quote starts a lifetime like 'a or 'static).
 */
function charEnd(src: string, i: number): number {
  const next = src[i + 1];
  if (next === undefined || next === "\n") {
    return -1;
  }
  if (next === "\\") {
    // An escape: the char ends at the next quote on this line ('\'' skips the escaped one).
    let j = i + 3;
    while (j < src.length && src[j] !== "\n") {
      if (src[j] === "'") {
        return j + 1;
      }
      j++;
    }
    return -1;
  }
  const codePoint = src.codePointAt(i + 1) ?? 0;
  const length = codePoint > 0xffff ? 2 : 1;
  return src[i + 1 + length] === "'" ? i + 2 + length : -1;
}

/** End of a number: 42, 1_000, 0xFF, 0b1010, 0o17, 3.14, 1e-9, 2.5f32, 10u8. Stops before .. and .method(). */
function numberEnd(src: string, i: number): number {
  const prefixed = src[i] === "0" && /[xob]/.test(src[i + 1] ?? "");
  let j = prefixed ? i + 2 : i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (isIdentPart(ch)) {
      j++;
    } else if (ch === "." && !prefixed && isDigit(src[j + 1])) {
      j++;
    } else if (ch === "." && !prefixed && src[j + 1] !== "." && !isIdentStart(src[j + 1]) && isDigit(src[j - 1])) {
      j++; // 1. is a float
    } else if ((ch === "+" || ch === "-") && !prefixed && /[eE]/.test(src[j - 1] ?? "") && isDigit(src[j + 1])) {
      j++;
    } else {
      break;
    }
  }
  return j;
}

/** End of an attribute #[...] or #![...] whose [ is at i, matching nested brackets and skipping strings. */
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
    } else if (ch === '"') {
      j = stringEnd(src, j);
      continue;
    }
    j++;
  }
  return src.length;
}

/**
 * Splits Rust source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizeRust(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;
  let i = 0;

  // A #! first line that isn't an attribute (#![...]) runs the file as a script.
  if (source.startsWith("#!") && !/^#!\s*\[/.test(source)) {
    const nl = source.indexOf("\n");
    i = nl === -1 ? n : nl;
    push("preprocessor", 0, i);
  }

  while (i < n) {
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

    if (ch === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      push("comment", i, end);
      i = end;
      continue;
    }

    if (ch === "/" && source[i + 1] === "*") {
      const end = blockCommentEnd(source, i);
      push("comment", i, end);
      i = end;
      continue;
    }

    if (ch === "#" && (source[i + 1] === "[" || (source[i + 1] === "!" && source[i + 2] === "["))) {
      const end = attributeEnd(source, source[i + 1] === "[" ? i + 1 : i + 2);
      push("preprocessor", i, end);
      i = end;
      continue;
    }

    if (isIdentStart(ch)) {
      const j = identEnd(source, i);
      const word = source.slice(i, j);
      const next = source[j];

      if (RAW_STRING_PREFIXES.has(word) && rawStringHashes(source, j) >= 0) {
        const end = rawStringEnd(source, j);
        push("string", i, end);
        i = end;
        continue;
      }
      if (word === "r" && next === "#" && isIdentStart(source[j + 1])) {
        // A raw identifier like r#match: a name, even though it's spelled like a keyword.
        const end = identEnd(source, j + 1);
        push("plain", i, end);
        i = end;
        continue;
      }
      if (STRING_PREFIXES.has(word) && next === '"') {
        const end = stringEnd(source, j);
        push("string", i, end);
        i = end;
        continue;
      }
      if (word === "b" && next === "'") {
        const end = charEnd(source, j);
        if (end !== -1) {
          push("string", i, end);
          i = end;
          continue;
        }
      }
      // A macro call (println!, vec!, macro_rules!), but not `x != y`.
      if (next === "!" && source[j + 1] !== "=" && !KEYWORDS.has(word)) {
        push("preprocessor", i, j + 1);
        i = j + 1;
        continue;
      }
      push(KEYWORDS.has(word) ? "keyword" : TYPES.has(word) ? "type" : "plain", i, j);
      i = j;
      continue;
    }

    if (isDigit(ch)) {
      const end = numberEnd(source, i);
      push("number", i, end);
      i = end;
      continue;
    }

    if (ch === '"') {
      const end = stringEnd(source, i);
      push("string", i, end);
      i = end;
      continue;
    }

    if (ch === "'") {
      const end = charEnd(source, i);
      if (end !== -1) {
        push("string", i, end);
        i = end;
        continue;
      }
      if (isIdentStart(source[i + 1])) {
        // A lifetime ('a, 'static, '_) or a loop label ('outer:), coloured like a keyword as in VS Code.
        const end = identEnd(source, i + 1);
        push("keyword", i, end);
        i = end;
        continue;
      }
    }

    // Operators, punctuation and anything else: one character (or one surrogate pair).
    const codePoint = source.codePointAt(i) ?? 0;
    const length = codePoint > 0xffff ? 2 : 1;
    push("plain", i, i + length);
    i += length;
  }

  return builder.lines();
}
