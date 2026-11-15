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

/** The same line structure without colours, used when syntax highlighting is off. */
export function plainLines(source: string): TokenLine[] {
  return source.split("\n").map((line) => (line ? [{ kind: "plain" as const, text: line }] : []));
}
