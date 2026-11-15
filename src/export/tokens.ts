// The shared shape every language's tokenizer produces: lines of labelled
// pieces of code (keyword, string, comment, ...). The renderer only knows
// about these, so adding a language never touches the PDF drawing.

export type TokenKind = "plain" | "keyword" | "type" | "string" | "comment" | "number" | "preprocessor";

export interface Token {
  text: string;
  kind: TokenKind;
}

/** One source line, as a list of tokens (no newline characters inside). */
export type TokenLine = Token[];

/**
 * Collects the tokens a tokenizer finds, then splits them into lines.
 * Tokens are given as ranges of the source, so no character can be changed.
 */
export class TokenBuilder {
  private readonly tokens: Token[] = [];

  constructor(private readonly source: string) {}

  /** Adds source[start..end) as one token. Neighbours of the same kind are merged. */
  push(kind: TokenKind, start: number, end: number): void {
    if (end <= start) {
      return;
    }
    const text = this.source.slice(start, end);
    const last = this.tokens[this.tokens.length - 1];
    if (last && last.kind === kind) {
      last.text += text;
    } else {
      this.tokens.push({ kind, text });
    }
  }

  /** The tokens as lines. A token that spans several lines (a block comment) is split at each newline. */
  lines(): TokenLine[] {
    const lines: TokenLine[] = [[]];
    for (const token of this.tokens) {
      token.text.split("\n").forEach((part, index) => {
        if (index > 0) {
          lines.push([]);
        }
        if (part) {
          lines[lines.length - 1]!.push({ kind: token.kind, text: part });
        }
      });
    }
    return lines;
  }
}

/** The same line structure without colours, used when syntax highlighting is off. */
export function plainLines(source: string): TokenLine[] {
  return source.split("\n").map((line) => (line ? [{ kind: "plain" as const, text: line }] : []));
}
