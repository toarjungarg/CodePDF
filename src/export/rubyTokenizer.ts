// A small tokenizer for Ruby syntax colouring. Like the others, it labels
// pieces of code without changing a single character, and it is
// pattern-based, not a full parser.
// The Ruby-specific parts:
//   - # starts a comment, and =begin ... =end is a block comment, but only
//     when the = is the first character of a line. __END__ on its own line
//     makes the rest of the file a comment (it is data, not code).
//   - 'single quotes' have no interpolation. "double quotes", `backticks`,
//     regexes and most % literals can hold #{code}. The code inside the braces
//     is coloured as code, and it can hold its own braces and strings.
//   - % literals (%w[] %i() %q{} %Q<> %()) end at the matching bracket, and
//     brackets of the same kind inside them nest.
//   - Heredocs (<<~EOS, <<-EOS, <<EOS, <<~'EOS') make the lines after the
//     current line a string, up to the line that holds only the tag. A << is
//     only a heredoc when a value cannot come before it (or a plain method name
//     with a space before it, like `puts <<~EOS`) and the tag really shows
//     up as a line later in the file. So `a << b` and `x<<1` stay shifts.
//   - Symbols (:name, :+, :"quoted") and hash labels (name: value) use the
//     number colour. :: (scope) and the : of a ternary are plain.
//   - @name, @@name and $name variables, and names that start with a capital
//     letter (constants and classes), use the type colour.
//   - A / starts a regex only where a value can start (after an operator, a
//     bracket, a comma, a keyword or at the start of a line), so division is
//     left alone. The same rule decides % literals, ?a character literals and
//     heredocs.
//   - Method names can end in ? or !, and a keyword after a dot (like x.class)
//     or after def is just a method name.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** How deep #{ } may nest before the rest is left as string. Keeps odd input from blowing the stack. */
const MAX_NESTING = 40;

/** Words that are always keywords (except right after a dot or def, where they are method names). */
const KEYWORDS = new Set([
  "alias", "and", "begin", "break", "case", "class", "def", "defined?", "do", "else", "elsif", "end", "ensure",
  "false", "for", "if", "in", "module", "next", "nil", "not", "or", "redo", "rescue", "retry", "return", "self",
  "super", "then", "true", "undef", "unless", "until", "when", "while", "yield", "__FILE__", "__LINE__", "__ENCODING__",
]);

/** Keywords that stand for a value, so an operator after them (like `end / 2`) is not the start of something new. */
const VALUE_KEYWORDS = new Set(["end", "self", "nil", "true", "false", "super", "__FILE__", "__LINE__", "__ENCODING__"]);

/** Common methods that read like keywords. They are only coloured when they are not being assigned to. */
const COMMON_METHODS = new Set([
  "require", "require_relative", "load", "include", "extend", "prepend", "attr_reader", "attr_writer", "attr_accessor",
  "private", "protected", "public", "private_constant", "module_function", "raise", "loop", "lambda", "proc", "puts", "print",
]);

/** The letters after a regex that are flags (i, m, x, o, u, n, s, e). */
const REGEX_FLAGS = "imxounse";

/** Single characters that can follow a $ to make a special global variable ($! $0 $; $, ...). */
const GLOBAL_PUNCTUATION = "~*$?!@/\\;,.=:<>\"&`'+0";

const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}\p{M}_]/u;
const UPPERCASE_START = /^\p{Lu}/u;

/** <<~EOS, <<-EOS, <<EOS, <<~'EOS' and <<~"EOS". The groups are: the ~ or -, a bare tag, a '..' tag, a ".." tag. */
const HEREDOC_START = /<<([~-]?)(?:([\p{L}_][\p{L}\p{N}_]*)|'([^'\n]+)'|"([^"\n]+)")/uy;

/** A % literal start: the optional type letter and the opening mark. */
const PERCENT_START = /%([qQwWiIrsx]?)([^\p{L}\p{N}\s=])/uy;

/** Operator names a method can have: def ==(o), def <=>(o), def [](i), def +(o), def -@ ... */
const OPERATOR_NAME = /\[\]=?|<=>|===?|=~|!=|!~|\*\*|<<|>>|<=|>=|[+\-~!]@?|[*\/%<>^&|`]/y;

/** An operator symbol: :+ :<=> :[] :== ... (the colon comes first). */
const OPERATOR_SYMBOL = /:(?:\[\]=?|<=>|===?|=~|!=|!~|\*\*|<<|>>|<=|>=|[+\-]@?|[*\/%<>!~^&|`])/y;

const OPENERS: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">" };

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

function isSpace(ch: string | undefined): boolean {
  return ch === "\n" || isInlineSpace(ch);
}

/** The end of a name (letters, digits, underscores) that starts at i. */
function identEnd(src: string, i: number): number {
  let j = i;
  while (j < src.length && isIdentPart(src[j])) {
    j++;
  }
  return j;
}

/** The end of a name plus a ? or ! on the end, as in `empty?` and `save!`. `a != b` and `a !~ b` keep their operator. */
function methodNameEnd(src: string, i: number): number {
  const j = identEnd(src, i);
  const mark = src[j];
  if (mark === "?" || mark === "!") {
    const next = src[j + 1];
    if (next !== "=" || src[j + 2] === "=" || src[j + 2] === "~" || src[j + 2] === ">") {
      return j + 1;
    }
  }
  return j;
}

/** Digits with underscores between them (1_000). Returns where they stop. */
function digitsEnd(src: string, i: number, isOk: (ch: string | undefined) => boolean): number {
  let j = i;
  while (j < src.length && (isOk(src[j]) || (src[j] === "_" && isOk(src[j + 1])))) {
    j++;
  }
  return j;
}

/** The end of a number that starts at i: 1_000, 0xFF, 0b101, 0o17, 1.5, 1e-3, 3r, 2i. A "1..5" range stops after the 1. */
function numberEnd(src: string, i: number): number {
  let j = i;
  const prefix = src[i] === "0" ? src[i + 1]?.toLowerCase() : undefined;
  if (prefix === "x") {
    j = digitsEnd(src, i + 2, (c) => c !== undefined && /[0-9a-fA-F]/.test(c));
  } else if (prefix === "b") {
    j = digitsEnd(src, i + 2, (c) => c === "0" || c === "1");
  } else if (prefix === "o" || prefix === "d") {
    j = digitsEnd(src, i + 2, isDigit);
  } else {
    j = digitsEnd(src, i, isDigit);
    // A fraction needs a digit after the dot, so 1..5 and 1.times are not floats.
    if (src[j] === "." && isDigit(src[j + 1])) {
      j = digitsEnd(src, j + 1, isDigit);
    }
    // An exponent: e3, E+3, e-3.
    if ((src[j] === "e" || src[j] === "E") && (isDigit(src[j + 1]) || ((src[j + 1] === "+" || src[j + 1] === "-") && isDigit(src[j + 2])))) {
      j = digitsEnd(src, j + 2, isDigit);
    }
  }
  // Rational and imaginary endings: 3r, 2i, 3ri.
  const ending = /^(?:ri|r|i)(?![\p{L}\p{N}_])/u.exec(src.slice(j, j + 3));
  return ending ? j + ending[0].length : j;
}

/** True when an unescaped / shows up later on this line, so `foo /x/` really is a regex. */
function slashCloses(src: string, i: number): boolean {
  for (let j = i + 1; j < src.length && src[j] !== "\n"; j++) {
    if (src[j] === "\\") {
      j++;
    } else if (src[j] === "/") {
      return true;
    }
  }
  return false;
}

/** A heredoc whose body has not been read yet (it starts on the line after the command). */
interface PendingHeredoc {
  tag: string;
  /** <<~ and <<- let the terminator line be indented. */
  indented: boolean;
}

/**
 * Splits Ruby source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizeRuby(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;
  const pending: PendingHeredoc[] = [];

  /** The end of a 'single quoted' string whose quote is at i. Only \\ and \' are escapes, so it is enough to skip the char after a backslash. */
  const singleQuoteEnd = (i: number): number => {
    let j = i + 1;
    while (j < n) {
      if (source[j] === "\\") {
        j += 2;
      } else if (source[j] === "'") {
        return j + 1;
      } else {
        j++;
      }
    }
    return n;
  };

  /**
   * A quoted thing that starts at `start`, whose text begins at bodyStart. It ends at the
   * matching `close` (brackets of the same kind inside nest). With `interpolate`, #{code}
   * is coloured as code. Pushes the tokens and returns the index after the closing mark.
   */
  const quoted = (start: number, bodyStart: number, open: string, close: string, interpolate: boolean, depth: number): number => {
    let segStart = start;
    let level = 1;
    let j = bodyStart;
    while (j < n) {
      const ch = source[j]!;
      if (ch === "\\") {
        j += 2;
        continue;
      }
      if (interpolate && ch === "#" && source[j + 1] === "{" && depth < MAX_NESTING) {
        push("string", segStart, j);
        push("plain", j, j + 2);
        const stop = run(j + 2, true, depth + 1);
        if (source[stop] === "}") {
          push("plain", stop, stop + 1);
          j = stop + 1;
        } else {
          j = stop;
        }
        segStart = j;
        continue;
      }
      if (open !== close && ch === open) {
        level++;
      } else if (ch === close) {
        level--;
        if (level === 0) {
          push("string", segStart, j + 1);
          return j + 1;
        }
      }
      j++;
    }
    push("string", segStart, n);
    return n;
  };

  /** True if a line after the one holding index `from` is just the tag (a heredoc really ends somewhere). */
  const hasTerminator = (from: number, tag: string, indented: boolean): boolean => {
    let nl = source.indexOf("\n", from);
    while (nl !== -1) {
      const start = nl + 1;
      let end = source.indexOf("\n", start);
      if (end === -1) {
        end = n;
      }
      let line = source.slice(start, end);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      if ((indented ? line.trimStart() : line) === tag) {
        return true;
      }
      nl = end === n ? -1 : end;
    }
    return false;
  };

  /** Reads the heredoc bodies that were waiting for a line break. i is the start of the first body line. Returns where reading stopped. */
  const readHeredocBodies = (i: number): number => {
    let pos = i;
    while (pending.length > 0 && pos < n) {
      const { tag, indented } = pending.shift()!;
      let found = false;
      while (pos < n && !found) {
        const nl = source.indexOf("\n", pos);
        const lineEnd = nl === -1 ? n : nl;
        let line = source.slice(pos, lineEnd);
        if (line.endsWith("\r")) {
          line = line.slice(0, -1);
        }
        if ((indented ? line.trimStart() : line) === tag) {
          found = true;
        }
        // Keep the line break inside the string when another body follows, so one string covers both.
        pos = lineEnd + (nl !== -1 && (!found || pending.length > 0) ? 1 : 0);
      }
    }
    pending.length = 0; // a heredoc with no body left (end of file)
    push("string", i, pos);
    return pos;
  };

  /**
   * Colours code from index start. With inBrace it stops at the } that closes a #{ and
   * returns that index (the } itself is not used up). Otherwise it runs to the end of the file.
   */
  function run(start: number, inBrace: boolean, depth: number): number {
    let i = start;
    // True when the last token was a value (a name, number, string, closing bracket...). Then a / is
    // division, a % is modulo, a << is a shift and a ? is a ternary, not the start of a literal.
    let operand = false;
    // True when the last token was a plain method or variable name. `puts <<~EOS` and `split /,/` work from here.
    let afterName = false;
    // True right after a . or :: , where a keyword-like word is just a method name.
    let afterDot = false;
    // How many { are open inside this #{ }.
    let braces = 0;

    /** A value was used up. */
    const value = (): void => {
      operand = true;
      afterName = false;
      afterDot = false;
    };
    /** An operator or opening bracket was used up, so a value can start next. */
    const other = (): void => {
      operand = false;
      afterName = false;
      afterDot = false;
    };

    while (i < n) {
      const ch = source[i]!;
      const lineStart = i === 0 || source[i - 1] === "\n";

      if (ch === "\n") {
        push("plain", i, i + 1);
        i++;
        if (pending.length > 0) {
          i = readHeredocBodies(i);
        }
        other();
        continue;
      }

      if (isInlineSpace(ch)) {
        let j = i + 1;
        while (isInlineSpace(source[j])) {
          j++;
        }
        push("plain", i, j);
        i = j;
        continue;
      }

      // =begin ... =end, only when the = is the first character of the line.
      if (ch === "=" && lineStart && source.startsWith("=begin", i) && (i + 6 >= n || isSpace(source[i + 6]))) {
        let end = n;
        let from = i;
        while (true) {
          const at = source.indexOf("\n=end", from);
          if (at === -1) {
            break;
          }
          if (at + 5 >= n || isSpace(source[at + 5])) {
            const nl = source.indexOf("\n", at + 1);
            end = nl === -1 ? n : nl;
            break;
          }
          from = at + 1;
        }
        push("comment", i, end);
        i = end;
        continue;
      }

      // __END__ on a line of its own: everything after it is data.
      if (ch === "_" && lineStart && source.startsWith("__END__", i) && (i + 7 >= n || source[i + 7] === "\n" || source[i + 7] === "\r")) {
        push("keyword", i, i + 7);
        push("comment", i + 7, n);
        return n;
      }

      if (ch === "#") {
        const nl = source.indexOf("\n", i);
        const end = nl === -1 ? n : nl;
        push("comment", i, end);
        i = end;
        continue;
      }

      // A backslash outside a string joins this line to the next one.
      if (ch === "\\") {
        const end = Math.min(i + 2, n);
        push("plain", i, end);
        i = end;
        continue;
      }

      if (ch === "'") {
        const end = singleQuoteEnd(i);
        push("string", i, end);
        i = end;
        value();
        continue;
      }

      if (ch === '"' || ch === "`") {
        i = quoted(i, i + 1, ch, ch, true, depth);
        value();
        continue;
      }

      if (ch === "@") {
        let j = i + 1;
        if (source[j] === "@") {
          j++;
        }
        if (isIdentStart(source[j])) {
          j = identEnd(source, j);
          push("type", i, j);
          i = j;
        } else {
          push("plain", i, i + 1);
          i++;
        }
        value();
        continue;
      }

      if (ch === "$") {
        const next = source[i + 1];
        let j = i + 1;
        if (isIdentStart(next)) {
          j = identEnd(source, j);
        } else if (isDigit(next)) {
          while (isDigit(source[j])) {
            j++;
          }
        } else if (next === "-" && isIdentPart(source[i + 2])) {
          j = i + 3;
        } else if (next !== undefined && GLOBAL_PUNCTUATION.includes(next)) {
          j = i + 2;
        }
        push(j > i + 1 ? "type" : "plain", i, Math.max(j, i + 1));
        i = Math.max(j, i + 1);
        value();
        continue;
      }

      if (isDigit(ch)) {
        const end = numberEnd(source, i);
        push("number", i, end);
        i = end;
        value();
        continue;
      }

      if (ch === ":") {
        const next = source[i + 1];
        const before = source[i - 1];
        if (next === ":") {
          // The scope operator, as in Foo::Bar.
          push("plain", i, i + 2);
          i += 2;
          other();
          afterDot = true;
          continue;
        }
        // A symbol cannot start right after a name or closing bracket (that is a ternary like a ?b:c).
        const symbolOk = !(isIdentPart(before) || before === ")" || before === "]" || before === '"' || before === "'");
        if (symbolOk && (next === '"' || next === "'")) {
          i = next === '"' ? quoted(i, i + 2, '"', '"', true, depth) : (() => {
            const end = singleQuoteEnd(i + 1);
            push("string", i, end);
            return end;
          })();
          value();
          continue;
        }
        if (symbolOk && (isIdentStart(next) || next === "@" || next === "$")) {
          let j = i + 1;
          if (next === "@" || next === "$") {
            j++;
            if (source[j] === "@") {
              j++;
            }
            j = identEnd(source, j);
          } else {
            j = methodNameEnd(source, j);
            // A setter symbol like :name=, but not the old hash style :a=>1.
            if (source[j] === "=" && source[j + 1] !== "=" && source[j + 1] !== "~" && source[j + 1] !== ">" && !/[?!]$/.test(source.slice(i, j))) {
              j++;
            }
          }
          push("number", i, j);
          i = j;
          value();
          continue;
        }
        if (symbolOk) {
          OPERATOR_SYMBOL.lastIndex = i;
          const op = OPERATOR_SYMBOL.exec(source);
          if (op) {
            push("number", i, i + op[0].length);
            i += op[0].length;
            value();
            continue;
          }
        }
        push("plain", i, i + 1);
        i++;
        other();
        continue;
      }

      // A character literal like ?a or ?\n, only where a value can start (so a ternary ? is left alone).
      if (ch === "?" && !operand) {
        const next = source[i + 1];
        let end = -1;
        if (next === "\\" && i + 2 < n) {
          end = i + 3;
        } else if (next !== undefined && !isSpace(next) && !isIdentPart(source[i + 2])) {
          end = i + 2;
        }
        if (end !== -1) {
          push("string", i, end);
          i = end;
          value();
          continue;
        }
      }

      if (ch === "%" && (!operand || (afterName && isInlineSpace(source[i - 1])))) {
        PERCENT_START.lastIndex = i;
        const m = PERCENT_START.exec(source);
        if (m) {
          const letter = m[1]!;
          const open = m[2]!;
          // With no letter only a few openers count (%(a) %[a]), so `x % y` style code is safe.
          // After a plain name (`foo %w[a b]`) a letter and a bracket are both needed.
          const allowed = afterName && operand
            ? letter !== "" && "([{<".includes(open)
            : letter !== "" || "([{<|!/".includes(open);
          if (allowed) {
            const close = OPENERS[open] ?? open;
            const interpolate = letter === "" || letter === "Q" || letter === "W" || letter === "I" || letter === "r" || letter === "x";
            let end = quoted(i, i + m[0].length, open, close, interpolate, depth);
            if (letter === "r") {
              const flagsStart = end;
              while (end < n && REGEX_FLAGS.includes(source[end]!)) {
                end++;
              }
              push("string", flagsStart, end);
            }
            i = end;
            value();
            continue;
          }
        }
      }

      if (ch === "/" && (!operand || (afterName && isInlineSpace(source[i - 1]) && !isSpace(source[i + 1]) && source[i + 1] !== "=" && slashCloses(source, i)))) {
        let end = quoted(i, i + 1, "/", "/", true, depth);
        const flagsStart = end;
        while (end < n && REGEX_FLAGS.includes(source[end]!)) {
          end++;
        }
        push("string", flagsStart, end);
        i = end;
        value();
        continue;
      }

      if (ch === "<" && source[i + 1] === "<") {
        HEREDOC_START.lastIndex = i;
        const m = HEREDOC_START.exec(source);
        if (m && (!operand || (afterName && isInlineSpace(source[i - 1])))) {
          const flag = m[1]!;
          const quotedTag = m[3] ?? m[4];
          const tag = quotedTag ?? m[2]!;
          // A bare tag must look like a constant (<<EOS) unless it has a ~ in front, so `a <<b` is not a heredoc.
          const looksRight = flag === "~" || quotedTag !== undefined || /^[A-Z_]/.test(tag);
          const indented = flag !== "";
          if (looksRight && hasTerminator(i, tag, indented)) {
            push("string", i, i + m[0].length);
            pending.push({ tag, indented });
            i += m[0].length;
            value();
            continue;
          }
        }
        push("plain", i, i + 2);
        i += 2;
        other();
        continue;
      }

      if (isIdentStart(ch)) {
        const wordEnd = methodNameEnd(source, i);
        const word = source.slice(i, wordEnd);

        // Right after a dot, every word is a method name, even if it looks like a keyword.
        if (afterDot) {
          const isConstant = UPPERCASE_START.test(word);
          push(isConstant ? "type" : "plain", i, wordEnd);
          i = wordEnd;
          value();
          afterName = !isConstant;
          continue;
        }

        // A hash label like name: or valid?: (the colon must be followed by a space, so a ?b:c ternary is safe).
        if (source[wordEnd] === ":" && source[wordEnd + 1] !== ":" && (wordEnd + 1 >= n || isSpace(source[wordEnd + 1]))) {
          push("number", i, wordEnd + 1);
          i = wordEnd + 1;
          other();
          continue;
        }

        if (word === "def") {
          push("keyword", i, wordEnd);
          i = wordEnd;
          let k = i;
          while (isInlineSpace(source[k])) {
            k++;
          }
          push("plain", i, k);
          i = k;
          // An optional owner (def self.name, def Config.name), then the method name or operator.
          let nameStart = i;
          const ownerEnd = identEnd(source, i);
          if (ownerEnd > i && source[ownerEnd] === ".") {
            const owner = source.slice(i, ownerEnd);
            push(owner === "self" ? "keyword" : UPPERCASE_START.test(owner) ? "type" : "plain", i, ownerEnd);
            push("plain", ownerEnd, ownerEnd + 1);
            nameStart = ownerEnd + 1;
          }
          let nameEnd = nameStart;
          if (isIdentStart(source[nameStart])) {
            nameEnd = methodNameEnd(source, nameStart);
            // A setter like def name=(value).
            if (source[nameEnd] === "=" && source[nameEnd + 1] === "(" && !/[?!]$/.test(source.slice(nameStart, nameEnd))) {
              nameEnd++;
            }
          } else {
            OPERATOR_NAME.lastIndex = nameStart;
            const op = OPERATOR_NAME.exec(source);
            if (op) {
              nameEnd = nameStart + op[0].length;
            }
          }
          push("plain", nameStart, nameEnd);
          i = nameEnd;
          value();
          continue;
        }

        let kind: TokenKind = "plain";
        let isName = false;
        if (KEYWORDS.has(word)) {
          kind = "keyword";
        } else if (COMMON_METHODS.has(word) && !/^[ \t]*=(?![=~>])/.test(source.slice(wordEnd, wordEnd + 4))) {
          kind = "keyword";
        } else if (UPPERCASE_START.test(word)) {
          kind = "type";
        } else {
          isName = true;
        }
        push(kind, i, wordEnd);
        i = wordEnd;
        if (kind === "keyword" && !VALUE_KEYWORDS.has(word)) {
          other();
        } else {
          value();
          afterName = isName;
        }
        continue;
      }

      if (ch === ".") {
        const length = source[i + 1] === "." ? (source[i + 2] === "." ? 3 : 2) : 1;
        push("plain", i, i + length);
        i += length;
        other();
        afterDot = length === 1;
        continue;
      }

      if (ch === "&" && source[i + 1] === "." && source[i + 2] !== ".") {
        // The safe navigation operator: user&.name
        push("plain", i, i + 2);
        i += 2;
        other();
        afterDot = true;
        continue;
      }

      if (ch === "{") {
        braces++;
        push("plain", i, i + 1);
        i++;
        other();
        continue;
      }

      if (ch === "}") {
        if (inBrace && braces === 0) {
          return i;
        }
        braces = Math.max(0, braces - 1);
        push("plain", i, i + 1);
        i++;
        value();
        continue;
      }

      if (ch === ")" || ch === "]") {
        push("plain", i, i + 1);
        i++;
        value();
        continue;
      }

      // Every other character is an operator or a bracket. Plain, one at a time.
      push("plain", i, i + 1);
      i++;
      other();
    }
    return n;
  }

  run(0, false, 0);
  return builder.lines();
}
