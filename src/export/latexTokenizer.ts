// A small tokenizer for LaTeX syntax colouring (.tex, .sty and .cls). Like the
// others, it labels pieces of code without changing a single character, and
// it is pattern-based, not a full parser.
// The LaTeX-specific parts:
//   - A % starts a comment that runs to the end of the line. A \% is an
//     escaped percent sign, so it is NOT a comment.
//   - A command is a backslash and letters (\section, \textbf). An @ counts as
//     a letter too, so the macros in .sty and .cls files (\@ifnextchar) are one command.
//     A backslash and one other character (\\, \{, \$, \&, \,) is a "control symbol", one token.
//     Both are coloured as keywords.
//   - Math is coloured as a string: $...$, $$...$$, \(...\) and \[...\]. It can run over
//     several lines, but a blank line (a paragraph break) always ends it, because
//     LaTeX does the same. That way one stray $ cannot colour the rest of the file.
//     A \$ inside math or text is just a dollar sign. A % inside math is still a comment.
//   - \verb|...| (any delimiter, and \verb*) is plain text. So is everything between
//     \begin{verbatim} and \end{verbatim}, and the same for the other
//     environments in VERBATIM_ENVIRONMENTS. Nothing inside them is a comment or a command.
//   - The name in \begin{name} and \end{name} is coloured as a type.
//   - Numbers are coloured, with an optional unit (12pt, 1.5em). In 0.5\textwidth the
//     number and the command are separate tokens.
//   - A parameter like #1 (in macro definitions) is plain, so the digit is not read as a number.
//   - & and ~ and the brackets have no colour of their own, so they are plain.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** Environments whose body is copied as-is. Their text is never read as LaTeX. */
const VERBATIM_ENVIRONMENTS = new Set(["verbatim", "verbatim*", "lstlisting", "minted", "comment"]);

/** The units a number can end with (12pt, 2.5cm, 1em). Only read right after a number. */
const UNITS = new Set(["pt", "pc", "in", "bp", "cm", "mm", "dd", "cc", "sp", "em", "ex", "mu"]);

function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z"));
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

/** Characters allowed in an environment name, like "itemize" or "align*". */
function isEnvNameChar(ch: string | undefined): boolean {
  return ch !== undefined && (isLetter(ch) || isDigit(ch) || ch === "*" || ch === "-" || ch === "_" || ch === "@" || ch === ":");
}

/** True when the line break at `index` is followed by another blank line, which is a paragraph break. */
function isParagraphBreak(source: string, index: number): boolean {
  let j = index + 1;
  while (source[j] === " " || source[j] === "\t" || source[j] === "\r") {
    j++;
  }
  return source[j] === "\n";
}

/** The length of the character at `index`: 2 for an emoji or other character outside the basic range. */
function charLength(source: string, index: number): number {
  const code = source.codePointAt(index);
  return code !== undefined && code > 0xffff ? 2 : 1;
}

export function tokenizeLatex(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;
  let i = 0;

  /**
   * Reads math that starts at `start` (the opening delimiter has length `openLength`).
   * `closer` is "$", "$$", "\\)" or "\\]". Math is coloured as a string, apart from comments.
   * Returns where the math ends: after the closing delimiter, before a blank line, or at the end of the file.
   */
  const readMath = (start: number, openLength: number, closer: string): number => {
    let segmentStart = start;
    let j = start + openLength;
    while (j < n) {
      const ch = source[j]!;
      if (ch === "\\") {
        // A backslash and the character after it go together, so \$ and \% never end or start anything.
        if (closer.startsWith("\\") && source[j + 1] === closer[1]) {
          push("string", segmentStart, j + 2);
          return j + 2;
        }
        j += source[j + 1] === undefined || source[j + 1] === "\n" ? 1 : 1 + charLength(source, j + 1);
        continue;
      }
      if (ch === "%") {
        // A comment inside math ends at the line break, and the math carries on after it.
        push("string", segmentStart, j);
        const nl = source.indexOf("\n", j);
        const end = nl === -1 ? n : nl;
        push("comment", j, end);
        segmentStart = end;
        j = end;
        continue;
      }
      if (ch === "$" && (closer === "$" || (closer === "$$" && source[j + 1] === "$"))) {
        push("string", segmentStart, j + closer.length);
        return j + closer.length;
      }
      if (ch === "\n" && isParagraphBreak(source, j)) {
        push("string", segmentStart, j);
        return j;
      }
      j++;
    }
    push("string", segmentStart, n);
    return n;
  };

  /**
   * Handles the {name} after \begin or \end. The command runs from `commandStart` to `commandEnd`.
   * If a {name} follows, it pushes the command, the braces and the name (coloured as a type), then
   * returns where it ended and the environment name. Returns undefined when no {name} follows,
   * so the caller treats the command as a normal one.
   */
  const readEnvironmentHead = (commandStart: number, commandEnd: number): { end: number; name: string } | undefined => {
    let j = commandEnd;
    while (source[j] === " " || source[j] === "\t") {
      j++;
    }
    if (source[j] !== "{") {
      return undefined;
    }
    let k = j + 1;
    while (k < n && isEnvNameChar(source[k])) {
      k++;
    }
    if (source[k] !== "}" || k === j + 1) {
      return undefined;
    }
    push("keyword", commandStart, commandEnd);
    push("plain", commandEnd, j + 1);
    push("type", j + 1, k);
    push("plain", k, k + 1);
    return { end: k + 1, name: source.slice(j + 1, k) };
  };

  while (i < n) {
    const ch = source[i]!;

    // A comment runs to the end of the line.
    if (ch === "%") {
      const nl = source.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      push("comment", i, end);
      i = end;
      continue;
    }

    if (ch === "\\") {
      const next = source[i + 1];

      // A command: backslash, then letters (an @ counts as a letter).
      if (isLetter(next) || next === "@") {
        let j = i + 2;
        while (isLetter(source[j]) || source[j] === "@") {
          j++;
        }
        const name = source.slice(i + 1, j);

        // \begin{name} and \end{name}.
        if (name === "begin" || name === "end") {
          const head = readEnvironmentHead(i, j);
          if (head) {
            i = head.end;
            if (name === "begin" && VERBATIM_ENVIRONMENTS.has(head.name)) {
              // Copy everything up to the matching \end{name} as plain text. The \end itself is read normally.
              const endPattern = new RegExp(`\\\\end[ \\t]*\\{${head.name.replace(/[*]/g, "\\*")}\\}`, "g");
              endPattern.lastIndex = i;
              const found = endPattern.exec(source);
              const bodyEnd = found ? found.index : n;
              push("plain", i, bodyEnd);
              i = bodyEnd;
            }
            continue;
          }
        }

        // \verb|text| and \verb*|text|: the text between the two delimiters is plain.
        if (name === "verb") {
          let k = j;
          if (source[k] === "*") {
            k++;
          }
          const delimiter = source[k];
          if (delimiter !== undefined && delimiter !== "\n" && delimiter !== " " && delimiter !== "\t") {
            const close = source.indexOf(delimiter, k + 1);
            const nl = source.indexOf("\n", k + 1);
            if (close !== -1 && (nl === -1 || close < nl)) {
              push("keyword", i, k);
              push("plain", k, close + 1);
              i = close + 1;
              continue;
            }
          }
        }

        push("keyword", i, j);
        i = j;
        continue;
      }

      // The end of the file, or a backslash at the end of a line: just the backslash.
      if (next === undefined || next === "\n") {
        push("keyword", i, i + 1);
        i += 1;
        continue;
      }

      // \( and \[ open math.
      if (next === "(" || next === "[") {
        i = readMath(i, 2, next === "(" ? "\\)" : "\\]");
        continue;
      }

      // Any other control symbol (\\, \{, \$, \%, \&, \,) is one token.
      const length = 1 + charLength(source, i + 1);
      push("keyword", i, i + length);
      i += length;
      continue;
    }

    // $...$ and $$...$$.
    if (ch === "$") {
      i = source[i + 1] === "$" ? readMath(i, 2, "$$") : readMath(i, 1, "$");
      continue;
    }

    // A macro parameter (#1, ##1) is plain, so its digit is not coloured as a number.
    if (ch === "#") {
      let j = i + 1;
      while (source[j] === "#") {
        j++;
      }
      if (isDigit(source[j])) {
        j++;
      }
      push("plain", i, j);
      i = j;
      continue;
    }

    // A word is plain, including any digits inside it (fig1, table2), so those are not numbers.
    if (isLetter(ch)) {
      let j = i + 1;
      while (isLetter(source[j]) || isDigit(source[j])) {
        j++;
      }
      push("plain", i, j);
      i = j;
      continue;
    }

    // A number: 12, 0.5, .5, with an optional unit right after it.
    if (isDigit(ch) || (ch === "." && isDigit(source[i + 1]))) {
      let j = i;
      while (isDigit(source[j])) {
        j++;
      }
      if (source[j] === "." && isDigit(source[j + 1])) {
        j++;
        while (isDigit(source[j])) {
          j++;
        }
      }
      let unitEnd = j;
      while (isLetter(source[unitEnd])) {
        unitEnd++;
      }
      if (unitEnd > j && UNITS.has(source.slice(j, unitEnd))) {
        j = unitEnd;
      }
      push("number", i, j);
      i = j;
      continue;
    }

    // Anything else (spaces, brackets, braces, & and ~, punctuation) is plain, one character at a time.
    const length = charLength(source, i);
    push("plain", i, i + length);
    i += length;
  }

  return builder.lines();
}
