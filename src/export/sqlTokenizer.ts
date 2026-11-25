// A small tokenizer for SQL syntax colouring. Like the others, it labels
// pieces of code without changing a single character, and it is
// pattern-based, not a full parser.
// It is not tied to one database. It knows the common words from standard
// SQL, PostgreSQL, MySQL, SQLite and T-SQL (SQL Server).
// The SQL-specific parts: keywords and types ignore upper or lower case,
// comments are `-- ...`, `/* ... */` and MySQL's `# ...`, strings use '...'
// with '' for a quote inside, PostgreSQL has dollar-quoted strings
// ($$...$$ and $tag$...$tag$) that can span lines, and names in "double
// quotes", `backticks` or [brackets] are identifiers, so they stay plain.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** Words that are always coloured as keywords. Compared in lower case. */
const KEYWORDS = new Set([
  "add", "after", "all", "alter", "always", "analyze", "and", "any", "as", "asc", "autoincrement",
  "auto_increment", "before", "begin", "between", "by", "cascade", "case", "cast", "check", "collate",
  "column", "commit", "conflict", "constraint", "create", "cross", "current_date", "current_time",
  "current_timestamp", "current_user", "database", "declare", "default", "deferrable", "deferred", "delete",
  "desc", "describe", "distinct", "do", "drop", "each", "else", "elseif", "end", "engine", "escape",
  "except", "exec", "execute", "exists", "explain", "false", "fetch", "first", "for", "foreign", "from",
  "full", "function", "generated", "grant", "group", "having", "identity", "if", "ignore", "ilike",
  "immediate", "in", "index", "initially", "inner", "insert", "instead", "intersect", "into", "is",
  "join", "key", "language", "last", "lateral", "left", "like", "limit", "loop", "materialized",
  "minus", "natural", "next", "not", "nothing", "null", "nulls", "of", "offset", "on", "only", "or",
  "order", "outer", "over", "partition", "percent", "pragma", "primary", "procedure", "recursive",
  "references", "rename", "replace", "restrict", "return", "returning", "returns", "revoke", "right",
  "rollback", "row", "rows", "savepoint", "schema", "select", "sequence", "set", "show", "some",
  "start", "stored", "table", "temp", "temporary", "then", "to", "top", "transaction", "trigger",
  "true", "truncate", "union", "unique", "unknown", "unsigned", "update", "use", "using", "vacuum",
  "values", "view", "virtual", "when", "where", "while", "window", "with", "zerofill",
]);

/** Data type names, coloured as types. Compared in lower case. */
const TYPES = new Set([
  "array", "bigint", "bigserial", "binary", "bit", "blob", "bool", "boolean", "bytea", "char",
  "character", "clob", "date", "datetime", "datetime2", "decimal", "double", "enum", "float",
  "geometry", "int", "int2", "int4", "int8", "integer", "interval", "json", "jsonb", "longtext",
  "mediumint", "mediumtext", "money", "nchar", "numeric", "nvarchar", "precision", "real", "serial",
  "smallint", "smallserial", "text", "time", "timestamp", "timestamptz", "tinyint", "tinytext",
  "uniqueidentifier", "uuid", "varbinary", "varchar", "varying", "xml", "zone",
]);

/**
 * Built-in functions. They are only coloured when a ( follows, so a column
 * that happens to be called `count` or `max` stays plain. Compared in lower case.
 */
const FUNCTIONS = new Set([
  "abs", "array_agg", "avg", "ceil", "ceiling", "coalesce", "concat", "convert", "count", "dateadd",
  "datediff", "dense_rank", "extract", "floor", "generate_series", "getdate", "group_concat", "ifnull",
  "isnull", "lag", "lead", "len", "length", "lower", "ltrim", "max", "min", "now", "nullif", "nvl",
  "position", "rand", "random", "rank", "round", "row_number", "rtrim", "string_agg", "strftime",
  "substr", "substring", "sum", "to_char", "to_date", "trim", "upper",
]);

/** Letters that can sit right in front of a quote as a prefix: E'..' (escapes), N'..' (unicode), X'..' (hex), B'..' (bits). */
const STRING_PREFIXES = new Set(["e", "n", "x", "b"]);

const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}\p{M}_]/u;

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

/** End of a word. A $ is allowed inside a name (PostgreSQL, MySQL) as long as a name character follows it. */
function identEnd(src: string, i: number): number {
  let j = i;
  while (j < src.length) {
    if (isIdentPart(src[j]) || (src[j] === "$" && isIdentPart(src[j + 1]) && j > i)) {
      j++;
    } else {
      break;
    }
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

/**
 * End of a '...' string whose quote is at i. A doubled '' is a quote inside the
 * string. A backslash is a normal character (standard SQL), so 'C:\temp\' ends at
 * its last quote. Only an E'..' string (backslashEscapes) lets a backslash skip the
 * next character. Strings can span lines, and an unclosed one runs to the end of the file.
 */
function stringEnd(src: string, i: number, backslashEscapes = false): number {
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (backslashEscapes && ch === "\\" && j + 1 < src.length) {
      j += 2;
    } else if (ch === "'") {
      if (src[j + 1] === "'") {
        j += 2;
      } else {
        return j + 1;
      }
    } else {
      j++;
    }
  }
  return src.length;
}

/**
 * End of a quoted name: "..." or `...` (the quote doubled is a quote inside),
 * or [...] for T-SQL (]] is a ] inside). A name never spans lines, so if there
 * is no closing mark on the same line this returns -1 and the mark is left as
 * plain punctuation instead of swallowing the rest of the file.
 */
function quotedNameEnd(src: string, i: number): number {
  const open = src[i]!;
  const close = open === "[" ? "]" : open;
  let j = i + 1;
  while (j < src.length && src[j] !== "\n") {
    // A [ followed by a quote or comma is an array like ARRAY['a', 'b'], not a T-SQL name.
    if (open === "[" && (src[j] === "'" || src[j] === ",")) {
      return -1;
    }
    if (src[j] === close) {
      if (src[j + 1] === close) {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j++;
  }
  return -1;
}

/** Matches the start of a PostgreSQL dollar quote: $$ or $tag$. A tag can't start with a digit, so $1 doesn't match. */
const DOLLAR_QUOTE = /\$(?:[\p{L}_][\p{L}\p{N}_]*)?\$/uy;

/** End of a dollar-quoted string whose opening delimiter (like $tag$) is at i, or -1 if there is no delimiter here. */
function dollarQuoteEnd(src: string, i: number): number {
  DOLLAR_QUOTE.lastIndex = i;
  const match = DOLLAR_QUOTE.exec(src);
  if (!match) {
    return -1;
  }
  const delimiter = match[0];
  const close = src.indexOf(delimiter, i + delimiter.length);
  return close === -1 ? src.length : close + delimiter.length;
}

/**
 * End of a number: 42, 1_000, 3.14, .5, 1e10, 1.5E-3, 0x1F.
 * A dot only counts when a digit follows it, so `1.` before a name stays separate.
 */
function numberEnd(src: string, i: number): number {
  if (src[i] === "0" && /[xX]/.test(src[i + 1] ?? "") && /[0-9a-fA-F]/.test(src[i + 2] ?? "")) {
    let j = i + 2;
    while (j < src.length && /[0-9a-fA-F_]/.test(src[j]!)) {
      j++;
    }
    return j;
  }
  let j = i;
  while (j < src.length && (isDigit(src[j]) || src[j] === "_")) {
    j++;
  }
  if (src[j] === "." && isDigit(src[j + 1])) {
    j++;
    while (j < src.length && (isDigit(src[j]) || src[j] === "_")) {
      j++;
    }
  }
  if (/[eE]/.test(src[j] ?? "")) {
    const signed = src[j + 1] === "+" || src[j + 1] === "-";
    if (isDigit(src[j + (signed ? 2 : 1)])) {
      j += signed ? 2 : 1;
      while (j < src.length && isDigit(src[j])) {
        j++;
      }
    }
  }
  return j;
}

/**
 * Is the # at index i the start of a MySQL comment? It is when it is the first thing
 * on its line, or when it has a space before it and a space or the line end after it.
 * Anything else is left alone, so PostgreSQL's #> and #>> operators and T-SQL's #temp
 * table names are not turned into comments.
 */
function isHashComment(src: string, i: number): boolean {
  let k = i - 1;
  while (k >= 0 && isInlineSpace(src[k])) {
    k--;
  }
  if (k < 0 || src[k] === "\n") {
    return true;
  }
  const before = src[i - 1];
  const after = src[i + 1];
  return (before === " " || before === "\t") && (after === undefined || after === " " || after === "\t" || after === "\n" || after === "\r");
}

/**
 * Splits SQL source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizeSql(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;
  let i = 0;
  // The last character of real code (spaces and comments don't count).
  // A name right after a dot (t.order) is a column, never a keyword.
  let lastChar = "";

  const code = (kind: TokenKind, start: number, end: number): void => {
    push(kind, start, end);
    lastChar = source[end - 1] ?? lastChar;
  };

  while (i < n) {
    const ch = source[i]!;

    if (ch === "\n" || isInlineSpace(ch)) {
      let j = i + 1;
      while (j < n && (source[j] === "\n" || isInlineSpace(source[j]))) {
        j++;
      }
      push("plain", i, j);
      i = j;
      continue;
    }

    // Comments come before the operators, so a lone - or / falls through to the operator case.
    if ((ch === "-" && source[i + 1] === "-") || (ch === "#" && isHashComment(source, i))) {
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

    if (ch === "'") {
      const end = stringEnd(source, i);
      code("string", i, end);
      i = end;
      continue;
    }

    if (ch === "$") {
      const end = dollarQuoteEnd(source, i);
      if (end !== -1) {
        code("string", i, end);
        i = end;
        continue;
      }
      // A parameter like $1 or $12: the $ and its digits are one plain piece.
      let j = i + 1;
      while (isDigit(source[j])) {
        j++;
      }
      code("plain", i, j);
      i = j;
      continue;
    }

    if (ch === '"' || ch === "`" || ch === "[") {
      const end = quotedNameEnd(source, i);
      if (end !== -1) {
        code("plain", i, end);
        i = end;
        continue;
      }
      // No closing mark on this line: just one plain character.
      code("plain", i, i + 1);
      i++;
      continue;
    }

    // Names with a sigil: @variable, @@rowcount (T-SQL), #temp and ##global (T-SQL). They are plain, never keywords.
    if ((ch === "@" || ch === "#") && (isIdentStart(source[i + 1]) || ((source[i + 1] === ch) && isIdentStart(source[i + 2])))) {
      let j = i;
      while (source[j] === ch) {
        j++;
      }
      const end = identEnd(source, j);
      code("plain", i, end);
      i = end;
      continue;
    }

    if (isIdentStart(ch)) {
      const j = identEnd(source, i);
      const word = source.slice(i, j);
      // E'..', N'..', X'..' and B'..' are strings with a one-letter prefix, so the prefix is part of the string.
      if (word.length === 1 && STRING_PREFIXES.has(word.toLowerCase()) && source[j] === "'") {
        const end = stringEnd(source, j, word === "E" || word === "e");
        code("string", i, end);
        i = end;
        continue;
      }
      const lower = word.toLowerCase();
      const afterDot = lastChar === ".";
      let kind: TokenKind = "plain";
      if (!afterDot) {
        if (KEYWORDS.has(lower)) {
          kind = "keyword";
        } else if (TYPES.has(lower)) {
          kind = "type";
        } else if (FUNCTIONS.has(lower) && source[skipInlineSpace(source, j)] === "(") {
          kind = "keyword";
        }
      }
      code(kind, i, j);
      i = j;
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(source[i + 1]) && !isIdentPart(source[i - 1]) && source[i - 1] !== '"' && source[i - 1] !== "`" && source[i - 1] !== "]")) {
      // A number that starts with a dot (.5) is read as a number, so skip the dot first.
      const end = ch === "." ? numberEnd(source, i + 1) : numberEnd(source, i);
      code("number", i, end);
      i = end;
      continue;
    }

    // Operators and punctuation (::, <>, !=, ||, ...), one character at a time.
    // They are all plain, so they merge into one token. Takes a surrogate pair as one character.
    const codePoint = source.codePointAt(i) ?? 0;
    const length = codePoint > 0xffff ? 2 : 1;
    code("plain", i, i + length);
    i += length;
  }

  return builder.lines();
}
