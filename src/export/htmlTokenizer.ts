// A small tokenizer for HTML syntax colouring. Like the other tokenizers, it
// labels pieces of code without changing a single character: joining every
// token's text gives back the original. It is pattern-based, not a full parser.
//
// HTML reuses the shared colours like this:
//   keyword       tag names (html, div, my-widget in <div> and </div>)
//   type          attribute names (class, href, data-id)
//   string        attribute values ("main", 'light', or unquoted like page)
//   preprocessor  <!DOCTYPE html> and other <!...> or <?...?> declarations
//   number        character references (&amp; &#169; &#x1F95E;)
//   comment       <!-- comments -->
//   plain         text between tags, and the < > / = around them
//
// The code inside <style> and a style="..." attribute is coloured by the CSS
// tokenizer. The code inside <script> and event attributes like onclick="..."
// is coloured by the JavaScript tokenizer.

import { tokenizeCss } from "./cssTokenizer";
import { tokenizeJavaScript } from "./javascriptTokenizer";
import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** Elements whose content is raw text: tags and comments inside them don't count, only the matching end tag closes them. */
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea", "title"]);

/**
 * <script type="..."> values whose content is JavaScript (or JSON, which colours the same way).
 * Anything else, like type="text/template", holds something that isn't JavaScript, so it stays plain.
 */
const SCRIPT_TYPES = new Set([
  "", "module", "text/javascript", "application/javascript", "text/ecmascript", "application/ecmascript",
  "application/json", "application/ld+json", "importmap", "speculationrules",
]);

/** Event attributes like onclick and onload, whose values are JavaScript. */
const EVENT_ATTRIBUTE = /^on[a-z]+$/;

/** A character reference: &name; or &#123; or &#x7B;. The "y" flag makes it match only at lastIndex. */
const CHARACTER_REFERENCE = /&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/y;

function isSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

function isAsciiLetter(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z]/.test(ch);
}

/** Where a tag or attribute name stops: at a space, "/", ">" (and "=" for attribute names). */
function endsName(ch: string | undefined, isAttribute: boolean): boolean {
  return ch === undefined || isSpace(ch) || ch === "/" || ch === ">" || (isAttribute && ch === "=");
}

/**
 * Splits HTML source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizeHtml(source: string): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;

  /** Colours source[start..end) with another language's tokenizer (CSS or JavaScript), keeping every character in place. */
  const pushEmbedded = (tokenize: (code: string) => TokenLine[], start: number, end: number): void => {
    let at = start;
    tokenize(source.slice(start, end)).forEach((line, index) => {
      if (index > 0) {
        push("plain", at, at + 1); // the "\n" between two lines
        at++;
      }
      for (const token of line) {
        push(token.kind, at, at + token.text.length);
        at += token.text.length;
      }
    });
  };

  /** Colours text between tags: plain, except character references like &amp;. */
  const pushText = (start: number, end: number): void => {
    let i = start;
    while (i < end) {
      if (source[i] === "&") {
        CHARACTER_REFERENCE.lastIndex = i;
        const match = CHARACTER_REFERENCE.exec(source);
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

  /** Where the raw text of a <name> element that starts at i ends: at its </name> end tag, or the end of the file. */
  const rawTextEnd = (i: number, name: string): number => {
    let at = source.indexOf("</", i);
    while (at !== -1) {
      const after = at + 2 + name.length;
      if (source.slice(at + 2, after).toLowerCase() === name && endsName(source[after], false)) {
        return at;
      }
      at = source.indexOf("</", at + 2);
    }
    return n;
  };

  /** Colours the tag that starts with the "<" at i (its name starts at nameStart) and returns where it ends. */
  const tag = (i: number, nameStart: number, isEndTag: boolean): number => {
    let j = nameStart;
    while (!endsName(source[j], false)) {
      j++;
    }
    push("plain", i, nameStart); // "<" or "</"
    push("keyword", nameStart, j);
    const name = source.slice(nameStart, j).toLowerCase();
    let scriptType: string | undefined; // the type="..." value, if this tag has one

    // Attributes, up to the ">".
    while (j < n && source[j] !== ">") {
      const ch = source[j];
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
      const attribute = source.slice(j, nameStop).toLowerCase();
      j = nameStop;

      // An optional "= value". Without a value (like `hidden`), the next round handles what follows.
      let equals = j;
      while (isSpace(source[equals])) {
        equals++;
      }
      if (source[equals] !== "=") {
        continue;
      }
      let valueStart = equals + 1;
      while (isSpace(source[valueStart])) {
        valueStart++;
      }
      push("plain", j, valueStart);
      j = valueStart;

      const quote = source[j];
      if (quote === '"' || quote === "'") {
        const close = source.indexOf(quote, j + 1);
        // A quote that never closes stops at the end of its line, so one typo can't colour the rest of the file.
        const lineEnd = source.indexOf("\n", j);
        const inside = close !== -1 ? close : lineEnd !== -1 ? lineEnd : n;
        const stop = close !== -1 ? close + 1 : inside;
        if (attribute === "type") {
          scriptType = source.slice(j + 1, inside);
        }
        const embedded = isEndTag ? undefined : attribute === "style" ? tokenizeCss : EVENT_ATTRIBUTE.test(attribute) ? tokenizeJavaScript : undefined;
        if (embedded) {
          push("string", j, j + 1);
          pushEmbedded(embedded, j + 1, inside);
          push("string", inside, stop);
        } else {
          push("string", j, stop);
        }
        j = stop;
        if (close === -1) {
          return j; // treat the tag as over, so the next line is read as normal HTML
        }
        continue;
      }
      let valueEnd = j;
      while (valueEnd < n && !isSpace(source[valueEnd]) && source[valueEnd] !== ">") {
        valueEnd++;
      }
      push("string", j, valueEnd); // an unquoted value like class=page
      if (attribute === "type") {
        scriptType = source.slice(j, valueEnd);
      }
      j = valueEnd;
    }

    if (j < n) {
      push("plain", j, j + 1); // the ">"
      j++;
    }

    if (!isEndTag && RAW_TEXT_ELEMENTS.has(name)) {
      const end = rawTextEnd(j, name);
      if (name === "style") {
        pushEmbedded(tokenizeCss, j, end);
      } else if (name === "script") {
        if (SCRIPT_TYPES.has((scriptType ?? "").trim().toLowerCase())) {
          pushEmbedded(tokenizeJavaScript, j, end);
        } else {
          push("plain", j, end);
        }
      } else {
        pushText(j, end); // <title> and <textarea> still show &amp; and friends
      }
      j = end;
    }
    return j;
  };

  let i = 0;
  while (i < n) {
    if (source[i] === "<") {
      if (source.startsWith("<!--", i)) {
        const close = source.indexOf("-->", i + 2); // from i + 2, so <!--> counts as an empty comment
        const stop = close === -1 ? n : close + 3;
        push("comment", i, stop);
        i = stop;
        continue;
      }
      if (source[i + 1] === "!" || source[i + 1] === "?") {
        const close = source.indexOf(">", i + 2);
        const stop = close === -1 ? n : close + 1;
        push("preprocessor", i, stop);
        i = stop;
        continue;
      }
      const isEndTag = source[i + 1] === "/";
      const nameStart = i + (isEndTag ? 2 : 1);
      if (isAsciiLetter(source[nameStart])) {
        i = tag(i, nameStart, isEndTag);
        continue;
      }
    }
    // Text up to the next "<" (a "<" that doesn't start a tag, as in `a < b`, is text too).
    let j = i + 1;
    while (j < n && source[j] !== "<") {
      j++;
    }
    pushText(i, j);
    i = j;
  }

  return builder.lines();
}
