// Unit tests for the pieces under the PDF exporter: tokenizer, layout,
// options, file rules and font lookup. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenizeCFamily } from "../src/export/cFamilyTokenizer";
import { tokenizePython } from "../src/export/pythonTokenizer";
import { tokenizeCss } from "../src/export/cssTokenizer";
import { tokenizeHtml } from "../src/export/htmlTokenizer";
import { tokenizeJavaScript } from "../src/export/javascriptTokenizer";
import { tokenizeRust } from "../src/export/rustTokenizer";
import { tokenizeJava } from "../src/export/javaTokenizer";
import { tokenizeCSharp } from "../src/export/csharpTokenizer";
import { tokenizeGo } from "../src/export/goTokenizer";
import { tokenizePhp } from "../src/export/phpTokenizer";
import { tokenizeSql } from "../src/export/sqlTokenizer";
import { tokenizeShell } from "../src/export/shellTokenizer";
import type { TokenKind, TokenLine } from "../src/export/tokens";
import { languageForFile, languageForVscodeId, LANGUAGE_NAMES, LANGUAGE_NAMES_OR } from "../src/export/languages";
import { columnWidth, expandLine, layoutLine } from "../src/export/layout";
import { DEFAULT_OPTIONS, normalizeOptions, pageSize } from "../src/export/options";
import { parseFontFamilyList, resolveFonts } from "../src/export/fonts";
import {
  batchPdfNames, isExcludedFolder, isSupportedSource, pdfNameFor, scanFolder, selectionPdfName, sortForExport,
  type DirEntry,
} from "../src/files";
import { fixture } from "./helpers";

const joinLine = (line: TokenLine): string => line.map((t) => t.text).join("");
const kindOf = (lines: TokenLine[], text: string): TokenKind | undefined => {
  for (const line of lines) {
    for (const token of line) {
      if (token.text.includes(text)) {
        return token.kind;
      }
    }
  }
  return undefined;
};
const tokenizeCpp = (source: string): TokenLine[] => tokenizeCFamily(source, "cpp");
const tokenizeC = (source: string): TokenLine[] => tokenizeCFamily(source, "c");
const tokenizeTs = (source: string): TokenLine[] => tokenizeJavaScript(source, { typescript: true });
const tokenizeJsx = (source: string): TokenLine[] => tokenizeJavaScript(source, { jsx: true });
const tokenizeTsx = (source: string): TokenLine[] => tokenizeJavaScript(source, { typescript: true, jsx: true });
/** Kind of the first token containing `word` as a whole word (plain neighbours get merged into one token). */
const kindOfWord = (lines: TokenLine[], word: string): TokenKind | undefined => {
  const pattern = new RegExp(`(^|[^\\w$])${word.replace(/[$]/g, "\\$")}($|[^\\w$])`);
  return lines.flat().find((token) => pattern.test(token.text))?.kind;
};

test("tokenizer: joining tokens gives back every fixture exactly", () => {
  for (const name of ["basic.cpp", "comments_strings.cpp", "unicode.cpp", "long_lines.cpp", "basic.c", "basic.py", "basic.css", "basic.html", "basic.js", "basic.ts", "basic.jsx", "basic.tsx", "basic.rs", "basic.java", "basic.cs", "basic.go", "basic.php", "basic.sql", "basic.sh"]) {
    const source = fixture(name).replace(/\r\n?/g, "\n");
    for (const lines of [
      tokenizeCpp(source), tokenizeC(source), tokenizePython(source), tokenizeCss(source), tokenizeHtml(source), tokenizeJavaScript(source),
      tokenizeTs(source), tokenizeJsx(source), tokenizeTsx(source), tokenizeRust(source), tokenizeJava(source), tokenizeCSharp(source), tokenizeGo(source), tokenizePhp(source), tokenizeSql(source), tokenizeShell(source),
    ]) {
      assert.equal(lines.map(joinLine).join("\n"), source, `${name} changed during tokenizing`);
    }
  }
});

test("tokenizer: labels comments, strings, numbers, keywords and preprocessor lines", () => {
  const lines = tokenizeCpp(fixture("comments_strings.cpp"));
  assert.equal(kindOf(lines, "// Line comment"), "comment");
  assert.equal(kindOf(lines, "A block comment that spans"), "comment");
  assert.equal(kindOf(lines, "several lines."), "comment");
  assert.equal(kindOf(lines, "#include"), "preprocessor");
  assert.equal(kindOf(lines, '"helpers.h"'), "string");
  assert.equal(kindOf(lines, "// not a comment"), "string", "a // inside a string is not a comment");
  assert.equal(kindOf(lines, "'\\''"), "string");
  assert.equal(kindOf(lines, "second raw line)json\""), "string", "raw strings continue across lines");
  assert.equal(kindOf(lines, 'L"wide string"'), "string");
  assert.equal(kindOf(lines, "1'000'000"), "number", "digit separators stay inside the number");
  assert.equal(kindOf(lines, "3.14e-2"), "number");
  assert.equal(kindOf(lines, "0xFFu"), "number");
  assert.equal(kindOf(lines, "return"), "keyword");
  assert.equal(kindOf(lines, "/* inline block comment */"), "comment");
  assert.equal(kindOf(lines, "// trailing comment"), "comment");

  const basic = tokenizeCpp(fixture("basic.cpp"));
  assert.equal(kindOf(basic, "<iostream>"), "string");
  assert.equal(kindOf(basic, "int"), "keyword");
});

test("tokenizer: unterminated strings and comments don't swallow or lose text", () => {
  const source = 'char* s = "no end\nint x = 1;\n/* never closed\nstill comment';
  const lines = tokenizeCpp(source);
  assert.equal(lines.map(joinLine).join("\n"), source);
  assert.equal(kindOf(lines, "int"), "keyword", "an unclosed string stops at the end of its line");
  assert.equal(kindOf(lines, "still comment"), "comment");
});

test("tokenizer: C uses C's keywords, and C++-only words stay plain", () => {
  const c = tokenizeC(fixture("basic.c"));
  assert.equal(kindOf(c, "<stdio.h>"), "string");
  assert.equal(kindOf(c, '"list.h"'), "string");
  assert.equal(kindOf(c, "#define"), "preprocessor");
  assert.equal(kindOf(c, "/* A tiny linked list"), "comment");
  assert.equal(kindOfWord(c, "typedef"), "keyword");
  assert.equal(kindOfWord(c, "struct"), "keyword");
  assert.equal(kindOfWord(c, "_Bool"), "keyword");
  assert.equal(kindOfWord(c, "_Generic"), "keyword");
  assert.equal(kindOfWord(c, "restrict"), "keyword");
  assert.equal(kindOfWord(c, "size_t"), "type");
  assert.equal(kindOfWord(c, "new"), "plain", "new is an ordinary name in C");
  assert.equal(kindOfWord(c, "class"), "plain", "class is an ordinary name in C");
  assert.equal(kindOf(c, "0x10"), "number");
  assert.equal(kindOf(c, "1e-3"), "number");

  // The same words in C++ are keywords.
  const cpp = tokenizeCpp("class Box { Box* make() { return new Box; } };");
  assert.equal(kindOfWord(cpp, "class"), "keyword");
  assert.equal(kindOfWord(cpp, "new"), "keyword");
  assert.equal(kindOfWord(tokenizeCpp("restrict"), "restrict"), "plain", "restrict isn't a C++ keyword");

  // wchar_t is a keyword in C++ but a header type in C.
  assert.equal(kindOfWord(tokenizeCpp("wchar_t w;"), "wchar_t"), "keyword");
  assert.equal(kindOfWord(tokenizeC("wchar_t w;"), "wchar_t"), "type");

  // C has no raw strings: R"(...)" is the name R followed by an ordinary string.
  const raw = 'const char *s = R"(one\ntwo)";';
  assert.equal(kindOf(tokenizeCpp(raw), "two)"), "string", "C++ raw strings continue across lines");
  assert.notEqual(kindOf(tokenizeC(raw), "two)"), "string", "in C the string ends at the line break");
});

test("tokenizer: CSS selectors, properties, values, at-rules, strings and comments", () => {
  const css = tokenizeCss(fixture("basic.css"));
  assert.equal(kindOf(css, "Styles for a small recipe card page."), "comment");
  assert.equal(kindOf(css, "This comment has a { brace"), "comment", "comments continue across lines");
  assert.equal(kindOf(css, "@import"), "preprocessor");
  assert.equal(kindOf(css, "@media"), "preprocessor");
  assert.equal(kindOf(css, "@keyframes"), "preprocessor");
  assert.equal(kindOf(css, '"theme.css"'), "string");
  assert.equal(kindOf(css, "fonts/serif.css"), "string", "an unquoted url(...) address is a string");
  assert.equal(kindOf(css, "data:image/png;base64,iVBORw0KGgo="), "string", "a ; inside url(...) doesn't end the value");
  for (const selector of [":root", "body", ".card", "h2", "#featured", ".title::before", ":hover", "&:hover", "from", "to"]) {
    assert.ok(css.flat().some((t) => t.text === selector && t.kind === "keyword"), selector);
  }
  for (const property of ["--accent", "margin", "font-family", "background", "color", "text-decoration", "opacity"]) {
    assert.ok(css.flat().some((t) => t.text === property && t.kind === "type"), property);
  }
  for (const value of ["#e4572e", "1.5rem", "-2px", "100%", ".5em", "-3deg", "600px", "50%", "0.5"]) {
    assert.ok(css.flat().some((t) => t.text === value && t.kind === "number"), value);
  }
  assert.equal(kindOf(css, "!important"), "keyword");
  assert.equal(kindOf(css, '"Helvetica Neue"'), "string");
  assert.ok(css.flat().some((t) => t.text === "and" && t.kind === "keyword"), "and in a @media condition");
  assert.equal(kindOfWord(css, "sans-serif"), "plain", "ordinary values stay plain");
  assert.equal(kindOfWord(css, "https"), "string", "quoted attribute values are strings");

  // A minus between two values is an operator, not part of the number.
  const calc = tokenizeCss("a { width: calc(100% - 2px); height: 1px-2px; }").flat();
  assert.ok(calc.some((t) => t.text === "2px" && t.kind === "number"), "2px after a spaced minus");
  // A declaration outside any block (a style attribute's contents) is still coloured as one.
  const loose = tokenizeCss("color: red;\npadding: 4px").flat();
  assert.ok(loose.some((t) => t.text === "color" && t.kind === "type"));
  assert.ok(loose.some((t) => t.text === "padding" && t.kind === "type"));
});

test("tokenizer: unterminated CSS comments and strings don't swallow or lose text", () => {
  for (const source of [
    "/* never closed\na { color: red; }",
    'a { content: "no end\n  color: red; }',
    "a { background: url(no-end\n  color: red; }",
    "a { color: red",
    "@media screen and (",
    "a[href",
    "a { margin: - +; } #",
    "\\",
    "",
  ]) {
    assert.equal(tokenizeCss(source).map(joinLine).join("\n"), source, JSON.stringify(source));
  }
  const lines = tokenizeCss('a { content: "no end\n  color: red; }');
  assert.notEqual(kindOf(lines, "color"), "string", "a string stops at the end of its line");
  assert.equal(kindOf(tokenizeCss("/* never closed\na { color: red; }"), "color: red;"), "comment");
});

test("tokenizer: HTML tags, attributes, values, comments, references and the doctype", () => {
  const html = tokenizeHtml(fixture("basic.html"));
  const has = (text: string, kind: TokenKind): boolean => html.flat().some((t) => t.text === text && t.kind === kind);
  assert.equal(kindOf(html, "<!DOCTYPE html>"), "preprocessor");
  assert.equal(kindOf(html, "A small recipe card page."), "comment");
  assert.equal(kindOf(html, "This comment has a <div> tag"), "comment", "comments continue across lines");
  for (const name of ["html", "head", "meta", "recipe-card", "h1", "img", "br", "button"]) {
    assert.ok(has(name, "keyword"), `tag name ${name}`);
  }
  for (const name of ["lang", "charset", "href", "class", "data-theme", "hidden", "alt", "onclick", "disabled"]) {
    assert.ok(has(name, "type"), `attribute name ${name}`);
  }
  for (const value of ['"en"', "page", "'light'", '"images/pancakes.png"']) {
    assert.ok(has(value, "string"), `attribute value ${value}`);
  }
  for (const reference of ["&amp;", "&copy;", "&#169;", "&#x1F95E;", "&frac12;"]) {
    assert.ok(has(reference, "number"), reference);
  }
  assert.equal(kindOf(html, "Pancakes "), "plain", "text inside <title> is plain");
  assert.equal(kindOf(html, "Salt & pepper"), "plain", "a lone & is plain text");
  // CSS inside <style> and in a style="..." attribute.
  assert.ok(has(".card", "keyword"), ".card selector");
  assert.ok(has("padding", "type") && has("font-weight", "type") && has("margin", "type"), "CSS property names");
  assert.ok(has("#e4572e", "number") && has("4px", "number"), "CSS numbers and colours");
  assert.equal(kindOf(html, "a </div> inside a style comment"), "comment", "</div> doesn't end <style>");
  assert.ok(has('"<3"', "string"), "a CSS string inside <style>");
  // JavaScript inside <script> and in an onclick="..." attribute, and a < inside it isn't a tag.
  assert.ok(has("if", "keyword") && has("3", "number"), "JavaScript keyword and number inside <script>");
  assert.ok(has('"<b>Done</b>"', "string"), "a JavaScript string inside <script>");
  assert.ok(!has("b", "keyword"), "no tag inside the script");
  assert.equal(kindOf(html, "flip()"), "plain", "the code inside onclick is JavaScript, not one long string");
});

test("tokenizer: HTML only colours <script> content when it's JavaScript", () => {
  for (const tag of ["<script>", '<script type="module">', "<script type=text/javascript>", "<script type='application/json'>"]) {
    assert.equal(kindOfWord(tokenizeHtml(`${tag}let x = 1;</script>`), "let"), "keyword", tag);
  }
  assert.equal(kindOfWord(tokenizeHtml('<script type="text/template">let x = 1;</script>'), "let"), "plain", "a template script stays plain");
});

test("tokenizer: unfinished HTML doesn't swallow or lose text", () => {
  for (const source of [
    "<!-- never closed\n<p>hi</p>",
    '<a href="no end\n<p>x</p>',
    "<script>never closed <p>",
    "<style>a { color: red",
    '<p style="color: red',
    "<div",
    "<div class=",
    "&amp",
    "a < b and c > d",
    "<",
    "</",
    "<!",
    "<!-->",
    "<p>中文 😀 &nbsp;</p>",
    "",
  ]) {
    assert.equal(tokenizeHtml(source).map(joinLine).join("\n"), source, JSON.stringify(source));
  }
  assert.equal(kindOf(tokenizeHtml("<!-- never closed\n<p>hi</p>"), "<p>hi</p>"), "comment");
  const quote = tokenizeHtml('<a href="no end\n<p>x</p>');
  assert.ok(quote.flat().some((t) => t.text === "p" && t.kind === "keyword"), "an unclosed quote stops at the end of its line");
  assert.ok(!quote.flat().some((t) => t.kind === "type" && t.text.includes("<p")), "and the next line's <p> is a tag, not an attribute");
  assert.equal(kindOfWord(tokenizeHtml("a < b"), "b"), "plain", "a < followed by a space isn't a tag");
  assert.ok(tokenizeHtml("<SCRIPT>x</Script><p>").flat().some((t) => t.text === "p" && t.kind === "keyword"), "end tags match in any case");
  assert.equal(kindOf(tokenizeHtml("<!-->a"), "a"), "plain", "<!--> is an empty comment");
});

test("tokenizer: JavaScript comments, strings, templates, regexes, numbers and keywords", () => {
  const js = tokenizeJavaScript(fixture("basic.js"));
  const has = (text: string, kind: TokenKind): boolean => js.flat().some((t) => t.text === text && t.kind === kind);
  assert.equal(kindOf(js, "#!/usr/bin/env node"), "preprocessor");
  assert.equal(kindOf(js, 'has a "quote" and a /slash/'), "comment");
  assert.equal(kindOf(js, "across lines with a `backtick`"), "comment", "block comments continue across lines");
  for (const word of ["import", "from", "as", "const", "class", "static", "get", "return", "this", "new", "async", "await", "typeof", "export", "default"]) {
    assert.ok(has(word, "keyword"), `keyword ${word}`);
  }
  for (const name of ["Map", "Math"]) {
    assert.ok(has(name, "type"), `built-in ${name}`);
  }
  for (const number of ["4", "2.5e0", ".75", "0x2", "1_000_000n"]) {
    assert.ok(has(number, "number"), `number ${number}`);
  }
  for (const text of ['"node:fs/promises"', "'Pancakes'", "/\\d+ cups?[/a-z]*/gi", "/,/", " eggs`"]) {
    assert.ok(has(text, "string"), `string ${text}`);
  }
  assert.equal(kindOf(js, "amount / SERVINGS /"), "plain", "a / after a name is division, not a regex");
  assert.equal(kindOf(js, ") / ratio"), "plain", "a / after ) is division");
  assert.ok(has("`Serves ", "string") && has(" with ", "string"), "template text is a string");
  assert.ok(js.flat().some((t) => t.kind === "plain" && t.text.includes("card.scale(flour,")), "code inside ${...} is code");
  assert.ok(has("s", "string") && has("on a new line`", "string"), "templates continue across lines");
  assert.equal(kindOfWord(js, "get"), "keyword", "get before a getter name");
  assert.ok(js.flat().some((t) => t.kind === "plain" && t.text.includes("lookup.get(")), "map.get is a property, not a keyword");
  assert.ok(js.flat().some((t) => t.kind === "plain" && t.text.includes(".#steps")), "a private #name is plain");
});

test("tokenizer: unfinished JavaScript doesn't swallow or lose text", () => {
  for (const source of [
    "`never closed ${a",
    "`a ${ {b: 1} } c`",
    '"no end\nlet x = 1;',
    "/* never closed\nlet x = 1;",
    "x = /unclosed\nlet y = 2;",
    "a / b / c",
    "/",
    "`",
    "${",
    "#",
    "#!",
    "@",
    "a?.5:1",
    "中文 😀 / 2",
    "",
  ]) {
    assert.equal(tokenizeJavaScript(source).map(joinLine).join("\n"), source, JSON.stringify(source));
  }
  assert.equal(kindOfWord(tokenizeJavaScript('"no end\nlet x = 1;'), "let"), "keyword", "a string stops at the end of its line");
  assert.equal(kindOfWord(tokenizeJavaScript("x = /unclosed\nlet y = 2;"), "let"), "keyword", "a / that never closes isn't a regex");
  assert.equal(kindOf(tokenizeJavaScript("/* never closed\nlet x = 1;"), "let x"), "comment");
  assert.equal(kindOf(tokenizeJavaScript("a?.5:1"), ".5"), "number", "?. followed by a digit is a ternary");
  assert.equal(kindOfWord(tokenizeJavaScript("let as = 1;"), "as"), "plain", "as outside an import is a name");
  assert.equal(kindOfWord(tokenizeJavaScript("x = { get: 1 }"), "get"), "plain", "get as a property name");
  assert.equal(kindOfWord(tokenizeJavaScript("promise.catch(e)"), "catch"), "plain", "a keyword after a dot is a property");
});

test("tokenizer: TypeScript keywords, types, and words that are only sometimes keywords", () => {
  const ts = tokenizeTs(fixture("basic.ts"));
  const has = (text: string, kind: TokenKind): boolean => ts.flat().some((t) => t.text === text && t.kind === kind);
  const plainHas = (text: string): boolean => ts.flat().some((t) => t.kind === "plain" && t.text.includes(text));
  assert.equal(kindOf(ts, 'says interface and "string"'), "comment");
  for (const word of ["interface", "readonly", "type", "enum", "declare", "abstract", "implements", "private", "protected", "public", "is", "as", "satisfies", "extends", "import", "export"]) {
    assert.ok(has(word, "keyword"), `keyword ${word}`);
  }
  for (const name of ["string", "number", "unknown", "boolean", "object", "Partial", "Record", "Promise", "Symbol", "JSON"]) {
    assert.ok(has(name, "type"), `type ${name}`);
  }
  assert.ok(plainHas(" type = "), "`const type =` is a name");
  assert.ok(plainHas("{ readonly: "), "readonly as a property name");
  assert.ok(plainHas("type, meal: Meal.Breakfast "), "type as a shorthand property");
  assert.ok(!ts.flat().some((t) => t.kind === "string" && t.text.includes("/ 2")), "a / after a non-null ! is division");
  assert.ok(plainHas(")!.textContent"), "non-null ! before a dot");
  // TypeScript-only colours stay off in plain JavaScript, and .ts files have no JSX.
  assert.equal(kindOfWord(tokenizeJavaScript("let x: string = y as T;"), "string"), "plain");
  assert.equal(kindOfWord(tokenizeJavaScript("interface Shape {}"), "interface"), "plain");
  assert.equal(kindOfWord(tokenizeTs("const x = <Foo>bar;"), "Foo"), "plain", "a type assertion in .ts isn't a tag");
});

test("tokenizer: JSX tags, attributes, text and {code}", () => {
  const jsx = tokenizeJsx(fixture("basic.jsx"));
  const has = (text: string, kind: TokenKind): boolean => jsx.flat().some((t) => t.text === text && t.kind === kind);
  assert.equal(kindOf(jsx, "has a <div> that is not a tag"), "comment");
  for (const tag of ["article", "h2", "ol", "li", "img", "button"]) {
    assert.ok(has(tag, "keyword"), `tag ${tag}`);
  }
  for (const attribute of ["className", "data-open", "onClick", "key", "title", "src", "alt", "disabled"]) {
    assert.ok(has(attribute, "type"), `attribute ${attribute}`);
  }
  for (const value of ['"card"', "'step'", '"pancake.png"', '"A stack"']) {
    assert.ok(has(value, "string"), `attribute value ${value}`);
  }
  assert.ok(has("&amp;", "number"), "character reference in JSX text");
  assert.equal(kindOf(jsx, "A comment inside JSX"), "comment");
  assert.equal(kindOf(jsx, "Don't skip step "), "plain", "an apostrophe in JSX text doesn't start a string");
  assert.ok(has("1", "number") && has("false", "keyword"), "code inside {...} and in the component is coloured");
  assert.equal(kindOf(jsx, "length < "), "plain", "a < after a name is less-than, not a tag");
  assert.ok(!jsx.flat().some((t) => t.kind === "string" && t.text.includes("/ 2")), "a / after a name is still division");
  assert.equal(kindOfWord(tokenizeJavaScript("x = <div>"), "div"), "plain", "plain .js files have no JSX");
});

test("tokenizer: TSX tells generics apart from tags", () => {
  const tsx = tokenizeTsx(fixture("basic.tsx"));
  const has = (text: string, kind: TokenKind): boolean => tsx.flat().some((t) => t.text === text && t.kind === kind);
  assert.equal(kindOf(tsx, "The <T> in this comment"), "comment");
  assert.equal(kindOf(tsx, "<T,>(value"), "plain", "<T,> is a generic");
  assert.ok(!has("T", "keyword"), "no generic T is coloured as a tag");
  assert.ok(has("extends", "keyword") && has("object", "type"), "<T extends object> is a generic");
  assert.ok(!has("number", "keyword") && has("number", "type"), "useState<number> isn't a tag");
  for (const tag of ["Menu.Group", "li", "button"]) {
    assert.ok(has(tag, "keyword"), `tag ${tag}`);
  }
  assert.ok(has("label", "type") && has('"Recipes"', "string") && has("&gt;", "number"));
  for (const word of ["interface", "readonly", "as", "type"]) {
    assert.ok(has(word, "keyword"), `keyword ${word}`);
  }
  assert.ok(!tsx.flat().some((t) => t.kind === "string" && t.text.includes("/ 2")), "a / after a non-null ! is division");
});

test("tokenizer: unfinished JSX and TypeScript don't swallow or lose text", () => {
  for (const source of [
    "<", "<>", "</", "<div", "<div ", '<div a="x', "<div a=", "<div a={", "<div>{a", "<div>text", "<a><b>", "<div /",
    "<div // note", "<div /* note", "x = <div className={`${a}`}>", "<T,", "<T extends", "a < b", "</div>", "<>{</>",
    "x!", "!", "type", "interface", "a as", "中文 <b>😀</b>", "",
  ]) {
    for (const tokenize of [tokenizeJsx, tokenizeTsx, tokenizeTs]) {
      assert.equal(tokenize(source).map(joinLine).join("\n"), source, JSON.stringify(source));
    }
  }
  assert.equal(kindOfWord(tokenizeTsx("x = <T,>() => 1;\nlet y = 2;"), "let"), "keyword", "code after a generic is code");
});

test("tokenizer: Rust chars vs lifetimes, raw strings, nested comments, macros and attributes", () => {
  const rs = tokenizeRust(fixture("basic.rs"));
  const has = (text: string, kind: TokenKind): boolean => rs.flat().some((t) => t.text === text && t.kind === kind);
  assert.equal(kindOf(rs, 'says fn and "String"'), "comment");
  assert.equal(kindOf(rs, "Inner doc comment"), "comment");
  assert.equal(kindOf(rs, "still a comment after the inner close"), "comment", "block comments nest");
  for (const word of ["use", "pub", "struct", "enum", "const", "impl", "fn", "Self", "self", "let", "mut", "for", "in", "if", "else", "break"]) {
    assert.ok(has(word, "keyword"), `keyword ${word}`);
  }
  for (const name of ["f32", "u32", "u8", "usize", "str", "String", "Vec", "HashMap", "Option", "Some", "None"]) {
    assert.ok(has(name, "type"), `type ${name}`);
  }
  for (const lifetime of ["'a", "'static", "'_", "'outer"]) {
    assert.ok(has(lifetime, "keyword"), `lifetime or label ${lifetime}`);
  }
  for (const char of ["'\\''", "'a'", "'\\t'", "'😀'"]) {
    assert.ok(has(char, "string"), `char ${char}`);
  }
  assert.ok(has('r#"He said "two cups" and left"#', "string"), "raw string with quotes inside");
  assert.ok(has('r"C:\\recipes\\pancakes"', "string"), "raw string ends at the first quote, backslashes and all");
  assert.ok(has('b"flour"', "string"), "byte string");
  assert.equal(kindOf(rs, "spans two lines"), "string", "strings can span lines");
  assert.equal(kindOf(rs, "r#match = "), "plain", "a raw identifier is a name");
  for (const macro of ["write!", "println!", "vec!"]) {
    assert.ok(has(macro, "preprocessor"), `macro ${macro}`);
  }
  assert.ok(has("#[derive(Debug, Clone, PartialEq)]", "preprocessor") && has("#[allow(dead_code)]", "preprocessor"));
  for (const number of ["1_000", "0xFF", "0b1010", "2.5f32", "2.", "0.0", "1", "10"]) {
    assert.ok(has(number, "number"), `number ${number}`);
  }
  assert.ok(!has("1..10", "number"), "a range isn't one number");
  assert.equal(kindOf(rs, " != "), "plain", "!= after a name isn't a macro");
  assert.equal(kindOfWord(tokenizeRust("x.0.max(1)"), "max"), "plain", "a method on a number isn't part of it");
  assert.equal(kindOfWord(tokenizeRust("let b = b'x';"), "b'x'"), "string", "byte char");
  assert.equal(kindOfWord(tokenizeRust("#![no_std]\nfn f() {}"), "fn"), "keyword", "an inner attribute isn't a script line");
});

test("tokenizer: unfinished Rust doesn't swallow or lose text", () => {
  for (const source of [
    "'", "'a", "'\\", "'\\'", "b'", "r#", "r#\"", 'r##"x"#', "r", "br", "c\"x", '"no end', "/*", "/* /* */", "#[", "#![x",
    "#!/usr/bin/env run-cargo-script\nfn main() {}", "x!", "x!=", "0x", "1e", "1e+", "1.", "1..", "中文 '中' 😀", "",
  ]) {
    assert.equal(tokenizeRust(source).map(joinLine).join("\n"), source, JSON.stringify(source));
  }
  assert.equal(kindOfWord(tokenizeRust("/* a /* b */ c */ let x = 1;"), "let"), "keyword", "code after a nested comment is code");
  assert.equal(kindOfWord(tokenizeRust('let s = r#"a " b"#;\nlet y = 2;'), "y"), "plain", "code after a raw string is code");
});

test("tokenizer: Java annotations, text blocks, contextual keywords and capitalized types", () => {
  const java = tokenizeJava(fixture("basic.java"));
  const has = (text: string, kind: TokenKind): boolean => java.flat().some((t) => t.text === text && t.kind === kind);
  assert.equal(kindOf(java, 'This Javadoc says class and "String"'), "comment");
  assert.equal(kindOf(java, "A block comment with"), "comment");
  for (const word of ["package", "import", "public", "class", "private", "static", "final", "int", "long", "interface", "implements", "return", "switch", "case", "default", "new", "for", "if", "instanceof", "void", "char", "extends"]) {
    assert.ok(has(word, "keyword"), `keyword ${word}`);
  }
  for (const word of ["sealed", "permits", "record", "non-sealed", "when", "yield", "var"]) {
    assert.ok(has(word, "keyword"), `contextual keyword ${word}`);
  }
  assert.equal(kindOfWord(tokenizeJava("int var = 3;"), "var"), "plain", "var as a variable name");
  assert.equal(kindOfWord(tokenizeJava("return record;"), "record"), "plain", "record as a variable name");
  for (const name of ["Kitchen", "String", "ArrayList", "List", "Map", "Integer", "Soup", "Cake", "T", "Comparable", "System", "Runnable"]) {
    assert.ok(has(name, "type"), `type ${name}`);
  }
  for (const constant of ["MAX_ITEMS", "MASK", "CUP", "GRAM"]) {
    assert.ok(!has(constant, "type"), `a constant isn't a type: ${constant}`);
  }
  for (const annotation of ["@Override", "@SuppressWarnings", "@java.lang.Deprecated"]) {
    assert.ok(has(annotation, "preprocessor"), `annotation ${annotation}`);
  }
  assert.equal(kindOfWord(tokenizeJava("public @interface Tag {}"), "@interface"), "keyword");
  assert.equal(kindOf(java, 'Mix "two cups" of flour.'), "string", "text block spans lines");
  assert.equal(kindOf(java, 'A tricky line: \\"""'), "string", "an escaped \"\"\" doesn't end a text block");
  for (const literal of ["'\\''", "'\\t'", '"C:\\\\recipes\\\\pancakes"', '"unchecked"']) {
    assert.ok(has(literal, "string"), `string ${literal}`);
  }
  for (const number of ["1_000", "0xFF", "0b1010", "10L", "1e-3", "2.5f", "0", "4", ".5"]) {
    assert.ok(has(number, "number"), `number ${number}`);
  }
  assert.equal(kindOfWord(tokenizeJava("double d = 0x1.8p-3;"), "0x1.8p-3"), "number", "hex float");
  assert.equal(kindOfWord(tokenizeJava("int x = 0xE+1;"), "0xE"), "number", "+ after a hex E isn't an exponent");
});

test("tokenizer: unfinished Java doesn't swallow or lose text", () => {
  for (const source of ['"', "'", '"""', '"""\nno end', '"no end\nint x;', "/*", "/** x", "@", "@x.", "non-", "non-sealed", "0x", "1e", "1e+", "1.", "中文 '中' 😀", ""]) {
    assert.equal(tokenizeJava(source).map(joinLine).join("\n"), source, JSON.stringify(source));
  }
  assert.equal(kindOfWord(tokenizeJava('String s = "no end\nint x = 1;'), "int"), "keyword", "an unclosed string stops at the line end");
  assert.equal(kindOfWord(tokenizeJava('String s = """\n  a\n  """;\nint y = 2;'), "int"), "keyword", "code after a text block is code");
});

test("tokenizer: C# strings, attributes, contextual keywords and types", () => {
  const cs = tokenizeCSharp(fixture("basic.cs"));
  const has = (text: string, kind: TokenKind): boolean => cs.flat().some((t) => t.text === text && t.kind === kind);
  assert.equal(kindOf(cs, 'This comment says class and "string"'), "comment");
  assert.equal(kindOf(cs, "A block comment with"), "comment");
  for (const word of ["using", "namespace", "public", "interface", "string", "record", "struct", "enum", "partial", "class", "private", "const", "int", "ulong", "decimal", "get", "init", "set", "readonly", "new", "static", "where", "foreach", "var", "in", "switch", "when", "and", "yield", "async", "await", "from", "orderby", "select", "with", "is", "not", "null", "nameof", "global", "char"]) {
    assert.ok(has(word, "keyword"), `keyword ${word}`);
  }
  assert.equal(kindOfWord(tokenizeCSharp("int var = 3;"), "var"), "plain", "var as a variable name");
  assert.equal(kindOfWord(tokenizeCSharp("foreach (var file in files)"), "file"), "plain", "file as a loop variable");
  assert.equal(kindOfWord(tokenizeCSharp("file class Secret {}"), "file"), "keyword");
  assert.equal(kindOfWord(tokenizeCSharp("x = get;"), "get"), "plain", "get as a variable name");
  assert.equal(kindOfWord(tokenizeCSharp("if (and < 10) {}"), "and"), "plain", "and as a variable name");
  for (const name of ["IDish", "Soup", "Portion", "Unit", "Cookbook", "Dictionary", "T", "List", "IComparable", "IEnumerable", "Task", "Console"]) {
    assert.ok(has(name, "type"), `type ${name}`);
  }
  assert.equal(kindOfWord(tokenizeCSharp("order.Type = Path;"), "Type"), "plain", "a common type name after a dot is a property");
  for (const name of ["Serializable", "Obsolete", "#nullable enable", "#region Helpers", "#endregion", "#if DEBUG", "#endif"]) {
    assert.ok(has(name, "preprocessor"), `preprocessor ${name}`);
  }
  assert.equal(kindOfWord(tokenizeCSharp('[assembly: InternalsVisibleTo("Tests")]'), "assembly"), "keyword", "attribute target");
  assert.equal(kindOfWord(tokenizeCSharp("var d = new Dictionary<string, int>\n{\n    [key] = 1,\n};"), "key"), "plain", "an index isn't an attribute");
  assert.equal(kindOfWord(tokenizeCSharp("int[] numbers = [one, two];"), "one"), "plain", "a collection isn't an attribute");
  for (const literal of ['@"C:\\recipes\\pancakes"', '@"She said ""hi"""', "'\\''", "'\\t'", '"flour"u8', '"Pancakes"']) {
    assert.ok(has(literal, "string"), `string ${literal}`);
  }
  assert.equal(kindOf(cs, '{ "dish": "soup" }'), "string", "raw string spans lines");
  assert.equal(kindOf(cs, "in "), "string", "verbatim interpolated string spans lines");
  const line = tokenizeCSharp('string line = $"{name,-10}: {cups:F1} cups, {{not a hole}}";');
  assert.equal(kindOfWord(line, "name"), "plain", "code inside a hole");
  assert.ok(line.flat().some((t) => t.text === ":F1" && t.kind === "string"), "format inside a hole");
  assert.ok(line.flat().some((t) => t.text.includes("{{not a hole}}") && t.kind === "string"), "{{ is a plain brace");
  const raw = tokenizeCSharp('string raw = $$"""{"name": "{{name}}"}""";');
  assert.ok(raw.flat().some((t) => t.text === "{{name}}" && t.kind === "plain"), "{{...}} is a hole in $$ raw strings");
  assert.ok(raw.flat().some((t) => t.text === '$$"""{"name": "' && t.kind === "string"), "a single { is text in $$ raw strings");
  for (const number of ["1_000", "0xFF", "0b1010", "10L", "10UL", "1e-3", "2.5f", "9.99m", ".5"]) {
    assert.ok(has(number, "number"), `number ${number}`);
  }
  const range = tokenizeCSharp("var r = 1..5;").flat();
  assert.ok(range.some((t) => t.text === "1" && t.kind === "number") && range.some((t) => t.text === "5" && t.kind === "number"), "a range isn't one number");
});

test("tokenizer: unfinished C# doesn't swallow or lose text", () => {
  for (const source of ['"', "'", '"""', '"""\nno end', '"no end\nint x;', "/*", "/// x", "@", '@"', "$", '$"', '$"{', '$"{x', '$$"""{{', '@$"{a}\nb', "#", "#if", "0x", "1e", "1e+", "1.", "1..", "[", "[A", "[A(", "中文 '中' 😀", '"a"u', ""]) {
    assert.equal(tokenizeCSharp(source).map(joinLine).join("\n"), source, JSON.stringify(source));
  }
  assert.equal(kindOfWord(tokenizeCSharp('string s = "no end\nint x = 1;'), "int"), "keyword", "an unclosed string stops at the line end");
  assert.equal(kindOfWord(tokenizeCSharp('string s = """\n  a\n  """;\nint y = 2;'), "int"), "keyword", "code after a raw string is code");
  assert.equal(kindOfWord(tokenizeCSharp('string s = $"{x\nint y = 2;'), "int"), "keyword", "an unclosed hole stops at the line end");
});

test("tokenizer: Go comments, strings, runes, numbers, keywords and built-ins", () => {
  const source = fixture("basic.go");
  const go = tokenizeGo(source);
  const has = (text: string, kind: TokenKind): boolean => go.flat().some((t) => t.text === text && t.kind === kind);
  assert.equal(go.length, source.split("\n").length, "one token line per source line");
  assert.equal(kindOf(go, 'This comment says func and "string"'), "comment");
  assert.equal(kindOf(go, "It does not nest"), "comment");
  assert.equal(kindOf(go, "division is not a comment"), "comment");
  for (const word of ["package", "import", "const", "type", "struct", "interface", "func", "map", "chan", "return", "if", "for", "range", "switch", "case", "default", "fallthrough", "defer", "var", "nil", "iota"]) {
    assert.ok(has(word, "keyword"), `keyword ${word}`);
  }
  for (const word of ["string", "float64", "int", "error", "Unit", "Portion", "Dish", "Shelf"]) {
    assert.ok(has(word, "type"), `type ${word}`);
  }
  for (const word of ["make", "append", "len", "min", "close", "panic"]) {
    assert.ok(has(word, "keyword"), `built-in function ${word}`);
  }
  for (const literal of ["'\\''", "'\\t'", "'\\x41'", "'é'", '"C:\\\\recipes\\\\\\"pancakes\\""', "`C:\\recipes\\pancakes`"]) {
    assert.ok(has(literal, "string"), `string ${literal}`);
  }
  assert.equal(kindOf(go, 'with a "quote" and // not a comment'), "string", "raw string spans lines and holds no comment");
  assert.equal(kindOf(go, "and a backslash"), "string", "last line of the raw string");
  for (const number of ["1_000", "0xFF", "0b1010", "0o755", "0755", "1.5e-3", "0x1p-2", "3i", "1.5i", "10", "0xF0", "0x30"]) {
    assert.ok(has(number, "number"), `number ${number}`);
  }
  assert.equal(kindOfWord(tokenizeGo("max := 3\nx := max"), "max"), "plain", "max as a variable name");
  assert.equal(kindOfWord(tokenizeGo("x := max(1, 2)"), "max"), "keyword", "max called as a built-in");
  assert.equal(kindOfWord(tokenizeGo("func max(a, b int) int {}"), "max"), "plain", "a function named max");
  assert.equal(kindOfWord(tokenizeGo("n := s.len(1)"), "len"), "plain", "a method after a dot");
  assert.equal(kindOfWord(tokenizeGo("n := s.error"), "error"), "plain", "a field after a dot");
  assert.equal(kindOfWord(tokenizeGo("type Meal int\nv := o.Meal"), "Meal"), "type", "a declared type");
  assert.equal(kindOfWord(tokenizeGo("type Meal int\nv := o.Meal").slice(1), "Meal"), "plain", "a field named like a type");
  const group = tokenizeGo("type (\n\tPoint struct {\n\t\tX int\n\t}\n\tGrams int\n)\nvar p Point\nvar g Grams\nq := p.X + X");
  assert.ok(group.flat().some((t) => t.text === "Point" && t.kind === "type"), "a struct declared in a group");
  assert.ok(group.flat().some((t) => t.text === "Grams" && t.kind === "type"), "a type after a multi-line struct in a group");
  assert.equal(kindOfWord(group.slice(2, 3), "X"), "plain", "a field inside a grouped struct isn't a type");
  assert.equal(kindOfWord(group.slice(8), "X"), "plain", "X is plain wherever it's used");
  assert.equal(kindOfWord(tokenizeGo("a := b / c / d"), "c"), "plain", "division is not a comment");
  const division = tokenizeGo("a := b / c // tail");
  assert.equal(kindOf(division, "tail"), "comment");
  assert.equal(kindOf(division, "b / c"), "plain");
  const blocks = tokenizeGo("/* a /* b */ x := 1");
  assert.equal(kindOfWord(blocks, "x"), "plain", "block comments don't nest, so the first */ ends it");
  assert.ok(blocks.flat().some((t) => t.text === "/* a /* b */" && t.kind === "comment"));
  assert.equal(kindOfWord(tokenizeGo("var s = `a\nb`\nvar y = 1"), "y"), "plain", "code after a raw string is code");
  assert.equal(tokenizeGo("s := `a\nb\nc`\nx := 1").length, 4, "a raw string over three lines keeps line numbers");
  const operators = tokenizeGo("v, ok := <-ch\nm &^= 1\nz = a &^ b");
  assert.equal(kindOfWord(operators, "ch"), "plain");
  assert.ok(operators.flat().some((t) => t.text === "1" && t.kind === "number"));
});

test("tokenizer: unfinished Go doesn't swallow or lose text", () => {
  for (const source of ['"', "'", "`", "`no end\nint x", '"no end\nint x := 1', "'\\", '"\\', "/*", "//", "/", "0x", "1e", "1e+", "0x1p", "1.", ".", "..", "...", "中文 '中' 😀", ""]) {
    assert.equal(tokenizeGo(source).map(joinLine).join("\n"), source, JSON.stringify(source));
  }
  assert.equal(kindOfWord(tokenizeGo('s := "no end\nint x = 1'), "int"), "type", "an unclosed string stops at the line end");
  assert.equal(kindOfWord(tokenizeGo("s := 'a\nvar y = 1"), "var"), "keyword", "an unclosed rune stops at the line end");
});

test("tokenizer: PHP tags, comments, strings, heredocs, numbers, keywords and class names", () => {
  const source = fixture("basic.php");
  const php = tokenizePhp(source);
  const has = (text: string, kind: TokenKind): boolean => php.flat().some((t) => t.text === text && t.kind === kind);
  assert.equal(php.length, source.split("\n").length, "one token line per source line");

  // Text outside the tags is plain, even when it looks like code.
  assert.equal(kindOf(php, "<h1 class="), "plain", "html before the first tag");
  assert.equal(kindOf(php, "Pantry page: if else function"), "plain");
  assert.equal(kindOf(php, "Back in HTML with"), "plain", "html after ?>");
  assert.equal(kindOf(php, "Total:"), "plain", "html after a ?> and <?=");
  assert.equal(kindOf(php, "<!DOCTYPE html>"), "plain", "a doctype outside php is plain");
  for (const tag of ["<?php", "<?=", "?>"]) {
    assert.ok(has(tag, "preprocessor"), `tag ${tag}`);
  }

  // Comments.
  assert.equal(kindOf(php, 'This comment says function and "string"'), "comment");
  assert.equal(kindOf(php, "A hash comment with"), "comment");
  assert.equal(kindOf(php, "over two lines."), "comment");
  assert.equal(kindOf(php, "A doc comment for the class below."), "comment");
  assert.equal(kindOf(php, "The next line ends PHP here"), "comment", "the comment before ?>");
  assert.equal(kindOf(php, "and goes back to HTML."), "plain", "the text after ?> in a // comment is html");
  assert.ok(has("#[Attribute(Attribute::TARGET_CLASS)]", "preprocessor"), "an attribute is not a comment");
  assert.equal(kindOf(php, "This file has no closing tag"), "comment");

  // Keywords ignore case.
  for (const word of ["namespace", "use", "declare", "const", "final", "class", "public", "private", "protected", "function", "return", "new", "static", "foreach", "as", "if", "abstract", "implements", "extends", "interface", "enum", "case", "fn", "instanceof", "IF", "ECHO", "ELSEIF", "Print", "NULL", "else", "$this"]) {
    assert.ok(has(word, "keyword"), `keyword ${word}`);
  }
  for (const word of ["int", "string", "Shelf", "Item", "Spice", "Unit", "Labeled", "Countable", "Loggable", "Sortable", "InvalidArgumentException"]) {
    assert.ok(has(word, "type"), `type ${word}`);
  }
  assert.ok(has("App\\Shared\\Labeled", "type"), "a name with namespace parts after use");
  // Plain tokens merge with their neighbours, so these look for the word inside a plain token.
  const plainHas = (text: string): boolean => php.flat().some((t) => t.kind === "plain" && t.text.includes(text));
  assert.ok(plainHas("App\\Pantry"), "the namespace name itself is plain");

  // Variables, member names and constants stay plain.
  for (const word of ["$name", "$$name", "$count", "$items", "$item", "label", "items", "LIMIT", "MAX_ITEMS", "Cup", "from", "make"]) {
    assert.ok(plainHas(word), `plain ${word}`);
  }
  assert.ok(has("class", "keyword"), "Shelf::class");
  assert.equal(kindOfWord(tokenizePhp("<?php $a->class = 1; $b->list = 2; X::DEFAULT;"), "class"), "plain", "a property named like a keyword");
  assert.equal(kindOfWord(tokenizePhp("<?php $b->list = 2;"), "list"), "plain");
  assert.equal(kindOfWord(tokenizePhp("<?php X::DEFAULT;"), "DEFAULT"), "plain", "a constant named like a keyword");
  assert.equal(kindOfWord(tokenizePhp("<?php function list() {}"), "list"), "plain", "a function named like a keyword");
  assert.equal(kindOfWord(tokenizePhp("<?php $this->count = 1;"), "count"), "plain");
  assert.equal(kindOfWord(tokenizePhp("<?php $x = $a?->size;"), "size"), "plain", "after ?->");
  assert.equal(kindOfWord(tokenizePhp("<?php function f() { yield from g(); }"), "from"), "keyword", "yield from");
  assert.equal(kindOfWord(tokenizePhp("<?php $n = from($x);"), "from"), "plain", "a function named from");
  assert.equal(kindOfWord(tokenizePhp("<?php $n = max(1, 2);"), "max"), "plain", "a function call stays plain");
  assert.ok(tokenizePhp("<?php $n = new \\App\\Item();").flat().some((t) => t.text === "\\App\\Item" && t.kind === "type"), "a name with a leading backslash after new");
  assert.equal(kindOfWord(tokenizePhp("<?php class A extends B implements C, D { use T1, T2; }"), "D"), "type", "second name in an implements list");
  assert.equal(kindOfWord(tokenizePhp("<?php class A extends B implements C, D { use T1, T2; }"), "T2"), "type", "second trait");
  assert.equal(kindOfWord(tokenizePhp("<?php $f = function () use ($a, $b) { return Foo::bar; };"), "Foo"), "type", "a name before ::");
  assert.equal(kindOfWord(tokenizePhp("<?php try {} catch (Boom $e) {}"), "Boom"), "type", "a type hint in catch");
  assert.equal(kindOfWord(tokenizePhp("<?php $x = count($a) ? 1 : FOO;"), "FOO"), "plain", "a constant isn't a type");
  assert.equal(kindOfWord(tokenizePhp("<?php function f(): Dish {}"), "Dish"), "type", "a return type");
  assert.equal(kindOfWord(tokenizePhp("<?php function f(?Dish $d, &$e) {}"), "Dish"), "type", "a nullable type hint");

  // Strings: single quotes have two escapes, double quotes show the interpolated parts as plain.
  assert.ok(has("'It\\'s a spice, path C:\\\\pantry\\\\spices and \\n stays two characters'", "string"), "single-quoted string with its two escapes");
  assert.ok(has("'single $name and {$count} stay plain text'", "string"), "no interpolation in single quotes");
  assert.equal(kindOf(php, "Hello "), "string");
  assert.ok(has("$name", "plain"), "$name inside a double-quoted string");
  assert.ok(has("{$count}", "plain"), "{$expr} inside a double-quoted string");
  assert.ok(has('{$shelf->items[0]["x"]}', "plain"), "quotes and brackets inside {$expr}");
  assert.ok(has(" left, cost \\$5 and \\{", "string"), "an escaped $ is not interpolated, and \\{ is not a hole");
  assert.ok(has("}.\"", "string"), "the text after the plain $count");
  assert.ok(has("$item->label", "plain"), "$obj->prop inside a string");
  assert.ok(has(" and a stray { brace and \\\" quote\"", "string"), "a stray { and an escaped quote");
  assert.equal(kindOf(php, "ls -l "), "string", "backtick string");

  // Heredoc and nowdoc, with an indented closing marker.
  assert.equal(kindOf(php, "<<<EOT"), "string");
  assert.equal(kindOf(php, "She said"), "string", "heredoc body holds no comment");
  assert.equal(kindOf(php, "EOTX is not the end."), "string", "a longer word is not the closing marker");
  assert.equal(kindOf(php, "<<<'RAW'"), "string");
  assert.equal(kindOf(php, "Nowdoc keeps $name and {$count} exactly."), "string", "nowdoc has no interpolation");
  assert.equal(kindOf(php, "<<<\"HTML\""), "string");
  assert.equal(kindOf(php, "    HTML"), "string", "indented closing marker");
  assert.equal(kindOfWord(tokenizePhp("<?php $a = <<<X\nbody text\n  X;\n$b = IF;"), "IF"), "keyword", "code after the heredoc is code");
  assert.equal(kindOfWord(tokenizePhp("<?php $a = <<<X\nbody IF\n  X;\n$b = 1;"), "IF"), "string", "a keyword inside the heredoc");

  // Numbers.
  for (const number of ["1_000", "0xFF", "0b1010", "0o755", "0755", "1.5e-3", ".5", "3", "4.25", "2.5E-3", "0x1F", "0"]) {
    assert.ok(has(number, "number"), `number ${number}`);
  }
  assert.ok(has("1", "number") && has("0", "number"));

  // Operators don't confuse anything.
  const arrows = tokenizePhp("<?php $a = $b?->c ?? $d->e; $m = ['k' => 1]; $z = A::B;");
  assert.ok(arrows.flat().some((t) => t.text === "1" && t.kind === "number"));
  assert.equal(tokenizePhp("<?php\n$a = 1 << 3;\n$b = 2 <<< 1;").length, 3, "<<< without a label is not a heredoc");
});

test("tokenizer: PHP modes, tags and edge cases", () => {
  // A file with only HTML has no code at all.
  const html = tokenizePhp("<p>if (x) { return; }</p>\n");
  assert.ok(html.flat().every((t) => t.kind === "plain"), "no php tag, so everything is plain");
  // A tag has to be <?php followed by white space, or <?=.
  assert.equal(kindOfWord(tokenizePhp("<?phpx if\n"), "if"), "plain", "<?phpx is not a tag");
  assert.equal(kindOfWord(tokenizePhp("<?PHP if (1) {}"), "if"), "keyword", "the tag ignores case");
  assert.equal(kindOfWord(tokenizePhp("<?php\nif (1) {}"), "if"), "keyword", "a newline after the tag");
  assert.equal(kindOfWord(tokenizePhp("<?php"), "<?php"), "preprocessor", "a tag at the end of the file");
  assert.equal(kindOfWord(tokenizePhp("<?= $x ?>\nif"), "if"), "plain", "text after ?> is plain");
  // ?> in a comment ends PHP, but not in a block comment or a string.
  const hash = tokenizePhp("<?php # note ?> if (x)\n<?php if (y);");
  assert.equal(kindOfWord(hash.slice(0, 1), "if"), "plain", "?> inside a # comment ends php");
  assert.equal(kindOfWord(hash.slice(1), "if"), "keyword", "a new tag starts php again");
  assert.equal(kindOfWord(tokenizePhp("<?php /* ?> */ if (x);"), "if"), "keyword", "?> in a block comment");
  assert.equal(kindOfWord(tokenizePhp("<?php $s = '?>'; if (x);"), "if"), "keyword", "?> in a string");
  assert.equal(kindOf(tokenizePhp("<?php // a\nif (x);"), "a"), "comment");
  assert.equal(kindOfWord(tokenizePhp("<?php // a\nif (x);"), "if"), "keyword", "a // comment ends at the line end");
  assert.equal(kindOfWord(tokenizePhp("<?php #[A]\nif (x);"), "if"), "keyword");
  assert.equal(kindOfWord(tokenizePhp("<?php #[A(['x', \"]\"])] class B {}"), "class"), "keyword", "brackets inside an attribute's strings");
  // Strings span lines.
  assert.equal(kindOfWord(tokenizePhp("<?php $a = 'one\ntwo\nthree'; if (x);"), "if"), "keyword", "code after a three-line string");
  assert.equal(tokenizePhp("<?php $a = \"one\ntwo\"; $b = 1;").length, 2);
  // Heredoc label forms and a closing marker followed by more code.
  assert.equal(kindOf(tokenizePhp("<?php f(<<<EOT\n  text\n  EOT, 2);"), "text"), "string", "a marker followed by a comma");
  assert.equal(kindOfWord(tokenizePhp("<?php f(<<<EOT\n  text\n  EOT, IF);"), "IF"), "keyword");
  assert.equal(kindOf(tokenizePhp("<?php $a = <<< 'X'\ntext $v\nX;"), "text $v"), "string", "spaces before the nowdoc label");
});

test("tokenizer: unfinished PHP doesn't swallow or lose text", () => {
  for (const source of ["<?php", "<?", "<?=", "?>", "<?php '", "<?php \"", "<?php `", "<?php \"{$a", "<?php \"{$a[\"", "<?php \"$", "<?php \"\\", "<?php '\\", "<?php /*", "<?php //", "<?php #", "<?php #[", "<?php #[A('", "<?php <<<", "<?php <<<EOT", "<?php <<<EOT\nbody", "<?php <<<'EOT'\nbody", "<?php <<<EOT\n$a {$b", "<?php 0x", "<?php 1e", "<?php 1e+", "<?php 1.", "<?php .", "<?php $", "<?php $$", "<?php \\", "<?php \\\\a", "<?php a\\", "中文 <?php '中' 😀", "<?php $😀 = 1;", ""]) {
    assert.equal(tokenizePhp(source).map(joinLine).join("\n"), source, JSON.stringify(source));
  }
  assert.equal(kindOfWord(tokenizePhp("<?php $a = \"{$b\nif (x);"), "if"), "string", "an unclosed { hole doesn't swallow the file, the string runs on");
  assert.equal(tokenizePhp("<?php $a = <<<EOT\nbody\nmore").length, 3, "an unclosed heredoc keeps its lines");
});

test("tokenizer: SQL comments, strings, names, numbers, keywords and types", () => {
  const source = fixture("basic.sql");
  const sql = tokenizeSql(source);
  const has = (text: string, kind: TokenKind): boolean => sql.flat().some((t) => t.text === text && t.kind === kind);
  assert.equal(sql.length, source.split("\n").length, "one token line per source line");

  // Comments: --, block (over two lines, and unclosed at the end) and MySQL #.
  assert.equal(kindOf(sql, "Made-up schema"), "comment");
  assert.equal(kindOf(sql, "The words SELECT and 'quotes' in this comment"), "comment");
  assert.equal(kindOf(sql, "It runs over two lines and mentions DROP TABLE"), "comment");
  assert.equal(kindOf(sql, "a quoted name with a space"), "comment");
  assert.equal(kindOf(sql, "MySQL style comment"), "comment", "# after code");
  assert.equal(kindOf(sql, "A MySQL comment on its own line"), "comment", "# at the start of a line");
  assert.equal(kindOf(sql, "never closed"), "comment", "an unclosed block comment runs to the end");
  assert.equal(kindOf(sql, "SELECT * FROM books;"), "comment", "and takes the last line with it");
  assert.equal(kindOf(sql, "T-SQL bracket name with"), "comment");

  // Strings: '' is a quote inside, -- and /* */ inside a string are not comments.
  assert.ok(has("'Mira O''Hare'", "string"), "doubled quote");
  assert.ok(has("'Sam -- not a comment'", "string"), "-- inside a string");
  assert.ok(has("'Notes on /* not a comment */ Tea'", "string"), "/* */ inside a string");
  assert.ok(has("'The Quiet Shelf'", "string"));
  assert.equal(kindOf(sql, "'It''s open'"), "string", "doubled quote inside a dollar quote");
  assert.ok(has("E'tab\\there'", "string"), "E prefix is part of the string");
  assert.ok(has("N'unicode'", "string"));
  assert.ok(has("X'1F'", "string"));

  // Dollar quotes, with and without a tag, spanning lines. The comment-looking line inside is part of the string.
  assert.ok(sql.flat().some((t) => t.kind === "string" && t.text.startsWith("$$") && t.text.includes("RETURN (SELECT COUNT") === false), "a $$ string starts on its line");
  assert.equal(kindOf(sql, "-- the body is a dollar-quoted string"), "string");
  assert.equal(kindOf(sql, "RETURN (SELECT COUNT(*) FROM books WHERE id = shelf_id);"), "string");
  assert.ok(has("$body$", "string"), "the tagged opening delimiter");
  assert.ok(sql.flat().some((t) => t.kind === "string" && t.text === "$body$"), "tagged string ends on its own line");
  assert.equal(kindOfWord(sql, "plpgsql"), "plain", "text after the closing $$ is code again");
  assert.equal(kindOfWord(sql, "LANGUAGE"), "keyword", "keyword after the closing $$");

  // Names in quotes are plain, even when they look like comments or keywords.
  assert.equal(kindOf(sql, '"pen name"'), "plain");
  assert.equal(kindOf(sql, '"Author -- Name"'), "plain", "-- inside a quoted name");
  assert.equal(kindOf(sql, "`region`"), "plain");
  assert.equal(kindOf(sql, "[odd name]"), "plain");

  // Parameters and variables are plain.
  assert.equal(kindOfWord(sql, "$1"), "plain", "$1 is a parameter");
  assert.equal(kindOfWord(sql, ":since"), "plain");
  assert.equal(kindOfWord(sql, "@count"), "plain");
  assert.equal(kindOfWord(sql, "@@ROWCOUNT"), "plain");
  assert.equal(kindOfWord(sql, "#temp_books"), "plain", "a T-SQL temp table is not a comment");

  // Numbers.
  for (const num of ["12.50", ".5", "5e0", "0x1F", "1.13", "0.9", "9.99", "14.00", "6", "2"]) {
    assert.ok(has(num, "number"), `number ${num}`);
  }

  // Keywords ignore case. Types get the type colour.
  for (const word of ["CREATE", "TABLE", "PRIMARY", "KEY", "NOT", "NULL", "insert", "Insert", "Into", "values", "Values", "SELECT", "select", "FROM", "INNER", "JOIN", "WHERE", "AND", "ORDER", "BY", "DESC", "LIMIT", "UPDATE", "SET", "DELETE", "WITH", "RECURSIVE", "UNION", "BETWEEN", "RETURNS", "LANGUAGE", "TRUE", "CURRENT_TIMESTAMP", "REFERENCES", "CASCADE", "AUTOINCREMENT", "COUNT", "OVER", "PARTITION", "IS", "IF", "EXISTS", "not"]) {
    assert.ok(sql.flat().some((t) => t.kind === "keyword" && t.text.split(/[^\w$]+/).some((w) => w.toLowerCase() === word.toLowerCase())), `keyword ${word}`);
  }
  for (const word of ["INTEGER", "VARCHAR", "DATE", "TEXT", "CHAR", "SERIAL", "INT", "DECIMAL", "REAL", "BOOLEAN", "TIMESTAMP", "numeric"]) {
    assert.ok(sql.flat().some((t) => t.kind === "type" && t.text === word), `type ${word}`);
  }

  // Ordinary names stay plain, and so does a function name without a bracket after it.
  for (const word of ["authors", "books", "full_name", "author_id", "title", "b", "a", "counter", "shelf_count"]) {
    assert.ok(sql.flat().some((t) => t.kind === "plain" && new RegExp(`(^|[^\\w$])${word}($|[^\\w$])`).test(t.text)), `plain ${word}`);
    assert.ok(!sql.flat().some((t) => t.kind !== "plain" && t.kind !== "comment" && t.kind !== "string" && t.text === word), `${word} is never coloured`);
  }
  assert.ok(has("COUNT", "keyword"), "a function name before a bracket");
});

test("tokenizer: SQL tricky cases", () => {
  // Every token as kind:text, joined with |, and a " // " marks the start of a new line.
  const kinds = (source: string): string => tokenizeSql(source).map((line) => line.map((t) => `${t.kind}:${t.text}`).join("|")).join(" // ");
  // Doubled quotes keep the string going; -- inside a string is not a comment.
  assert.equal(kinds("'a''b' x"), "string:'a''b'|plain: x");
  assert.equal(kindOfWord(tokenizeSql("SELECT 'it''s -- fine', 1 FROM t"), "FROM"), "keyword", "code after a string with -- inside");
  assert.equal(kindOf(tokenizeSql("SELECT 'a -- b'"), "a -- b"), "string");
  assert.equal(kindOf(tokenizeSql("SELECT 'a'-- b"), "-- b"), "comment", "a comment right after a string");
  // A backslash is a normal character in '...' strings, so 'C:\' closes. Only E'..' strings honour backslash escapes.
  assert.equal(kinds("'C:\\' x"), "string:'C:\\'|plain: x");
  assert.equal(kinds("'C:\\temp\\', 'a'"), "string:'C:\\temp\\'|plain:, |string:'a'");
  assert.equal(kinds("E'it\\'s' x"), "string:E'it\\'s'|plain: x", "E'..' keeps \\' inside the string");
  assert.equal(kinds("e'a\\\\' x"), "string:e'a\\\\'|plain: x", "a lower-case e works too, and \\\\ is one escape");
  assert.equal(kinds("'it\\'s' x"), "string:'it\\'|plain:s|string:' x", "in a plain string \\' ends the string (use '' instead)");
  // Dollar quotes: bare, tagged, spanning lines, a different tag inside, and $1 is not one.
  assert.equal(kinds("$$a$$ x"), "string:$$a$$|plain: x");
  assert.equal(kinds("$f$ a $$ b $f$ x"), "string:$f$ a $$ b $f$|plain: x", "a $$ inside a $f$ string does not close it");
  assert.equal(kinds("$t$\nSELECT -- hi\n$t$"), "string:$t$ // string:SELECT -- hi // string:$t$", "every line of a dollar string stays a string");
  assert.equal(tokenizeSql("$t$\nSELECT -- hi\n$t$").length, 3, "a dollar string keeps its lines");
  assert.equal(kinds("WHERE id = $1 AND x = $22"), "keyword:WHERE|plain: id = $1 |keyword:AND|plain: x = $22");
  assert.equal(kinds("$$unclosed\nSELECT"), "string:$$unclosed // string:SELECT", "an unclosed dollar quote runs to the end");
  assert.equal(kindOfWord(tokenizeSql("SELECT a$b FROM t"), "a$b"), "plain", "a $ inside a name");
  // Quoted names are plain, and comment marks inside them are text.
  assert.equal(kinds('"a -- b" /* c */'), 'plain:"a -- b" |comment:/* c */');
  assert.equal(kinds("`a -- b` x"), "plain:`a -- b` x");
  assert.equal(kinds("[a -- b] x"), "plain:[a -- b] x");
  assert.equal(kinds('"say ""hi"" -- ok" x'), 'plain:"say ""hi"" -- ok" x', "doubled quote in a quoted name");
  assert.equal(kinds("[a]]b] x"), "plain:[a]]b] x", "]] inside a bracket name");
  assert.equal(kindOfWord(tokenizeSql('SELECT "select" FROM t'), "select"), "plain", "a keyword in quotes is a name");
  assert.equal(kindOfWord(tokenizeSql("SELECT ARRAY['a','b'] FROM t"), "FROM"), "keyword", "an array literal is not a bracket name");
  assert.equal(kindOf(tokenizeSql("SELECT ARRAY['a','b']"), "'a'"), "string");
  assert.equal(kindOfWord(tokenizeSql("SELECT x[1] -- c\nFROM t"), "FROM"), "keyword", "a subscript is not a bracket name");
  // An unclosed quote mark stays on its own line.
  assert.equal(kindOfWord(tokenizeSql('SELECT "oops\nFROM t'), "FROM"), "keyword", "an unclosed double quote");
  assert.equal(kindOfWord(tokenizeSql("SELECT [oops\nFROM t"), "FROM"), "keyword", "an unclosed bracket");
  // Comments.
  assert.equal(kinds("a -- b\nc"), "plain:a |comment:-- b // plain:c");
  assert.equal(kinds("/* a\nb */ c"), "comment:/* a // comment:b */|plain: c");
  assert.equal(kinds("/* a\nb"), "comment:/* a // comment:b", "an unclosed block comment runs to the end of the file");
  assert.equal(kinds("1 /* a */ / 2"), "number:1|plain: |comment:/* a */|plain: / |number:2", "a lone / is division");
  assert.equal(kinds("# note\nx"), "comment:# note // plain:x");
  assert.equal(kinds("x # note"), "plain:x |comment:# note");
  assert.equal(kinds("x #> y"), "plain:x #> y", "PostgreSQL's #> operator is not a comment");
  assert.equal(kinds("x #>> '{a}'"), "plain:x #>> |string:'{a}'");
  assert.equal(kinds("'a # b'"), "string:'a # b'", "# inside a string");
  assert.equal(kinds('"a # b"'), 'plain:"a # b"', "# inside a quoted name");
  assert.equal(kinds("SELECT * FROM #t"), "keyword:SELECT|plain: * |keyword:FROM|plain: #t", "a T-SQL temp table");
  // Keywords ignore case, and a word after a dot is a column.
  assert.equal(kinds("SELECT select Select sElEcT"), "keyword:SELECT|plain: |keyword:select|plain: |keyword:Select|plain: |keyword:sElEcT");
  assert.equal(kinds("t.order"), "plain:t.order", "a keyword after a dot is a column name");
  assert.equal(kinds("VarChar(5) BIGINT"), "type:VarChar|plain:(|number:5|plain:) |type:BIGINT");
  assert.equal(kinds("a.count max(1) count"), "plain:a.count |keyword:max|plain:(|number:1|plain:) count", "functions only when a bracket follows");
  assert.equal(kinds("MAX (x)"), "keyword:MAX|plain: (x)", "a space before the bracket is fine");
  // Operators stay plain and don't start anything.
  assert.equal(kinds("a::int <> b != c || d"), "plain:a::|type:int|plain: <> b != c || d");
  // Numbers.
  assert.equal(kinds("1.5 .5 1e10 1.5E-3 0x1F 7"), "number:1.5|plain: |number:.5|plain: |number:1e10|plain: |number:1.5E-3|plain: |number:0x1F|plain: |number:7");
  assert.equal(kinds("t1.c2 col3"), "plain:t1.c2 col3", "digits inside names are not numbers");
  assert.equal(kinds("a.5"), "plain:a.|number:5", "after a name, a dot is not part of a number");
  assert.equal(kinds("1e"), "number:1|plain:e", "an exponent needs digits");
  // Unusual text never gets lost or changed.
  for (const source of ["", "'", "''", "'''", "$", "$$", "$a", "$a$", "$a$ b", "\"", "`", "[", "]", "[]", "/*", "/", "-", "--", "#", "##", "#a", "@", "@@", "@@a", "0x", "0xZ", "1e+", ".", "..", "x'", "E'", "中文 'a' 😀", "SELECT 😀 FROM t", "a\r\nb"]) {
    assert.equal(tokenizeSql(source).map(joinLine).join("\n"), source, JSON.stringify(source));
  }
});

test("tokenizer: Shell comments, strings, variables, heredocs, keywords and numbers", () => {
  const source = fixture("basic.sh");
  const sh = tokenizeShell(source);
  const has = (text: string, kind: TokenKind): boolean => sh.flat().some((t) => t.text === text && t.kind === kind);
  assert.equal(sh.length, source.split("\n").length, "one token line per source line");

  // Comments: the shebang, whole-line and after code. Words inside them stay comment text.
  assert.equal(kindOf(sh, "!/bin/bash"), "comment", "the shebang line");
  assert.equal(kindOf(sh, "Made-up backup helper"), "comment");
  assert.equal(kindOf(sh, "The words if then"), "comment");
  assert.equal(kindOf(sh, "the folder to back up"), "comment", "# after code");
  assert.equal(kindOf(sh, "A here-string is not a heredoc."), "comment");

  // A # that is not at the start of a word is not a comment.
  assert.equal(kindOf(sh, 'a#b '), "string", "a#b inside a string");
  assert.ok(has("$#", "type"), "$# is a variable");
  assert.ok(has("${#NOTES_DIR}", "type"), "${#var} is a variable");
  assert.ok(has("${name#note_}", "type"), "${var#prefix} is a variable");
  assert.ok(has("${NOTES_DIR##*/}", "type"), "${var##*/} is a variable");
  assert.equal(kindOfWord(sh, "not"), "plain", "an escaped \\# and \\\" stay plain words");

  // Single quotes have no escapes: a backslash before the closing quote does not stop it.
  assert.ok(has("'ends with a backslash\\'", "string"), "'...\\' closes at the quote");
  assert.ok(has("'Usage: backup.sh [dir]  (no $escapes or \\n in single quotes)'", "string"), "$ and \\n inside single quotes are text");
  // $'...' honours backslashes, so the \' inside does not end it.
  assert.ok(has("$'tab\\there and an escaped \\' quote'", "string"), "an ANSI-C string");

  // Double quotes: escapes, variables, and quotes inside $( ) stay inside the outer string.
  assert.ok(has('"He said \\"hi\\" to ', "string"), "\\\" does not end a double-quoted string");
  assert.ok(has("$USER", "type"), "a variable inside a string");
  assert.ok(has("${HOME}", "type"));
  // stamp="$(echo "run on $(date +%F)")": string, $(, echo, inner string, $(date), string end.
  assert.deepEqual(
    sh[28]!.map((t) => t.kind),
    ["plain", "string", "plain", "keyword", "plain", "string", "plain", "string", "plain", "string"],
    "quotes inside $( ) inside a string",
  );

  // Heredocs: the tag, the body and the terminator are strings. A here-string is not one.
  assert.equal(kindOf(sh, "Backup of "), "string", "heredoc body");
  assert.equal(kindOf(sh, "if then fi # not a comment in here"), "string", "keywords and # inside a heredoc");
  assert.equal(kindOf(sh, "\tQuoted tag: "), "string", "the <<-'END' body");
  assert.equal(kindOf(sh, "\tEND"), "string", "the tab-stripped terminator");
  assert.equal(kindOf(sh, "This heredoc is never closed"), "string", "an unclosed heredoc runs to the end");
  assert.equal(kindOf(sh, 'echo "still inside"'), "string");
  assert.equal(kindOfWord(sh, "wc"), "plain");
  assert.equal(kindOfWord(sh, "echo"), "keyword");

  // Keywords and builtins.
  for (const word of ["set", "if", "then", "elif", "else", "fi", "for", "in", "do", "done", "while", "case", "esac", "local", "shift", "exit", "printf", "read", "continue", "true", "cp"]) {
    const isKeyword = sh.flat().some((t) => t.kind === "keyword" && t.text.split(/[^\w$[\]:]+/).includes(word));
    assert.equal(isKeyword, word !== "cp", `keyword ${word}`);
  }
  assert.ok(has("[[", "keyword") && has("]]", "keyword") && has("[", "keyword"), "test brackets");
  assert.equal(kindOfWord(sh, "usage"), "plain", "function names are plain");

  // Variables: $name, ${...} with a default, $(( )) arithmetic, and a lone $.
  for (const variable of ["$NOTES_DIR", "$file", "$line", "$?", "$$", "$*", "$1", "${1:-./notes}", "$greeting", "$total", "$i"]) {
    assert.ok(sh.flat().some((t) => t.kind === "type" && t.text === variable), `variable ${variable}`);
  }

  // Numbers.
  for (const num of ["0", "1", "2"]) {
    assert.ok(has(num, "number"), `number ${num}`);
  }
  // Plain: names, paths and options are never coloured.
  for (const word of ["NOTES_DIR=", "KEEP=5", "-eu", "summary.txt"]) {
    assert.ok(!sh.flat().some((t) => t.kind !== "plain" && t.text === word), `${word} stays plain`);
  }
});

test("tokenizer: Shell tricky cases", () => {
  // Every token as kind:text, joined with |, and a " // " marks the start of a new line.
  const kinds = (source: string): string => tokenizeShell(source).map((line) => line.map((t) => `${t.kind}:${t.text}`).join("|")).join(" // ");
  // Comments only start at the start of a word.
  assert.equal(kinds("#!/bin/bash\necho hi # c"), "comment:#!/bin/bash // keyword:echo|plain: hi |comment:# c");
  assert.equal(kinds("x # c\nx;# c\nx|#c\n(#c\nx&#c"), "plain:x |comment:# c // plain:x;|comment:# c // plain:x||comment:#c // plain:(|comment:#c // plain:x&|comment:#c");
  assert.equal(kinds("x#y"), "plain:x#y", "a # in the middle of a word");
  assert.equal(kinds("x#y $x#y"), "plain:x#y |type:$x|plain:#y", "a # right after a variable");
  assert.equal(kinds('echo "a"#b'), 'keyword:echo|plain: |string:"a"|plain:#b', "a # right after a quote");
  assert.equal(kinds("echo $# ${#a} ${a#p} ${a##*/} a#b \\# x"), "keyword:echo|plain: |type:$#|plain: |type:${#a}|plain: |type:${a#p}|plain: |type:${a##*/}|plain: a#b \\# x");
  assert.equal(kinds("echo ${a:-{x}} ${b} # c"), "keyword:echo|plain: |type:${a:-{x}}|plain: |type:${b}|plain: |comment:# c", "nested braces");
  assert.equal(kinds("echo \\# \\\" x # c"), "keyword:echo|plain: \\# \\\" x |comment:# c", "escaped # and quote outside quotes");
  assert.equal(kinds("echo \\\\# x"), "keyword:echo|plain: \\\\# x", "an escaped backslash, then a # inside a word");

  // Single quotes: no escapes at all. $'...' honours them.
  assert.equal(kinds("echo 'a\\' x"), "keyword:echo|plain: |string:'a\\'|plain: x", "'a\\' ends at the second quote");
  assert.equal(kinds("echo 'say \"hi\" $x # no' x"), "keyword:echo|plain: |string:'say \"hi\" $x # no'|plain: x");
  assert.equal(kinds("echo $'a\\'b' x"), "keyword:echo|plain: |string:$'a\\'b'|plain: x", "$'..' keeps \\' inside");
  assert.equal(kinds("echo $'a\\\\' x"), "keyword:echo|plain: |string:$'a\\\\'|plain: x", "$'..' with an escaped backslash");
  assert.equal(kinds("echo 'one\ntwo' x"), "keyword:echo|plain: |string:'one // string:two'|plain: x", "strings span lines");

  // Double quotes: escapes, variables and nested quotes.
  assert.equal(kinds('echo "a \\" b" x'), 'keyword:echo|plain: |string:"a \\" b"|plain: x');
  assert.equal(kinds('echo "a $x ${y:-"z"} b" x'), 'keyword:echo|plain: |string:"a |type:$x|string: |type:${y:-"z"}|string: b"|plain: x');
  assert.equal(kinds("echo \"it's\" x"), "keyword:echo|plain: |string:\"it's\"|plain: x", "a single quote inside double quotes");
  assert.equal(kinds('echo "$(echo "hi")" x'), 'keyword:echo|plain: |string:"|plain:$(|keyword:echo|plain: |string:"hi"|plain:)|string:"|plain: x', "nested quotes in $( )");
  assert.equal(kinds('echo "a $(echo "b $(echo "c") d") e" f'), 'keyword:echo|plain: |string:"a |plain:$(|keyword:echo|plain: |string:"b |plain:$(|keyword:echo|plain: |string:"c"|plain:)|string: d"|plain:)|string: e"|plain: f', "$( ) inside $( ) inside a string");
  assert.equal(kinds('echo "a `echo "b"` c" d'), 'keyword:echo|plain: |string:"a |plain:`|keyword:echo|plain: |string:"b"|plain:`|string: c"|plain: d', "backticks inside a string");
  assert.equal(kinds('echo "a)" "b" x'), 'keyword:echo|plain: |string:"a)"|plain: |string:"b"|plain: x', "a ) inside a string");
  assert.equal(kinds('echo "$(echo ")")" x'), 'keyword:echo|plain: |string:"|plain:$(|keyword:echo|plain: |string:")"|plain:)|string:"|plain: x', "a ) in a string inside $( )");
  assert.equal(kinds('echo "unclosed\nstill" # c'), 'keyword:echo|plain: |string:"unclosed // string:still"|plain: |comment:# c', "strings span lines");
  assert.equal(kinds('echo "$" "a$" $'), 'keyword:echo|plain: |string:"$"|plain: |string:"a$"|plain: $', "a lone $");

  // Variables.
  assert.equal(kinds("echo $@ $* $# $? $$ $! $0 $9 $- $_ $_a"), "keyword:echo|plain: |type:$@|plain: |type:$*|plain: |type:$#|plain: |type:$?|plain: |type:$$|plain: |type:$!|plain: |type:$0|plain: |type:$9|plain: |type:$-|plain: |type:$_|plain: |type:$_a");
  assert.equal(kinds("echo ${a[@]} ${!a} ${#a[@]} ${a/x/y}"), "keyword:echo|plain: |type:${a[@]}|plain: |type:${!a}|plain: |type:${#a[@]}|plain: |type:${a/x/y}");
  assert.equal(kinds("echo ${x"), "keyword:echo|plain: ${x", "an unclosed ${ stays plain");

  // Heredocs.
  assert.equal(kinds("cat <<EOF\nif $x\nEOF\necho after"), "plain:cat <<|string:EOF // string:if $x // string:EOF // keyword:echo|plain: after");
  assert.equal(kinds("cat <<-EOF\n\tbody\n\tEOF\nx"), "plain:cat <<-|string:EOF // string:\tbody // string:\tEOF // plain:x", "<<- lets the terminator start with tabs");
  assert.equal(kinds("cat <<EOF\n\tEOF\nEOF\nx"), "plain:cat <<|string:EOF // string:\tEOF // string:EOF // plain:x", "without -, an indented terminator is just text");
  assert.equal(kinds("cat <<EOF\nEOF \nEOF2\nEOF\nx"), "plain:cat <<|string:EOF // string:EOF  // string:EOF2 // string:EOF // plain:x", "the terminator must be the whole line");
  assert.equal(kinds("cat <<'EOF'\n$x\nEOF\nx"), "plain:cat <<|string:'EOF' // string:$x // string:EOF // plain:x", "<<'EOF'");
  assert.equal(kinds('cat <<"EOF"\n$x\nEOF\nx'), 'plain:cat <<|string:"EOF" // string:$x // string:EOF // plain:x', '<<"EOF"');
  assert.equal(kinds("cat <<\\EOF\nb\nEOF\nx"), "plain:cat <<|string:\\EOF // string:b // string:EOF // plain:x", "<<\\EOF");
  assert.equal(kinds("cat <<EOF >out; echo hi\nbody\nEOF\necho x"), "plain:cat <<|string:EOF|plain: >out; |keyword:echo|plain: hi // string:body // string:EOF // keyword:echo|plain: x", "the rest of the command line is still code");
  assert.equal(kinds("cat <<'A' <<\"B\"\n1\nA\n2\nB\nx"), "plain:cat <<|string:'A'|plain: <<|string:\"B\" // string:1 // string:A // string:2 // string:B // plain:x", "two heredocs on one line");
  assert.equal(kinds("echo $(cat <<EOF\nbody\nEOF\n) x"), "keyword:echo|plain: $(cat <<|string:EOF // string:body // string:EOF // plain:) x", "a heredoc inside $( )");
  assert.equal(kinds("cat <<EOF\nunclosed\nmore"), "plain:cat <<|string:EOF // string:unclosed // string:more", "an unclosed heredoc runs to the end");
  assert.equal(tokenizeShell("cat <<EOF\nunclosed\nmore").length, 3, "an unclosed heredoc keeps its lines");
  assert.equal(kinds("cat <<EOF"), "plain:cat <<|string:EOF", "a heredoc with no lines after it");
  assert.equal(kinds('cat <<< "hi" # c'), 'plain:cat <<< |string:"hi"|plain: |comment:# c', "<<< is a here-string");
  assert.equal(kinds("cat <<<$x\nif"), "plain:cat <<<|type:$x // keyword:if", "a here-string does not read a body");
  assert.equal(kinds("x=$(( 1 << 3 ))\necho y"), "plain:x=$(( |number:1|plain: << |number:3|plain: )) // keyword:echo|plain: y", "<< inside $(( )) is a shift");
  assert.equal(kinds("cat << 3\nx"), "plain:cat << |number:3 // plain:x", "<< without a word after it is not a heredoc");

  // Keywords only where a command can start.
  assert.equal(kinds("echo if then"), "keyword:echo|plain: if then");
  assert.equal(kinds("for i in 1 2; do echo $i; done"), "keyword:for|plain: i |keyword:in|plain: |number:1|plain: |number:2|plain:; |keyword:do|plain: |keyword:echo|plain: |type:$i|plain:; |keyword:done");
  assert.equal(kinds("echo in"), "keyword:echo|plain: in", "in is only a keyword in for and case");
  assert.equal(kinds("if ! grep -q x f; then time ls; fi"), "keyword:if|plain: ! grep -q x f; |keyword:then|plain: |keyword:time|plain: ls; |keyword:fi");
  assert.equal(kinds("if [ -f x ] || [[ -d y ]]; then"), "keyword:if|plain: |keyword:[|plain: -f x |keyword:]|plain: || |keyword:[[|plain: -d y |keyword:]]|plain:; |keyword:then");
  assert.equal(kinds("local x=1\nexport Y=2\nreadonly Z\ndeclare -a arr\nreturn 0"), "keyword:local|plain: x=1 // keyword:export|plain: Y=2 // keyword:readonly|plain: Z // keyword:declare|plain: -a arr // keyword:return|plain: |number:0");
  assert.equal(kinds("function f { echo hi; }\nf() { :; }"), "keyword:function|plain: f { |keyword:echo|plain: hi; } // plain:f() { |keyword::|plain:; }", "function definitions");
  assert.equal(kinds("FOO=1 echo $@"), "plain:FOO=1 |keyword:echo|plain: |type:$@", "a command after an assignment");
  assert.equal(kinds("a=(echo b)\nls"), "plain:a=(echo b) // plain:ls", "array values are not commands");
  assert.equal(kinds("(cd x; echo y)\nls"), "plain:(|keyword:cd|plain: x; |keyword:echo|plain: y) // plain:ls", "a subshell");
  assert.equal(kinds("echo `ls` x"), "keyword:echo|plain: `ls` x", "backticks");
  assert.equal(kinds("for ((i = 0; i < 3; i++)); do echo $i; done"), "keyword:for|plain: ((i = |number:0|plain:; i < |number:3|plain:; i++)); |keyword:do|plain: |keyword:echo|plain: |type:$i|plain:; |keyword:done", "a C-style for loop");

  // Numbers.
  assert.equal(kinds("echo 1 2.5 0x1F abc1 1abc -5"), "keyword:echo|plain: |number:1|plain: |number:2.5|plain: |number:0x1F|plain: abc1 1abc -5", "only whole words are numbers");
  assert.equal(kinds("ls 2>&1 >/dev/null"), "plain:ls 2>&1 >/dev/null", "a file number before > is not a number");

  // case patterns and ;; clauses.
  assert.equal(
    kinds("case $x in\n  a|b) echo 1 ;;\n  (c) exit ;;\n  *.txt) : ;;\nesac\necho done"),
    "keyword:case|plain: |type:$x|plain: |keyword:in // plain:  a|b) |keyword:echo|plain: |number:1|plain: ;; // plain:  (c) |keyword:exit|plain: ;; // plain:  *.txt) |keyword::|plain: ;; // keyword:esac // keyword:echo|plain: done",
  );
  assert.equal(kinds("case $x in\n  read) ;;\n  exit|shift) ;;\nesac\nread y"), "keyword:case|plain: |type:$x|plain: |keyword:in // plain:  read) ;; // plain:  exit|shift) ;; // keyword:esac // keyword:read|plain: y", "pattern words are not builtins");
  assert.equal(kinds("case a in a) case b in b) echo 1;; esac;; c) echo 2;; esac\nls"), "keyword:case|plain: a |keyword:in|plain: a) |keyword:case|plain: b |keyword:in|plain: b) |keyword:echo|plain: |number:1|plain:;; |keyword:esac|plain:;; c) |keyword:echo|plain: |number:2|plain:;; |keyword:esac // plain:ls", "a case inside a case");
  assert.equal(kinds("case $x in\n  a) echo \"a ) b\" ;;\n  # note\n  *) echo # c\n    ;;\nesac"), "keyword:case|plain: |type:$x|plain: |keyword:in // plain:  a) |keyword:echo|plain: |string:\"a ) b\"|plain: ;; // plain:  |comment:# note // plain:  *) |keyword:echo|plain: |comment:# c // plain:    ;; // keyword:esac", "a ) in a string, and comments between clauses");

  // Unusual text never gets lost or changed, and deep nesting does not crash.
  for (const source of ["", "'", "\"", "`", "$", "$(", "$((", "${", "${}", "$'", "$\"", "\\", "#", "<<", "<<-", "<<<", "<<EOF", "<<'EOF", "<<\\", "((", "))", "(", ")", ";;", ";&", "&>", "|&", "case", "case x in", "esac)", "中文 \"é\" $é 😀", "echo 😀 <<E\r\nE\r\n", "a\r\nb"]) {
    assert.equal(tokenizeShell(source).map(joinLine).join("\n"), source, JSON.stringify(source));
  }
  const deep = "$(".repeat(200) + "echo hi" + ")".repeat(200);
  assert.equal(tokenizeShell(deep).map(joinLine).join("\n"), deep, "200 levels of $( )");
});

test("tokenizer: Python comments, strings, numbers, keywords and decorators", () => {
  const py = tokenizePython(fixture("basic.py"));
  assert.equal(kindOf(py, "A small weather log"), "string", "docstring");
  assert.equal(kindOf(py, "has a # that is not a comment"), "string", "triple-quoted strings continue across lines");
  assert.equal(kindOf(py, "# raw string, then a comment"), "comment");
  assert.equal(kindOf(py, 'r"^(\\w+)'), "string", "the r prefix is part of the string");
  assert.equal(kindOf(py, 'b"bytes"'), "string");
  assert.equal(kindOf(py, "'Toronto'"), "string");
  assert.equal(kindOf(py, "1_000"), "number");
  assert.equal(kindOf(py, "0xFF"), "number");
  assert.equal(kindOf(py, "3.14e-2"), "number");
  assert.equal(kindOf(py, ".5"), "number");
  assert.equal(kindOf(py, "@dataclass"), "preprocessor");
  assert.equal(kindOf(py, "@staticmethod"), "preprocessor");
  for (const word of ["import", "from", "class", "def", "return", "if", "is", "None", "for", "in", "not", "else"]) {
    assert.ok(py.flat().some((t) => t.text === word && t.kind === "keyword"), word);
  }
  assert.equal(kindOfWord(py, "float"), "type");
  assert.equal(kindOfWord(py, "self"), "plain");
  assert.equal(kindOfWord(py, "print"), "plain");

  // A number stops where the number ends.
  const numbers = tokenizePython("x = 1.5.is_integer() + 0b1010 + 0o17 + 2j + 1if y else 0xE+1");
  for (const text of ["1.5", "0b1010", "0o17", "2j", "0xE"]) {
    assert.ok(numbers.flat().some((t) => t.kind === "number" && t.text === text), text);
  }
  assert.equal(kindOfWord(numbers, "is_integer"), "plain");

  // @ in the middle of a line, or inside brackets, is the matrix operator.
  const matmul = tokenizePython("c = a @b\nd = (a\n     @b)\n@wraps(f)\ndef g(): pass");
  assert.deepEqual(matmul.flat().filter((t) => t.kind === "preprocessor").map((t) => t.text), ["@wraps"]);

  // Built-in type names after a dot are ordinary attributes.
  assert.equal(kindOfWord(tokenizePython("y = np.float(3)"), "float"), "plain");
});

test("tokenizer: Python soft keywords are only coloured where they are keywords", () => {
  const kinds = (source: string, word: string): TokenKind[] =>
    tokenizePython(source).flat().filter((t) => t.text === word).map((t) => t.kind);
  const statement = "match command:\n    case [x, y]:\n        pass\n    case _:  # anything\n        pass";
  assert.deepEqual(kinds(statement, "match"), ["keyword"]);
  assert.deepEqual(kinds(statement, "case"), ["keyword", "keyword"]);
  for (const source of ["match = re.match(p, s)", "match.group(1)", "match: int = 3", "x = match", "print(match)", "match(x)"]) {
    assert.ok(!kinds(source, "match").includes("keyword"), source);
  }
  assert.deepEqual(kinds("type Point = tuple[int, int]", "type"), ["keyword"]);
  assert.deepEqual(kinds("type Box[T] = list[T]", "type"), ["keyword"]);
  assert.deepEqual(kinds("type = 3", "type"), ["type"], "as a name it's the built-in");
  assert.deepEqual(kinds("x = type(y)", "type"), ["type"]);

  const inFixture = tokenizePython(fixture("basic.py")).flat();
  const matchKinds = inFixture.filter((t) => /(^|\W)match($|\W)/.test(t.text)).map((t) => t.kind);
  assert.ok(matchKinds.includes("keyword") && matchKinds.includes("plain"), "the fixture has match as a keyword and as a name");
});

test("tokenizer: Python f-strings colour the code inside the braces", () => {
  const tokensOf = (source: string): string[] => tokenizePython(source).flat().map((t) => `${t.kind}:${t.text}`);
  assert.deepEqual(tokensOf('f"{name!r} is {age + 1:>4} {{literal}}"'), [
    'string:f"', "plain:{name", "string:!r", "plain:}", "string: is ", "plain:{age + ", "number:1", "string::>4", "plain:}",
    'string: {{literal}}"',
  ]);
  assert.deepEqual(tokensOf("f'{d[\"k\"]} {x if x != 0 else None}'"), [
    "string:f'", "plain:{d[", 'string:"k"', "plain:]}", "string: ", "plain:{x ", "keyword:if", "plain: x != ", "number:0",
    "plain: ", "keyword:else", "plain: ", "keyword:None", "plain:}", "string:'",
  ]);
  // A dict inside the braces: its colon belongs to the code, not a format spec.
  assert.ok(tokensOf('f"{ {1: 2}[1] }"').includes("number:2"));
  // Raw f-strings: a backslash doesn't hide a field.
  assert.ok(tokensOf('rf"\\d{count}"').includes("plain:{count}"));
  // Other prefixes are plain strings, braces and all.
  assert.deepEqual(tokensOf('Rb"{x}" + u"{y}"'), ['string:Rb"{x}"', "plain: + ", 'string:u"{y}"']);
  // Triple-quoted f-strings keep going across lines.
  const multi = tokenizePython('s = f"""a {x}\nb {y:02d}"""\nz = 1');
  assert.equal(kindOf(multi, "b "), "string");
  assert.equal(kindOf(multi, "02d"), "string");
  assert.equal(kindOf(multi, "1"), "number");
});

test("tokenizer: unterminated Python strings and fields don't swallow or lose text", () => {
  const sources = [
    's = "no end\nx = 1',
    "s = f'{no end\nx = 1",
    's = f"{a!r:{w}} {" \nx = 1',
    'doc = """never closed\nstill string',
    'f"{',
    'f"{x:',
    "x = '\\",
    'f"\\',
    'rf"\\{',
    "@",
    "1e",
    "0x",
    "f\"\"\"{a\n}\"\"\" + f'{b\n}'",
    "s = f\"{'}'}\" # \u{1F600}",
  ];
  for (const source of sources) {
    assert.equal(tokenizePython(source).map(joinLine).join("\n"), source, JSON.stringify(source));
  }
  const lines = tokenizePython('s = "no end\nx = 1\ndoc = """never closed\nstill string');
  assert.equal(kindOf(lines, "1"), "number", "an unclosed string stops at the end of its line");
  assert.equal(kindOf(lines, "still string"), "string");
});

test("languages: picked by extension or VS Code language id, with .h treated as C++", () => {
  assert.equal(languageForFile("main.c"), "c");
  assert.equal(languageForFile("MAIN.C"), "c");
  assert.equal(languageForFile("main.cpp"), "cpp");
  assert.equal(languageForFile("list.h"), "cpp", ".h stays C++ (a superset of C)");
  assert.equal(languageForFile("list.hpp"), "cpp");
  assert.equal(languageForFile("notes.txt"), undefined);
  assert.equal(languageForFile("c"), undefined);
  assert.equal(languageForVscodeId("c"), "c");
  assert.equal(languageForVscodeId("cpp"), "cpp");
  assert.equal(languageForFile("stats.py"), "python");
  assert.equal(languageForFile("app.PYW"), "python");
  assert.equal(languageForFile("py"), undefined);
  assert.equal(languageForVscodeId("python"), "python");
  assert.equal(languageForFile("styles.css"), "css");
  assert.equal(languageForFile("THEME.CSS"), "css");
  assert.equal(languageForFile("styles.scss"), undefined);
  assert.equal(languageForVscodeId("css"), "css");
  assert.equal(languageForFile("index.html"), "html");
  assert.equal(languageForFile("PAGE.HTM"), "html");
  assert.equal(languageForFile("page.xhtml"), undefined);
  assert.equal(languageForVscodeId("html"), "html");
  assert.equal(languageForFile("app.js"), "javascript");
  assert.equal(languageForFile("SERVER.MJS"), "javascript");
  assert.equal(languageForFile("config.cjs"), "javascript");
  assert.equal(languageForFile("App.jsx"), "javascriptreact");
  assert.equal(languageForFile("App.TSX"), "typescriptreact");
  assert.equal(languageForFile("util.ts"), "typescript");
  assert.equal(languageForFile("load.mts"), "typescript");
  assert.equal(languageForFile("conf.cts"), "typescript");
  assert.equal(languageForFile("types.d.ts"), "typescript");
  assert.equal(languageForVscodeId("javascript"), "javascript");
  assert.equal(languageForVscodeId("typescript"), "typescript");
  assert.equal(languageForVscodeId("javascriptreact"), "javascriptreact");
  assert.equal(languageForVscodeId("typescriptreact"), "typescriptreact");
  assert.equal(languageForFile("main.rs"), "rust");
  assert.equal(languageForFile("LIB.RS"), "rust");
  assert.equal(languageForFile("main.rs.bk"), undefined);
  assert.equal(languageForVscodeId("rust"), "rust");
  assert.equal(languageForFile("Main.java"), "java");
  assert.equal(languageForFile("MAIN.JAVA"), "java");
  assert.equal(languageForFile("Main.class"), undefined);
  assert.equal(languageForVscodeId("java"), "java");
  assert.equal(languageForFile("Program.cs"), "csharp");
  assert.equal(languageForFile("PROGRAM.CS"), "csharp");
  assert.equal(languageForFile("App.csproj"), undefined);
  assert.equal(languageForVscodeId("csharp"), "csharp");
  assert.equal(languageForFile("main.go"), "go");
  assert.equal(languageForFile("MAIN.GO"), "go");
  assert.equal(languageForFile("go.mod"), undefined);
  assert.equal(languageForVscodeId("go"), "go");
  assert.equal(languageForFile("index.php"), "php");
  assert.equal(languageForFile("INDEX.PHP"), "php");
  assert.equal(languageForFile("a.phtml"), undefined);
  assert.equal(languageForFile("composer.json"), undefined);
  assert.equal(languageForVscodeId("php"), "php");
  assert.equal(languageForFile("schema.sql"), "sql");
  assert.equal(languageForFile("SCHEMA.SQL"), "sql");
  assert.equal(languageForFile("data.sqlite"), undefined);
  assert.equal(languageForFile("query.mysql"), undefined);
  assert.equal(languageForVscodeId("sql"), "sql");
  assert.equal(languageForFile("backup.sh"), "shell");
  assert.equal(languageForFile("SETUP.BASH"), "shell");
  assert.equal(languageForFile("prompt.zsh"), undefined);
  assert.equal(languageForFile("sh"), undefined);
  assert.equal(languageForVscodeId("shellscript"), "shell");
  assert.equal(LANGUAGE_NAMES, "C, C++, Python, CSS, HTML, JavaScript, TypeScript, React, Rust, Java, C#, Go, PHP, SQL and Shell");
  assert.equal(LANGUAGE_NAMES_OR, "C, C++, Python, CSS, HTML, JavaScript, TypeScript, React, Rust, Java, C#, Go, PHP, SQL or Shell");
});

test("layout: tabs expand to the next tab stop and control characters become visible", () => {
  const [expanded] = [expandLine([{ kind: "plain", text: "\tx\ty\u0000" }], 4)];
  assert.equal(expanded.map((t) => t.text).join(""), "    x   y␀");
});

test("layout: character widths for ASCII, CJK and combining marks", () => {
  assert.equal(columnWidth("a".codePointAt(0)!), 1);
  assert.equal(columnWidth("中".codePointAt(0)!), 2);
  assert.equal(columnWidth(0x0301), 0);
});

test("layout: long lines wrap with every character kept, and only the first row is numbered", () => {
  const text = "    " + "abcdefghij".repeat(10); // 104 columns
  const rows = layoutLine([{ kind: "plain", text }], 7, 40, true);
  assert.ok(rows.length >= 3);
  assert.equal(rows[0]!.lineNumber, 7);
  assert.ok(rows.slice(1).every((r) => r.lineNumber === null && r.continuation));
  assert.equal(rows.map((r) => r.runs.map((run) => run.text).join("")).join(""), text, "no characters lost");
  assert.equal(rows[1]!.runs[0]!.column, 4, "wrapped rows keep the line's indent");
});

test("layout: with wrapping off, long lines are cut and marked", () => {
  const rows = layoutLine([{ kind: "plain", text: "x".repeat(100) }], 1, 40, false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.clipped, true);
  assert.equal(rows[0]!.runs[0]!.text.length, 39);
  const short = layoutLine([{ kind: "plain", text: "x".repeat(40) }], 1, 40, false);
  assert.equal(short[0]!.clipped, false, "a line that exactly fits is not cut");
});

test("options: defaults, clamping and page sizes", () => {
  assert.deepEqual(normalizeOptions({}), DEFAULT_OPTIONS);
  const odd = normalizeOptions({ fontSize: 500, marginInches: -3, paperSize: "Legal", tabSize: 2.6, header: "yes" });
  assert.equal(odd.fontSize, 16);
  assert.equal(odd.marginInches, 0.25);
  assert.equal(odd.paperSize, "Letter");
  assert.equal(odd.tabSize, 3);
  assert.equal(odd.header, true);
  assert.deepEqual(pageSize(normalizeOptions({ paperSize: "A4", orientation: "landscape" })), [841.89, 595.28]);
});

test("files: supported extensions, excluded folders and PDF names", () => {
  for (const name of ["a.c", "a.cpp", "a.cc", "a.cxx", "a.h", "a.hpp", "a.hh", "a.hxx", "A.CPP", "A.C", "a.py", "a.pyw", "A.PY", "a.css", "A.CSS", "a.html", "a.htm", "A.HTML", "a.js", "a.mjs", "a.cjs", "A.JS", "a.ts", "a.mts", "a.cts", "A.TS", "a.jsx", "a.tsx", "A.TSX", "a.rs", "A.RS", "a.java", "A.JAVA", "a.cs", "A.CS", "a.go", "A.GO", "a.php", "A.PHP"]) {
    assert.ok(isSupportedSource(name), name);
  }
  for (const name of ["a.ts.map", "a.tsbuildinfo", "a.js.map", "js", "cpp", "c", "py", "css", "a.scss", "a.css.map", "html", "a.html.bak", "a.xhtml", "a.cpp.bak", "a.c.bak", "a.pyc", "a.rs.bk", "rs", "a.class", "a.jar", "java", "a.csproj", "a.sln", "a.dll", "cs", "a.mod", "a.sum", "go", "a.phtml", "a.php.bak", "a.inc", "php", "notes.txt"]) {
    assert.ok(!isSupportedSource(name), name);
  }
  for (const name of [".git", ".vscode", "node_modules", "build", "dist", "cmake-build-debug", "Debug", "__pycache__", "venv", ".venv", "target", "out", "bin", ".gradle", "obj", "vendor"]) {
    assert.ok(isExcludedFolder(name), name);
  }
  assert.ok(!isExcludedFolder("src"));
  assert.equal(pdfNameFor("main.cpp"), "main.pdf");
  assert.equal(selectionPdfName("main.cpp", 10, 25), "main-lines-10-25.pdf");
  assert.equal(selectionPdfName("main.cpp", 4, 4), "main-line-4.pdf");
  assert.deepEqual(
    batchPdfNames([
      { folder: "/p", fileName: "main.cpp" },
      { folder: "/p", fileName: "main.h" },
      { folder: "/p", fileName: "util.cpp" },
      { folder: "/q", fileName: "main.cpp" },
    ]),
    ["main.cpp.pdf", "main.h.pdf", "util.pdf", "main.pdf"],
  );
});

test("files: folder scan skips hidden files, dependency and build folders, and sorts headers first", async () => {
  const tree: Record<string, DirEntry[]> = {
    "": [
      { name: "main.cpp", isFile: true, isDirectory: false },
      { name: "util.h", isFile: true, isDirectory: false },
      { name: "notes.txt", isFile: true, isDirectory: false },
      { name: ".hidden.cpp", isFile: true, isDirectory: false },
      { name: "src", isFile: false, isDirectory: true },
      { name: "build", isFile: false, isDirectory: true },
      { name: "node_modules", isFile: false, isDirectory: true },
      { name: ".git", isFile: false, isDirectory: true },
    ],
    src: [
      { name: "util.cpp", isFile: true, isDirectory: false },
      { name: "a.hpp", isFile: true, isDirectory: false },
    ],
    build: [{ name: "generated.cpp", isFile: true, isDirectory: false }],
  };
  const scan = await scanFolder<string>(
    "",
    async (path) => tree[path] ?? [],
    (path, name) => (path ? `${path}/${name}` : name),
  );
  assert.deepEqual(scan.files.map((f) => f.relativePath).sort(), ["main.cpp", "src/a.hpp", "src/util.cpp", "util.h"]);
  assert.deepEqual(scan.skippedFolders.sort(), [".git", "build", "node_modules"]);
  assert.deepEqual(scan.skippedHiddenFiles, [".hidden.cpp"]);
  assert.deepEqual(sortForExport(scan.files).map((f) => f.relativePath), ["src/a.hpp", "util.h", "main.cpp", "src/util.cpp"]);

  const capped = await scanFolder<string>("", async (path) => tree[path] ?? [], (p, n) => (p ? `${p}/${n}` : n), 2);
  assert.equal(capped.files.length, 2);
  assert.equal(capped.truncated, true);
});

test("fonts: parses the editor font setting and finds the Mac's fonts", () => {
  assert.deepEqual(parseFontFamilyList("Menlo, Monaco, 'Courier New', monospace"), ["Menlo", "Monaco", "Courier New"]);
  assert.deepEqual(parseFontFamilyList(undefined), []);
  if (process.platform !== "darwin") {
    return;
  }
  const fonts = resolveFonts("Menlo, Monaco, 'Courier New', monospace");
  assert.equal(fonts.primary.family, "Menlo");
  assert.ok(fonts.primary.covers("π".codePointAt(0)!));
  assert.ok(!fonts.primary.covers("中".codePointAt(0)!));
  assert.ok(fonts.fallbacks.some((f) => f.covers("中".codePointAt(0)!)), "a fill-in font covers Chinese");
  const missing = resolveFonts("'Some Font That Does Not Exist', monospace");
  assert.equal(missing.primary.family, "Menlo", "unknown editor fonts fall back to Menlo");
  const proportional = resolveFonts("Helvetica");
  assert.notEqual(proportional.primary.family, "Helvetica", "proportional fonts are skipped");
});
