// A small tokenizer for Shell / Bash syntax colouring. Like the others, it
// labels pieces of code without changing a single character, and it is
// pattern-based, not a full parser.
// The shell-specific parts:
//   - A # only starts a comment at the start of a word (line start, or after
//     a space, ; | & ( ). So $#, ${#var}, ${var#x} and a#b have no comment.
//   - Single quotes have no escapes at all. $'...' does honour backslashes.
//   - Double quotes can hold $var, ${...}, $(...) and `...`. Those are
//     tokenized as code, so a quote inside $( ) does not end the outer string.
//   - Heredocs (<<EOF, <<-EOF, <<'EOF') make the lines after the command
//     a string, up to a line that is just the terminator word.
//   - Words like if, then, echo only count as keywords where a command can
//     start, so `echo if` leaves the second word alone.
//   - case patterns end with ) and each clause ends with ;;
// Colours: keywords and builtins are keywords, $variables are the type
// colour, and quoted text, heredoc bodies and $'...' are strings.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** How deep $( ), ( ) and backticks may nest before the rest is left plain. Keeps odd input from blowing the stack. */
const MAX_NESTING = 40;

/** Reserved words and the common declaration words (compared exactly, shell is case sensitive). */
const KEYWORDS = new Set([
  "if", "then", "elif", "else", "fi", "for", "while", "until", "do", "done", "case", "esac", "in",
  "function", "select", "time", "coproc", "[[",
  "return", "local", "export", "readonly", "declare", "typeset", "break", "continue",
]);

/** After these words a new command can start (if grep x; then ...), so the next word may be a keyword. */
const COMMAND_FOLLOWS = new Set(["if", "then", "elif", "else", "while", "until", "do", "time", "coproc"]);

/** Common builtin commands. */
const BUILTINS = new Set([
  "echo", "printf", "read", "cd", "pwd", "pushd", "popd", "dirs", "exit", "shift", "set", "unset", "source", ".",
  "eval", "exec", "test", "[", "trap", "wait", "kill", "alias", "unalias", "let", "getopts", "true", "false",
  "type", "hash", "ulimit", "umask", "jobs", "fg", "bg", "mapfile", "readarray", "shopt", "command", "builtin",
  "enable", "help", "history", "fc", "bind", "caller", "compgen", "complete", "disown", "suspend", "times", ":",
]);

/** Characters that end a word (besides spaces). Quotes, $ and backslash are handled on their own. */
const WORD_STOPS = new Set([";", "|", "&", "(", ")", "<", ">", "'", '"', "`", "$", "\\"]);

/** Characters that may come after a # for it to still be the start of a word. */
const BEFORE_COMMENT = new Set([";", "|", "&", "(", "`"]);

/** Single-character variables: $@ $* $# $? $$ $! $- and $0 to $9. */
const SPECIAL_VARIABLES = new Set(["@", "*", "#", "?", "$", "!", "-"]);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/;
const NUMBER_WORD = /^(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?)$/;

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isNameStart(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z_]/.test(ch);
}

function isNameChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

function isInlineSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v";
}

function isSpace(ch: string | undefined): boolean {
  return ch === "\n" || isInlineSpace(ch);
}

/** A heredoc whose body has not been read yet (it starts on the line after the command). */
interface PendingHeredoc {
  tag: string;
  /** <<- lets the terminator line start with tabs. */
  stripTabs: boolean;
}

/**
 * Splits shell source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizeShell(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;
  const pending: PendingHeredoc[] = [];

  /** The end of a single-quoted string whose quote is at i. No escapes. Unclosed runs to the end of the file. */
  const singleQuoteEnd = (i: number): number => {
    const close = source.indexOf("'", i + 1);
    return close === -1 ? n : close + 1;
  };

  /** The end of a $'...' string whose quote is at i. Backslash escapes work here. */
  const ansiQuoteEnd = (i: number): number => {
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

  /** The end of a ${...} whose $ is at i (counting nested braces and skipping quoted bits), or -1 if it never closes. */
  const braceEnd = (i: number): number => {
    if (source.indexOf("}", i + 2) === -1) {
      return -1; // no } left anywhere, so don't bother scanning
    }
    let depth = 1;
    let j = i + 2;
    while (j < n) {
      const ch = source[j]!;
      if (ch === "\\") {
        j += 2;
        continue;
      }
      if (ch === "'" || ch === '"') {
        // Skip a quoted bit, so a } inside it doesn't count. If it never closes, treat the quote as a normal character.
        let k = j + 1;
        while (k < n && source[k] !== ch) {
          k += ch === '"' && source[k] === "\\" ? 2 : 1;
        }
        if (k < n) {
          j = k + 1;
          continue;
        }
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          return j + 1;
        }
      }
      j++;
    }
    return -1;
  };

  /** Reads the heredoc bodies that were waiting for a line break. i is the start of the first body line. Returns where reading stopped. */
  const readHeredocBodies = (i: number): number => {
    let pos = i;
    while (pending.length > 0 && pos < n) {
      const { tag, stripTabs } = pending.shift()!;
      let found = false;
      while (pos < n && !found) {
        const nl = source.indexOf("\n", pos);
        const lineEnd = nl === -1 ? n : nl;
        let line = source.slice(pos, lineEnd);
        if (line.endsWith("\r")) {
          line = line.slice(0, -1);
        }
        if ((stripTabs ? line.replace(/^\t+/, "") : line) === tag) {
          found = true;
        }
        // Skip the line break too when another body follows, so one string covers both.
        pos = lineEnd + (nl !== -1 && (!found || pending.length > 0) ? 1 : 0);
      }
    }
    pending.length = 0; // a heredoc with no body left (end of file)
    push("string", i, pos);
    return pos;
  };

  /**
   * Looks at a << at index i and reads the heredoc word after it.
   * Returns null when it is not a heredoc.
   */
  const heredocStart = (i: number): { markerEnd: number; tagStart: number; tagEnd: number; tag: string; stripTabs: boolean } | null => {
    let j = i + 2;
    const stripTabs = source[j] === "-";
    if (stripTabs) {
      j++;
    }
    let k = j;
    while (source[k] === " " || source[k] === "\t") {
      k++;
    }
    const tagStart = k;
    const first = source[k];
    if (!(isNameStart(first) || first === "'" || first === '"' || first === "\\")) {
      return null;
    }
    let tag = "";
    // The word runs to a space or an operator, but quotes and backslashes inside it are part of the word.
    while (k < n && !isSpace(source[k]) && (!WORD_STOPS.has(source[k]!) || source[k] === "'" || source[k] === '"' || source[k] === "\\")) {
      const ch = source[k]!;
      if (ch === "'" || ch === '"') {
        const close = source.indexOf(ch, k + 1);
        if (close === -1) {
          return null;
        }
        tag += source.slice(k + 1, close);
        k = close + 1;
      } else if (ch === "\\") {
        if (k + 1 >= n) {
          return null;
        }
        tag += source[k + 1];
        k += 2;
      } else {
        tag += ch;
        k++;
      }
    }
    return tag === "" ? null : { markerEnd: j, tagStart, tagEnd: k, tag, stripTabs };
  };

  /**
   * $ at index i: a variable, ${...}, $(...), $((...)) or a lone $.
   * Pushes the tokens and returns the index after them.
   * inString is true inside double quotes, where a lone $ is part of the string.
   */
  const expansion = (i: number, depth: number, inString: boolean): number => {
    const next = source[i + 1];
    if (next === "{") {
      const end = braceEnd(i);
      if (end !== -1) {
        push("type", i, end);
        return end;
      }
    } else if (next === "(" && depth < MAX_NESTING) {
      if (source[i + 2] === "(") {
        push("plain", i, i + 3);
        const stop = run(i + 3, "arith", depth + 1);
        let close = stop;
        while (close < stop + 2 && source[close] === ")") {
          close++;
        }
        push("plain", stop, close);
        return close;
      }
      push("plain", i, i + 2);
      const stop = run(i + 2, "paren", depth + 1);
      if (source[stop] === ")") {
        push("plain", stop, stop + 1);
        return stop + 1;
      }
      return stop;
    } else if (isNameStart(next)) {
      let j = i + 2;
      while (isNameChar(source[j])) {
        j++;
      }
      push("type", i, j);
      return j;
    } else if (isDigit(next) || (next !== undefined && SPECIAL_VARIABLES.has(next))) {
      push("type", i, i + 2);
      return i + 2;
    }
    push(inString ? "string" : "plain", i, i + 1);
    return i + 1;
  };

  /** `...` at index i. Pushes the tokens and returns the index after them. */
  const backtickSub = (i: number, depth: number): number => {
    if (depth >= MAX_NESTING) {
      push("plain", i, i + 1);
      return i + 1;
    }
    push("plain", i, i + 1);
    const stop = run(i + 1, "backtick", depth + 1);
    if (source[stop] === "`") {
      push("plain", stop, stop + 1);
      return stop + 1;
    }
    return stop;
  };

  /**
   * A double-quoted string whose quote is at quoteAt. startAt is where the string
   * token begins (it differs for $"..."). Pieces like $name are pushed as their own tokens.
   */
  const doubleQuoted = (startAt: number, quoteAt: number, depth: number): number => {
    let segStart = startAt;
    let j = quoteAt + 1;
    while (j < n) {
      const ch = source[j]!;
      if (ch === "\\") {
        j += 2;
      } else if (ch === '"') {
        push("string", segStart, j + 1);
        return j + 1;
      } else if (ch === "$" || ch === "`") {
        push("string", segStart, j);
        j = ch === "$" ? expansion(j, depth, true) : backtickSub(j, depth);
        segStart = j;
      } else {
        j++;
      }
    }
    push("string", segStart, n);
    return n;
  };

  /**
   * Colours code from index i. mode says where it stops:
   *   "top"       never (end of the file)
   *   "paren"     at the ) that closes a ( or $(
   *   "backtick"  at the closing `
   *   "arith"     at the ) of the )) that closes $(( or ((
   * Returns the index where it stopped (the closing character itself is not used up).
   */
  function run(start: number, mode: "top" | "paren" | "backtick" | "arith", depth: number): number {
    const arith = mode === "arith";
    let i = start;
    // True where a command can start: the line start, after ; | & ( and after words like then and do.
    let cmdStart = !arith;
    // True right after VAR=value, so `VAR=1 cmd` still treats cmd as a command.
    let inAssign = false;
    // After for/select it is "for", after case it is "case", and the matching `in` is then a keyword.
    let awaitingIn: "" | "for" | "case" = "";
    let caseDepth = 0;
    // True right after the word `function`, when the next word is the function's name.
    let funcName = false;
    // True while reading the pattern of a case clause, up to its closing ).
    let casePattern = false;
    // Open ( of an array like a=(x y), so its ) is not taken as the end of the scope.
    let arrayDepth = 0;
    // Open ( inside arithmetic.
    let arithParens = 0;

    /** A normal piece of a command was used up, so the next word is not at the start of a command. */
    const used = (): void => {
      if (!inAssign) {
        cmdStart = false;
      }
    };

    while (i < n) {
      const ch = source[i]!;

      if (mode === "backtick" && ch === "`") {
        return i;
      }

      if (ch === "\n") {
        push("plain", i, i + 1);
        i++;
        if (pending.length > 0) {
          i = readHeredocBodies(i);
        }
        if (!arith) {
          cmdStart = true;
          inAssign = false;
          awaitingIn = "";
        }
        continue;
      }

      if (isInlineSpace(ch)) {
        let j = i + 1;
        while (isInlineSpace(source[j])) {
          j++;
        }
        push("plain", i, j);
        inAssign = false;
        i = j;
        continue;
      }

      // A backslash escapes the next character, so \# \" \$ and \<newline> are plain.
      if (ch === "\\") {
        const end = Math.min(i + 2, n);
        push("plain", i, end);
        i = end;
        used();
        continue;
      }

      if (ch === "#") {
        const before = source[i - 1];
        if (before === undefined || isSpace(before) || BEFORE_COMMENT.has(before)) {
          const nl = source.indexOf("\n", i);
          const end = nl === -1 ? n : nl;
          push("comment", i, end);
          i = end;
          continue;
        }
      }

      if (ch === "'") {
        const end = singleQuoteEnd(i);
        push("string", i, end);
        i = end;
        used();
        continue;
      }

      if (ch === '"') {
        i = doubleQuoted(i, i, depth);
        used();
        continue;
      }

      if (ch === "`") {
        i = backtickSub(i, depth);
        used();
        continue;
      }

      if (ch === "$") {
        if (source[i + 1] === "'") {
          const end = ansiQuoteEnd(i + 1);
          push("string", i, end);
          i = end;
        } else if (source[i + 1] === '"') {
          i = doubleQuoted(i, i + 1, depth);
        } else {
          i = expansion(i, depth, false);
        }
        used();
        continue;
      }

      if (ch === ";") {
        let length = 1;
        if (source[i + 1] === ";") {
          length = source[i + 2] === "&" ? 3 : 2;
        } else if (source[i + 1] === "&") {
          length = 2;
        }
        push("plain", i, i + length);
        i += length;
        if (!arith) {
          cmdStart = true;
          inAssign = false;
          awaitingIn = "";
          // ;; ends a case clause, so a pattern comes next.
          if (length > 1 && caseDepth > 0) {
            casePattern = true;
          }
        }
        continue;
      }

      if (ch === "|") {
        const length = source[i + 1] === "|" || source[i + 1] === "&" ? 2 : 1;
        push("plain", i, i + length);
        i += length;
        if (!arith && !casePattern) {
          cmdStart = true;
          inAssign = false;
        }
        continue;
      }

      if (ch === "&") {
        if (source[i + 1] === "&") {
          push("plain", i, i + 2);
          i += 2;
          if (!arith) {
            cmdStart = true;
            inAssign = false;
          }
        } else if (source[i + 1] === ">") {
          // &> and &>> send output to a file, a command does not start here.
          const length = source[i + 2] === ">" ? 3 : 2;
          push("plain", i, i + length);
          i += length;
        } else {
          push("plain", i, i + 1);
          i++;
          if (!arith) {
            cmdStart = true;
            inAssign = false;
          }
        }
        continue;
      }

      if (ch === "<") {
        if (source.startsWith("<<<", i)) {
          // A here-string, not a heredoc.
          push("plain", i, i + 3);
          i += 3;
        } else if (!arith && source[i + 1] === "<") {
          const heredoc = heredocStart(i);
          if (heredoc) {
            push("plain", i, heredoc.tagStart);
            push("string", heredoc.tagStart, heredoc.tagEnd);
            pending.push({ tag: heredoc.tag, stripTabs: heredoc.stripTabs });
            i = heredoc.tagEnd;
          } else {
            push("plain", i, i + 2);
            i += 2;
          }
        } else {
          const length = source[i + 1] === "&" || source[i + 1] === ">" ? 2 : 1;
          push("plain", i, i + length);
          i += length;
        }
        used();
        continue;
      }

      if (ch === ">") {
        const length = source[i + 1] === ">" || source[i + 1] === "&" || source[i + 1] === "|" ? 2 : 1;
        push("plain", i, i + length);
        i += length;
        used();
        continue;
      }

      if (ch === "(") {
        if (casePattern) {
          push("plain", i, i + 1); // an optional ( before a case pattern
          i++;
        } else if (arith) {
          arithParens++;
          push("plain", i, i + 1);
          i++;
        } else if (source[i - 1] === "=") {
          // An array like a=(x y z): the words inside are values, not commands.
          arrayDepth++;
          push("plain", i, i + 1);
          i++;
          cmdStart = false;
          inAssign = false;
        } else if (depth < MAX_NESTING && source[i + 1] === "(" && (cmdStart || awaitingIn === "for")) {
          // (( arithmetic )) or for (( ... )).
          push("plain", i, i + 2);
          const stop = run(i + 2, "arith", depth + 1);
          let close = stop;
          while (close < stop + 2 && source[close] === ")") {
            close++;
          }
          push("plain", stop, close);
          i = close;
          cmdStart = false;
          awaitingIn = "";
        } else if (depth < MAX_NESTING) {
          // A subshell ( ... ) or a process substitution <( ... ).
          push("plain", i, i + 1);
          const open = i; // where the ( is
          const stop = run(i + 1, "paren", depth + 1);
          if (source[stop] === ")") {
            push("plain", stop, stop + 1);
            i = stop + 1;
          } else {
            i = stop;
          }
          // Empty brackets after a name (f() { ... }) define a function, so a command can start next.
          cmdStart = stop === open + 1;
        } else {
          push("plain", i, i + 1);
          i++;
        }
        continue;
      }

      if (ch === ")") {
        if (casePattern) {
          // The ) that ends a case pattern. The clause body comes next.
          push("plain", i, i + 1);
          i++;
          casePattern = false;
          cmdStart = true;
        } else if (arith) {
          if (arithParens > 0) {
            arithParens--;
            push("plain", i, i + 1);
            i++;
          } else {
            return i;
          }
        } else if (arrayDepth > 0) {
          arrayDepth--;
          push("plain", i, i + 1);
          i++;
        } else if (mode === "paren") {
          return i;
        } else {
          push("plain", i, i + 1);
          i++;
        }
        continue;
      }

      // Everything else is a word: letters, digits, option flags, paths, = and so on.
      // A # in the middle of a word (a#b) is just a character.
      let j = i;
      while (j < n && !isSpace(source[j]) && !WORD_STOPS.has(source[j]!)) {
        j++;
      }
      if (j === i) {
        // Cannot happen, but never get stuck.
        push("plain", i, i + 1);
        i++;
        continue;
      }
      const word = source.slice(i, j);
      let kind: TokenKind = "plain";
      if (arith) {
        kind = NUMBER_WORD.test(word) ? "number" : "plain";
      } else if (casePattern) {
        if (word === "esac") {
          kind = "keyword";
          caseDepth = Math.max(0, caseDepth - 1);
          casePattern = false;
          cmdStart = false;
        }
      } else if (funcName) {
        // The name after `function`. The body ( { ... } ) comes next.
        funcName = false;
        cmdStart = true;
      } else if (word === "]]" || word === "]") {
        kind = "keyword";
        used();
      } else if (awaitingIn !== "" && word === "in") {
        kind = "keyword";
        if (awaitingIn === "case") {
          caseDepth++;
          casePattern = true;
        }
        awaitingIn = "";
        cmdStart = false;
      } else if (cmdStart && KEYWORDS.has(word)) {
        kind = "keyword";
        if (word === "for" || word === "select") {
          awaitingIn = "for";
        } else if (word === "case") {
          awaitingIn = "case";
        } else if (word === "function") {
          funcName = true;
        } else if (word === "do" || word === "then") {
          awaitingIn = "";
        } else if (word === "esac") {
          caseDepth = Math.max(0, caseDepth - 1);
        }
        cmdStart = COMMAND_FOLLOWS.has(word);
      } else if (cmdStart && BUILTINS.has(word)) {
        kind = "keyword";
        cmdStart = false;
      } else if (cmdStart && ASSIGNMENT.test(word)) {
        // VAR=value: the command (if any) comes after it.
        inAssign = true;
      } else if (cmdStart && (word === "{" || word === "!")) {
        // A { group or a ! not: a command starts right after.
      } else {
        const next = source[j];
        const before = source[i - 1];
        // A digit before > or < is a file descriptor (2>&1), not a number.
        if (NUMBER_WORD.test(word) && next !== ">" && next !== "<" && before !== "&" && before !== ">" && before !== "<") {
          kind = "number";
        }
        used();
      }
      push(kind, i, j);
      i = j;
    }
    return n;
  }

  run(0, "top", 0);
  return builder.lines();
}
