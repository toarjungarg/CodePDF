// A small tokenizer for JavaScript syntax colouring. Like the other tokenizers,
// it labels pieces of code without changing a single character: joining every
// token's text gives back the original. It is pattern-based, not a full parser.
//
// JavaScript reuses the shared colours like this:
//   keyword       const, function, return, true, null, undefined, ...
//   type          built-in classes and namespaces (Array, Map, Promise, Math, ...)
//   string        '...', "...", `template strings` and /regular expressions/
//   number        42, 3.14, 0xFF, 1_000, 10n
//   comment       // and /* */ comments
//   preprocessor  a #! line at the very top, and @decorators
//   plain         names, operators and punctuation
//
// The two tricky parts:
//   - A "/" can start a regular expression (`/ab+c/g`) or be division (`a / b`).
//     It's a regex when the token before it can't end a value: an operator, "(",
//     ",", the start of the file, or a word like `return`. After a name, a number,
//     ")" or "]" it's division.
//   - In a template string (`Hi ${name}`), the code inside ${...} is coloured as
//     code, and it can hold its own strings and templates.
//
// The same tokenizer also handles TypeScript and React (JSX), switched on by options:
//   - TypeScript adds keywords (interface, enum, type, readonly, as, ...) and
//     colours type names (string, number, Partial, Record, ...) as types. Most of
//     the new keywords are also allowed as ordinary names, so they only count
//     when a name follows them on the same line (`interface Shape` but `let type = 1`).
//   - JSX tags are coloured like HTML: tag names keyword, attribute names type,
//     quoted values string, and the code inside {...} is coloured as code. A "<"
//     starts a tag where a value could start (the same rule as a regex "/").
//     In TypeScript, `<T,>` or `<T extends ...>` is a generic, not a tag.

import { TokenBuilder, type TokenKind, type TokenLine } from "./tokens";

/** Which extra syntax to colour on top of plain JavaScript. */
export interface JavaScriptOptions {
  /** TypeScript (.ts, .tsx): type syntax and the extra keywords. */
  typescript?: boolean;
  /** JSX (.jsx, .tsx): HTML-like tags inside the code. */
  jsx?: boolean;
}

const KEYWORDS = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete",
  "do", "else", "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof",
  "let", "new", "null", "of", "return", "static", "super", "switch", "this", "throw", "true", "try", "typeof",
  "undefined", "var", "void", "while", "with", "yield",
]);

/** Keywords after which a "/" starts a regular expression (as in `return /x/.test(s)`), not division. */
const REGEX_AFTER = new Set([
  "await", "case", "delete", "do", "else", "extends", "in", "instanceof", "new", "of", "return", "throw",
  "typeof", "void", "yield",
]);

/** Words that end an import or export list, so a later `as` isn't coloured as a keyword. */
const IMPORT_ENDERS = new Set(["class", "const", "default", "function", "let", "var"]);

/** Built-in classes and namespaces, coloured as types (unless they follow a dot, as in `obj.Map`). */
const BUILTIN_TYPES = new Set([
  "AggregateError", "Array", "ArrayBuffer", "Atomics", "BigInt", "BigInt64Array", "BigUint64Array", "Boolean",
  "DataView", "Date", "Error", "EvalError", "FinalizationRegistry", "Float32Array", "Float64Array", "Function",
  "Int16Array", "Int32Array", "Int8Array", "Intl", "JSON", "Map", "Math", "Number", "Object", "Promise", "Proxy",
  "RangeError", "ReferenceError", "Reflect", "RegExp", "Set", "SharedArrayBuffer", "String", "Symbol",
  "SyntaxError", "TypeError", "URIError", "Uint16Array", "Uint32Array", "Uint8Array", "Uint8ClampedArray",
  "WeakMap", "WeakRef", "WeakSet",
]);

/**
 * TypeScript keywords that are also allowed as ordinary names. They're only
 * keywords when a name, quote, "{" or "[" follows on the same line, as in
 * `interface Shape`, `x as Shape`, `readonly id` or `import type { A }`.
 */
const TS_CONTEXTUAL_KEYWORDS = new Set([
  "abstract", "as", "asserts", "declare", "enum", "implements", "infer", "interface", "is", "keyof", "module",
  "namespace", "override", "private", "protected", "public", "readonly", "satisfies", "type", "unique",
]);

/** After a TypeScript contextual keyword: what has to follow for it to count (see above). */
const TS_KEYWORD_AFTER = /[ \t]+[\p{L}_$"'{[]/uy;

/** TypeScript's built-in type names, coloured as types (unless they follow a dot). */
const TS_TYPES = new Set([
  "any", "bigint", "boolean", "never", "number", "object", "string", "symbol", "unknown",
  "ArrayLike", "AsyncIterable", "Awaited", "Capitalize", "ConstructorParameters", "Exclude", "Extract",
  "InstanceType", "Iterable", "Iterator", "Lowercase", "NonNullable", "Omit", "Parameters", "Partial", "Pick",
  "PromiseLike", "PropertyKey", "Readonly", "ReadonlyArray", "Record", "Required", "ReturnType", "Uncapitalize",
  "Uppercase",
]);

/** In a .tsx file, what follows `<T` in a generic like `<T,>(x: T) => x` or `<T extends object>`. */
const TSX_GENERIC_AFTER = /[\p{L}\p{N}_$]*[ \t]*(?:,|extends[ \t])/uy;

/** A character reference in JSX text, like &amp; or &#169; (coloured as a number, as in HTML). */
const CHARACTER_REFERENCE = /&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/y;

/** A number: 0xFF, 0b1010, 0o17, 1_000, 3.14e-2, .5, 10n. The "y" flag makes it match only at lastIndex. */
const NUMBER =
  /0[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*n?|0[bB][01](?:_?[01])*n?|0[oO][0-7](?:_?[0-7])*n?|(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?n?/y;

/** After `get` or `set`: a getter or setter name follows (`get total() {`), checked at the end of the word. */
const ACCESSOR_NAME_AFTER = /[ \t]+[\p{L}_$#["']/uy;

/** After `from`: a module name in quotes follows (`from "./util.js"`). */
const MODULE_NAME_AFTER = /[ \t]*["']/y;

/** After `as` in an import or export: a name follows (`* as path`, `{ a as b }`). */
const ALIAS_AFTER = /[ \t]+[\p{L}_$]/uy;

const IDENT_START = /[\p{L}_$]/u;
const IDENT_PART = /[\p{L}\p{N}_$‌‍]/u;

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string | undefined): boolean {
  return ch !== undefined && IDENT_START.test(ch);
}

function isIdentPart(ch: string | undefined): boolean {
  return ch !== undefined && IDENT_PART.test(ch);
}

function isSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\v" || ch === "\f" || ch === " ";
}

function matchesAt(pattern: RegExp, src: string, at: number): boolean {
  pattern.lastIndex = at;
  return pattern.test(src);
}

/** End of the '...' or "..." string whose opening quote is at index i. It stops at an unescaped newline. */
function stringEnd(src: string, i: number): number {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "\\") {
      j += 2; // an escape, including a backslash before a newline (a string continued on the next line)
      continue;
    }
    if (ch === "\n") {
      return j;
    }
    if (ch === quote) {
      return j + 1;
    }
    j++;
  }
  return src.length;
}

/**
 * End of the regular expression whose opening "/" is at index i, flags included,
 * or undefined if it doesn't close on the same line (then the "/" is just a character).
 */
function regexEnd(src: string, i: number): number | undefined {
  let inClass = false; // inside [...], where a "/" doesn't end the regex
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "\\") {
      if (src[j + 1] === "\n") {
        return undefined;
      }
      j += 2;
      continue;
    }
    if (ch === "\n") {
      return undefined;
    }
    if (ch === "[") {
      inClass = true;
    } else if (ch === "]") {
      inClass = false;
    } else if (ch === "/" && !inClass) {
      j++;
      while (j < src.length && isIdentPart(src[j])) {
        j++; // flags like g, i, m
      }
      return j;
    }
    j++;
  }
  return undefined;
}

/**
 * Splits JavaScript (or TypeScript, or JSX, see the options) source into lines of coloured tokens.
 * Expects "\n" line endings (convert "\r\n" first).
 */
export function tokenizeJavaScript(source: string, options: JavaScriptOptions = {}): TokenLine[] {
  const builder = new TokenBuilder(source);
  const push = (kind: TokenKind, start: number, end: number): void => builder.push(kind, start, end);
  const n = source.length;
  const typescript = options.typescript === true;
  const jsx = options.jsx === true;

  let regexAllowed = true; // whether a "/" (or a JSX "<") here would start a regex (or a tag), see the top of the file
  let afterDot = false; // whether the last token was "." or "?.", so the next word is a property name
  let inImport = false; // inside an import or export statement, where `as` is a keyword

  const kindOfWord = (word: string, end: number): TokenKind => {
    if (afterDot) {
      return "plain"; // promise.catch, map.get, obj.default
    }
    if (KEYWORDS.has(word)) {
      return "keyword";
    }
    if (typescript) {
      if (TS_CONTEXTUAL_KEYWORDS.has(word) && matchesAt(TS_KEYWORD_AFTER, source, end)) {
        return "keyword";
      }
      if (TS_TYPES.has(word)) {
        return "type";
      }
    }
    if ((word === "get" || word === "set") && matchesAt(ACCESSOR_NAME_AFTER, source, end)) {
      return "keyword";
    }
    if (word === "from" && matchesAt(MODULE_NAME_AFTER, source, end)) {
      return "keyword";
    }
    if (word === "as" && inImport && matchesAt(ALIAS_AFTER, source, end)) {
      return "keyword";
    }
    return BUILTIN_TYPES.has(word) ? "type" : "plain";
  };

  /** Colours the template string whose opening backtick is at `start`, and returns where it ends. */
  const template = (start: number): number => {
    let textStart = start;
    let j = start + 1;
    while (j < n) {
      const ch = source[j];
      if (ch === "\\") {
        j += 2;
        continue;
      }
      if (ch === "`") {
        push("string", textStart, j + 1);
        return j + 1;
      }
      if (ch === "$" && source[j + 1] === "{") {
        push("string", textStart, j);
        push("plain", j, j + 2);
        regexAllowed = true;
        afterDot = false;
        const close = scan(j + 2, true);
        if (close >= n) {
          return n; // the ${ never closes
        }
        push("plain", close, close + 1);
        j = close + 1;
        textStart = j;
        continue;
      }
      j++;
    }
    push("string", textStart, n); // a template that never closes runs to the end, as it would in JavaScript
    return n;
  };

  /** Whether the "<" at i starts a JSX tag (only called where a value could start). */
  const startsJsxTag = (i: number): boolean => {
    const next = source[i + 1];
    if (next === ">") {
      return true; // a fragment, <>...</>
    }
    if (!isIdentStart(next)) {
      return false;
    }
    return !(typescript && matchesAt(TSX_GENERIC_AFTER, source, i + 2));
  };

  /** End of a JSX tag or attribute name like div, my-widget, Menu.Item or xlink:href that starts at i. */
  const jsxNameEnd = (i: number): number => {
    let j = i;
    while (j < n && (isIdentPart(source[j]) || source[j] === "-" || source[j] === "." || source[j] === ":")) {
      j++;
    }
    return j;
  };

  /** Colours a JSX {...} that opens at i (code, or a spread like {...props}) and returns where it ends. */
  const jsxExpression = (i: number): number => {
    push("plain", i, i + 1);
    regexAllowed = true;
    afterDot = false;
    const close = scan(i + 1, true);
    if (close >= n) {
      return n; // the { never closes
    }
    push("plain", close, close + 1);
    return close + 1;
  };

  /** Colours text between JSX tags: plain, except character references like &amp;. */
  const jsxText = (start: number, end: number): void => {
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

  /**
   * Colours the JSX element whose "<" is at `start`: its tag and attributes, then
   * (unless it ends with "/>") its children up to the matching end tag. Returns where it ends.
   */
  const jsxElement = (start: number): number => {
    const nameEnd = jsxNameEnd(start + 1);
    push("plain", start, start + 1);
    push("keyword", start + 1, nameEnd);
    let j = nameEnd;

    // Attributes, up to ">" or "/>".
    for (;;) {
      if (j >= n) {
        return n;
      }
      const ch = source[j]!;
      if (ch === ">") {
        push("plain", j, j + 1);
        j++;
        break;
      }
      if (ch === "/" && source[j + 1] === ">") {
        push("plain", j, j + 2);
        return j + 2; // self-closing, like <img />
      }
      if (ch === "/" && (source[j + 1] === "/" || source[j + 1] === "*")) {
        // A comment between attributes.
        const close = source[j + 1] === "/" ? source.indexOf("\n", j) : source.indexOf("*/", j + 2);
        const stop = close === -1 ? n : source[j + 1] === "/" ? close : close + 2;
        push("comment", j, stop);
        j = stop;
        continue;
      }
      if (ch === "{") {
        j = jsxExpression(j); // a spread, like {...props}
        continue;
      }
      if (!isIdentStart(ch)) {
        push("plain", j, j + 1); // spaces, "=" and anything unexpected
        j++;
        continue;
      }
      const attributeEnd = jsxNameEnd(j);
      push("type", j, attributeEnd);
      j = attributeEnd;
      let equals = j;
      while (isSpace(source[equals])) {
        equals++;
      }
      if (source[equals] !== "=") {
        continue; // an attribute without a value, like `disabled`
      }
      let valueStart = equals + 1;
      while (isSpace(source[valueStart])) {
        valueStart++;
      }
      push("plain", j, valueStart);
      j = valueStart;
      const quote = source[j];
      if (quote === '"' || quote === "'") {
        // JSX strings have no escapes and may span lines. One that never closes stops at the end of its line.
        const close = source.indexOf(quote, j + 1);
        const lineEnd = source.indexOf("\n", j);
        const stop = close !== -1 ? close + 1 : lineEnd !== -1 ? lineEnd : n;
        push("string", j, stop);
        j = stop;
      } else if (quote === "{") {
        j = jsxExpression(j);
      }
    }

    // Children: text, {code} and nested elements, up to the end tag.
    let textStart = j;
    while (j < n) {
      const ch = source[j];
      if (ch === "{") {
        jsxText(textStart, j);
        j = jsxExpression(j);
        textStart = j;
        continue;
      }
      if (ch === "<" && source[j + 1] === "/") {
        jsxText(textStart, j);
        const endNameEnd = jsxNameEnd(j + 2);
        push("plain", j, j + 2);
        push("keyword", j + 2, endNameEnd);
        const close = source.indexOf(">", endNameEnd);
        const stop = close === -1 ? n : close + 1;
        push("plain", endNameEnd, stop);
        return stop;
      }
      if (ch === "<" && (isIdentStart(source[j + 1]) || source[j + 1] === ">")) {
        jsxText(textStart, j);
        j = jsxElement(j);
        textStart = j;
        continue;
      }
      j++;
    }
    jsxText(textStart, n); // an element that never closes runs to the end
    return n;
  };

  /**
   * Colours code from `start`. Inside a template's ${...} or a JSX {...} (`inSubstitution`),
   * it stops at the "}" that closes it and returns that index; otherwise it runs to the end.
   */
  const scan = (start: number, inSubstitution: boolean): number => {
    let i = start;
    let depth = 0; // how many { are open, so the "}" of an object inside ${...} doesn't end it

    while (i < n) {
      const ch = source[i]!;

      if (isSpace(ch)) {
        let j = i + 1;
        while (j < n && isSpace(source[j])) {
          j++;
        }
        push("plain", i, j);
        i = j;
        continue;
      }

      if (ch === "/" && source[i + 1] === "/") {
        const newline = source.indexOf("\n", i);
        const stop = newline === -1 ? n : newline;
        push("comment", i, stop);
        i = stop;
        continue;
      }

      if (ch === "/" && source[i + 1] === "*") {
        const close = source.indexOf("*/", i + 2);
        const stop = close === -1 ? n : close + 2;
        push("comment", i, stop);
        i = stop;
        continue;
      }

      // A #! line at the very top, as in `#!/usr/bin/env node`.
      if (ch === "#" && i === 0 && source[1] === "!") {
        const newline = source.indexOf("\n");
        const stop = newline === -1 ? n : newline;
        push("preprocessor", 0, stop);
        i = stop;
        continue;
      }

      if (ch === '"' || ch === "'") {
        const stop = stringEnd(source, i);
        push("string", i, stop);
        i = stop;
        regexAllowed = false;
        afterDot = false;
        inImport = false; // the module name ends an import
        continue;
      }

      if (ch === "`") {
        i = template(i);
        regexAllowed = false;
        afterDot = false;
        continue;
      }

      if (ch === "/" && regexAllowed) {
        const stop = regexEnd(source, i);
        if (stop !== undefined) {
          push("string", i, stop);
          i = stop;
          regexAllowed = false;
          afterDot = false;
          continue;
        }
      }

      // A name, or a private class member like #count (always plain, even #delete).
      if (isIdentStart(ch) || (ch === "#" && isIdentStart(source[i + 1]))) {
        let j = i + 1;
        while (j < n && isIdentPart(source[j])) {
          j++;
        }
        const word = source.slice(i, j);
        const kind = ch === "#" ? "plain" : kindOfWord(word, j);
        push(kind, i, j);
        if (!afterDot && (word === "import" || word === "export")) {
          inImport = true;
        } else if (IMPORT_ENDERS.has(word)) {
          inImport = false;
        }
        regexAllowed = kind === "keyword" && REGEX_AFTER.has(word);
        afterDot = false;
        i = j;
        continue;
      }

      if (isDigit(ch) || (ch === "." && isDigit(source[i + 1]))) {
        NUMBER.lastIndex = i;
        const match = NUMBER.exec(source);
        const stop = i + (match ? match[0].length : 1);
        push("number", i, stop);
        i = stop;
        regexAllowed = false;
        afterDot = false;
        continue;
      }

      // A decorator: @name or @name.more, as in `@observable count = 0`.
      if (ch === "@" && isIdentStart(source[i + 1])) {
        let j = i + 1;
        while (j < n && (isIdentPart(source[j]) || (source[j] === "." && isIdentStart(source[j + 1])))) {
          j++;
        }
        push("preprocessor", i, j);
        i = j;
        regexAllowed = false;
        afterDot = false;
        continue;
      }

      // A JSX tag, where a value could start: `return <div>`, `x = <App />`, `cond && <p>`.
      if (jsx && ch === "<" && regexAllowed && startsJsxTag(i)) {
        i = jsxElement(i);
        regexAllowed = false;
        afterDot = false;
        continue;
      }

      // TypeScript's non-null "!" after a value (`user!.name`, `items! / 2`): what follows is still after a value.
      if (typescript && ch === "!" && !regexAllowed && source[i + 1] !== "=") {
        push("plain", i, i + 1);
        i++;
        afterDot = false;
        continue;
      }

      // Operators and punctuation that are more than one character but matter for the rules above.
      if (source.startsWith("...", i)) {
        push("plain", i, i + 3); // spread: the name after it is an ordinary name
        i += 3;
        regexAllowed = true;
        afterDot = false;
        continue;
      }
      if (ch === "?" && source[i + 1] === "." && !isDigit(source[i + 2])) {
        push("plain", i, i + 2); // optional chaining, obj?.name (but `a ?.5 : b` is a ternary)
        i += 2;
        regexAllowed = false;
        afterDot = true;
        continue;
      }
      if ((ch === "+" || ch === "-") && source[i + 1] === ch) {
        push("plain", i, i + 2); // ++ and --, usually after a name (count++), so a "/" next is division
        i += 2;
        regexAllowed = false;
        afterDot = false;
        continue;
      }

      if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        if (inSubstitution && depth === 0) {
          return i;
        }
        depth = Math.max(0, depth - 1);
      } else if (ch === ";" || ch === "(") {
        inImport = false; // the end of the statement, or import("...") called as a function
      }

      // Anything else: one character (or one surrogate pair).
      const codePoint = source.codePointAt(i) ?? 0;
      const length = codePoint > 0xffff ? 2 : 1;
      push("plain", i, i + length);
      i += length;
      afterDot = ch === ".";
      regexAllowed = !(ch === ")" || ch === "]" || ch === "}" || ch === "." || codePoint > 0x7f);
    }
    return n;
  };

  scan(0, false);
  return builder.lines();
}
