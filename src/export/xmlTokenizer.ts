// A small tokenizer for XML syntax colouring (.xml, .xsd, .xsl and .xslt).
// Like the other tokenizers, it labels pieces of code without changing a
// single character: joining every token's text gives back the original. It is
// pattern-based, not a full parser, and it never checks that tags match.
//
// XML reuses the shared colours like this (the same scheme as HTML):
//   keyword       tag names (book, xs:element in <book> and </book>)
//   type          attribute names (id, xmlns:xsi)
//   string        attribute values ("main" or 'main'), and the text inside <![CDATA[ ... ]]>
//   preprocessor  <?xml ... ?> and other <? ?> lines, <!DOCTYPE ...>, <!ELEMENT ...>
//                 and friends, and the <![CDATA[ and ]]> markers themselves
//   number        character and entity references (&amp; &#160; &#x20;)
//   comment       <!-- comments -->, which can run over several lines
//   plain         text between tags, and the < > / = around the names
//
// Things worth knowing:
//   - A "<" only starts a tag when a name follows it, so `a < b` in text is just text.
//   - A ">" in text, or inside an attribute value, never ends anything by itself.
//   - A DOCTYPE can hold an inner list of declarations in [ ... ]. Inside it,
//     each <!ELEMENT ...> is coloured on its own, and the final ]> is preprocessor.
//   - A tag that is missing its ">" ends where the next "<" starts, so one typo
//     can't swallow the rest of the file.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/**
 * A quoted value can run over lines, but a stray quote must not colour the whole
 * rest of the file. If no closing quote shows up within this many lines, the
 * quote is cut off at the end of its own line (in a tag) or counts as a normal
 * character (inside a <!DOCTYPE ...> or <!ELEMENT ...> line).
 */
const MAX_QUOTED_LINES = 100;

/** A reference like &name; or &#123; or &#x7B;. The "y" flag makes it match only at lastIndex. */
const REFERENCE = /&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z_:][A-Za-z0-9._:-]*);/y;

function isSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/** What a tag or attribute name may start with: a letter, "_", ":" or any non-ASCII character. */
function isNameStart(ch: string | undefined): boolean {
  return ch !== undefined && (/[A-Za-z_:]/.test(ch) || ch.charCodeAt(0) > 127);
}

/** Where a tag name stops: at a space, "/", ">" or the "<" of the next tag (and "=" for attribute names). */
function endsName(ch: string | undefined, isAttribute: boolean): boolean {
  return ch === undefined || isSpace(ch) || ch === "/" || ch === ">" || ch === "<" || (isAttribute && ch === "=");
}

/**
 * Splits XML source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first), though a stray "\r" is only plain text.
 */
export function tokenizeXml(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;

  /** True while we are inside the [ ... ] part of a <!DOCTYPE ...>. */
  let inSubset = false;

  /** Where the line that holds position i ends (before its "\n", and before a "\r" in front of it). */
  const endOfLine = (i: number): number => {
    const newline = source.indexOf("\n", i);
    const end = newline === -1 ? n : newline;
    return end > i && source[end - 1] === "\r" ? end - 1 : end;
  };

  /**
   * Where the quote that starts just before `from` closes, or -1 if it doesn't
   * within MAX_QUOTED_LINES lines. It looks at one line at a time, so a file full
   * of stray quotes stays fast.
   */
  const findClosingQuote = (quote: string, from: number): number => {
    let lines = 0;
    for (let k = from; k < n; k++) {
      const ch = source[k];
      if (ch === quote) {
        return k;
      }
      if (ch === "\n" && ++lines > MAX_QUOTED_LINES) {
        return -1;
      }
    }
    return -1;
  };

  /** Colours text between tags: plain, except references like &amp;. */
  const pushText = (start: number, end: number): void => {
    let i = start;
    while (i < end) {
      if (source[i] === "&") {
        REFERENCE.lastIndex = i;
        const match = REFERENCE.exec(source);
        if (match && i + match[0].length <= end) {
          push("number", i, i + match[0].length);
          i += match[0].length;
          continue;
        }
      }
      let j = i + 1;
      while (j < end && source[j] !== "&") {
        j++;
      }
      push("plain", i, j);
      i = j;
    }
  };

  /**
   * Colours a <! declaration (<!DOCTYPE, <!ELEMENT, <!ATTLIST, <!ENTITY) that starts at i
   * and returns where it ends. It ends at the first ">" that is not inside quotes. A
   * DOCTYPE also ends at its "[", which opens the inner list of declarations.
   */
  const declaration = (i: number): number => {
    const isDoctype = source.slice(i, i + 9).toUpperCase() === "<!DOCTYPE";
    let k = i + 2;
    while (k < n) {
      const ch = source[k];
      if (ch === '"' || ch === "'") {
        const close = findClosingQuote(ch, k + 1);
        k = close === -1 ? k + 1 : close + 1; // a quote with no end is just a character
        continue;
      }
      if (ch === ">") {
        push("preprocessor", i, k + 1);
        return k + 1;
      }
      if (ch === "[" && isDoctype) {
        inSubset = true;
        push("preprocessor", i, k + 1);
        return k + 1;
      }
      if (ch === "<") {
        break; // the next tag starts here, so this declaration is missing its ">"
      }
      k++;
    }
    // Missing ">": stop at the end of the line (or at the "<" that interrupted it).
    const stop = k < n ? k : endOfLine(i);
    push("preprocessor", i, stop);
    return stop;
  };

  /** Colours the tag that starts with the "<" at i (its name starts at nameStart) and returns where it ends. */
  const tag = (i: number, nameStart: number): number => {
    let j = nameStart;
    while (!endsName(source[j], false)) {
      j++;
    }
    push("plain", i, nameStart); // "<" or "</"
    push("keyword", nameStart, j);

    // Attributes, up to the ">".
    while (j < n) {
      const ch = source[j];
      if (ch === ">") {
        push("plain", j, j + 1);
        return j + 1;
      }
      if (ch === "<") {
        return j; // a new tag starts, so this one is missing its ">"
      }
      if (isSpace(ch) || ch === "/" || ch === "=") {
        push("plain", j, j + 1);
        j++;
        continue;
      }
      let nameStop = j + 1;
      while (!endsName(source[nameStop], true)) {
        nameStop++;
      }
      push("type", j, nameStop);
      j = nameStop;

      // An optional = and value. Without one, the next round handles what follows.
      let valueStart = j;
      while (isSpace(source[valueStart])) {
        valueStart++;
      }
      if (source[valueStart] !== "=") {
        continue;
      }
      valueStart++;
      while (isSpace(source[valueStart])) {
        valueStart++;
      }
      push("plain", j, valueStart);
      j = valueStart;

      const quote = source[j];
      if (quote === '"' || quote === "'") {
        const close = findClosingQuote(quote, j + 1);
        if (close === -1) {
          // A quote that never closes stops at the end of its line, and the next line is read as normal XML.
          const stop = endOfLine(j);
          push("string", j, stop);
          return stop;
        }
        push("string", j, close + 1);
        j = close + 1;
        continue;
      }
      // An unquoted value is not valid XML, but colour it as a string up to the next space or tag end.
      let valueEnd = j;
      while (valueEnd < n && !isSpace(source[valueEnd]) && source[valueEnd] !== ">" && source[valueEnd] !== "<" && !source.startsWith("/>", valueEnd)) {
        valueEnd++;
      }
      push("string", j, valueEnd);
      j = valueEnd;
    }
    return j;
  };

  let i = 0;
  while (i < n) {
    const ch = source[i];
    if (ch === "<") {
      if (source.startsWith("<!--", i)) {
        const close = source.indexOf("-->", i + 4);
        const stop = close === -1 ? n : close + 3; // a comment with no end runs to the end of the file
        push("comment", i, stop);
        i = stop;
        continue;
      }
      if (source.startsWith("<![CDATA[", i)) {
        const contentStart = i + 9;
        const close = source.indexOf("]]>", contentStart);
        const contentEnd = close === -1 ? n : close;
        push("preprocessor", i, contentStart);
        push("string", contentStart, contentEnd);
        if (close !== -1) {
          push("preprocessor", close, close + 3);
        }
        i = close === -1 ? n : close + 3;
        continue;
      }
      if (source[i + 1] === "?") {
        const close = source.indexOf("?>", i + 2);
        const stop = close === -1 ? endOfLine(i) : close + 2; // with no "?>", only this line
        push("preprocessor", i, stop);
        i = stop;
        continue;
      }
      if (source[i + 1] === "!") {
        i = declaration(i);
        continue;
      }
      const isEndTag = source[i + 1] === "/";
      const nameStart = i + (isEndTag ? 2 : 1);
      if (isNameStart(source[nameStart])) {
        i = tag(i, nameStart);
        continue;
      }
    }
    if (inSubset && ch === "]") {
      // The end of a DOCTYPE's inner list: "]" then optional spaces then ">".
      let k = i + 1;
      while (isSpace(source[k])) {
        k++;
      }
      if (source[k] === ">") {
        push("preprocessor", i, i + 1);
        push("plain", i + 1, k);
        push("preprocessor", k, k + 1);
        inSubset = false;
        i = k + 1;
        continue;
      }
    }
    // Text up to the next "<" (a "<" that doesn't start a tag, as in `a < b`, is text too).
    let j = i + 1;
    while (j < n && source[j] !== "<" && !(inSubset && source[j] === "]")) {
      j++;
    }
    pushText(i, j);
    i = j;
  }

  return builder.lines();
}
