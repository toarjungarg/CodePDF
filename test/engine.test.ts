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
import { tokenizeKotlin } from "../src/export/kotlinTokenizer";
import { tokenizeSwift } from "../src/export/swiftTokenizer";
import { tokenizeRuby } from "../src/export/rubyTokenizer";
import { tokenizeDart } from "../src/export/dartTokenizer";
import { tokenizeLua } from "../src/export/luaTokenizer";
import { tokenizeR } from "../src/export/rTokenizer";
import { tokenizeMatlab } from "../src/export/matlabTokenizer";
import { tokenizeVerilog } from "../src/export/verilogTokenizer";
import { tokenizeVhdl } from "../src/export/vhdlTokenizer";
import { tokenizeAsm } from "../src/export/asmTokenizer";
import { tokenizeLatex } from "../src/export/latexTokenizer";
import { tokenizeJson } from "../src/export/jsonTokenizer";
import { tokenizeXml } from "../src/export/xmlTokenizer";
import { tokenizeYaml } from "../src/export/yamlTokenizer";
import type { TokenKind, TokenLine } from "../src/export/tokens";
import { languageForFile, languageForVscodeId, LANGUAGES, LANGUAGE_NAMES, LANGUAGE_NAMES_OR } from "../src/export/languages";
import { columnWidth, expandLine, layoutLine } from "../src/export/layout";
import { DEFAULT_OPTIONS, normalizeOptions, pageSize } from "../src/export/options";
import { parseFontFamilyList, resolveFonts } from "../src/export/fonts";
import {
  batchPdfNames, isExcludedFolder, isGeneratedFile, isSupportedSource, pdfNameFor, scanFolder, selectionPdfName, sortForExport,
  type DirEntry,
} from "../src/files";
import { readFileSync } from "node:fs";
import { fixture, ROOT } from "./helpers";

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
  for (const name of ["basic.cpp", "comments_strings.cpp", "unicode.cpp", "long_lines.cpp", "basic.c", "basic.py", "basic.css", "basic.html", "basic.js", "basic.ts", "basic.jsx", "basic.tsx", "basic.rs", "basic.java", "basic.cs", "basic.go", "basic.php", "basic.sql", "basic.sh", "basic.kt", "basic.swift", "basic.rb", "basic.dart", "basic.lua", "basic.r", "basic.m", "basic.ino", "basic.sv", "basic.vhd", "basic.s", "basic.tex", "basic.json", "basic.yaml", "basic.xml"]) {
    const source = fixture(name).replace(/\r\n?/g, "\n");
    for (const lines of [
      tokenizeCpp(source), tokenizeC(source), tokenizePython(source), tokenizeCss(source), tokenizeHtml(source), tokenizeJavaScript(source),
      tokenizeTs(source), tokenizeJsx(source), tokenizeTsx(source), tokenizeRust(source), tokenizeJava(source), tokenizeCSharp(source), tokenizeGo(source), tokenizePhp(source), tokenizeSql(source), tokenizeShell(source), tokenizeKotlin(source), tokenizeSwift(source), tokenizeRuby(source), tokenizeDart(source), tokenizeLua(source), tokenizeR(source), tokenizeMatlab(source), tokenizeVerilog(source), tokenizeVhdl(source), tokenizeAsm(source), tokenizeLatex(source), tokenizeJson(source), tokenizeYaml(source), tokenizeXml(source),
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

test("tokenizer: Kotlin comments, strings, templates, numbers, annotations and keywords", () => {
  const source = fixture("basic.kt");
  const sourceLines = source.split("\n");
  const kt = tokenizeKotlin(source);
  assert.equal(kt.length, sourceLines.length, "one token line per source line");
  // One source line as kind:text pieces joined with |, found by a piece of its text.
  const line = (text: string): string => {
    const index = sourceLines.findIndex((l) => l.includes(text));
    assert.ok(index !== -1, `no line with ${text}`);
    return kt[index]!.map((t) => `${t.kind}:${t.text}`).join("|");
  };
  const has = (text: string, kind: TokenKind): boolean => kt.flat().some((t) => t.text === text && t.kind === kind);

  // Comments: KDoc, a line comment, and a block comment with another one inside it.
  assert.equal(kindOf(kt, "A small recipe book"), "comment", "KDoc");
  assert.equal(kindOf(kt, "One line comment"), "comment");
  assert.ok(has("/* A block comment /* with a nested one */ that is still a comment */", "comment"), "a nested block comment is one comment");

  // Annotations, including a file target.
  assert.equal(line("@file:JvmName"), 'preprocessor:@file:JvmName|plain:(|string:"Shelf"|plain:)');
  assert.ok(has("@JvmInline", "preprocessor") && has("@Target", "preprocessor") && has("@Tasty", "preprocessor"));

  // Numbers, and characters.
  for (const num of ["1_000", "0xFF", "0b1010", "9_000_000_000L", "7u", "0xFFuL", "1.5e10", "2.5f", "0", "3", "1", "10", "2"]) {
    assert.ok(has(num, "number"), `number ${num}`);
  }
  for (const char of ["'A'", "'\\t'", "'\\''"]) {
    assert.ok(has(char, "string"), `char ${char}`);
  }

  // Declarations, modifiers and types.
  assert.equal(line("package kitchen"), "keyword:package|plain: kitchen.recipes");
  assert.equal(line("import kotlin.collections"), "keyword:import|plain: kotlin.collections.|type:List|plain: |keyword:as|plain: |type:KList");
  assert.equal(line("const val MAX_ITEMS"), "keyword:const|plain: |keyword:val|plain: MAX_ITEMS = |number:1_000", "a CONSTANT stays plain");
  assert.equal(
    line("data class Soup"),
    "keyword:data|plain: |keyword:class|plain: |type:Soup|plain:(|keyword:override|plain: |keyword:val|plain: name: |type:String|plain:, |keyword:val|plain: cups: |type:Int|plain: = |number:2|plain:) : |type:Dish",
  );
  assert.equal(line("sealed class Step"), "keyword:sealed|plain: |keyword:class|plain: |type:Step|plain: {");
  assert.equal(line("data object Stir"), "plain:    |keyword:data|plain: |keyword:object|plain: |type:Stir|plain: : |type:Step|plain:()");
  assert.equal(line("enum class Measure"), "keyword:enum|plain: |keyword:class|plain: |type:Measure|plain: { CUP, SPOON, GRAM }");
  assert.equal(line("value class Grams"), "keyword:value|plain: |keyword:class|plain: |type:Grams|plain:(|keyword:val|plain: amount: |type:Int|plain:)");
  assert.equal(
    line("open class Pantry"),
    "keyword:open|plain: |keyword:class|plain: |type:Pantry|plain:<|keyword:out|plain: |type:T|plain: : |type:Dish|plain:>(|keyword:private|plain: |keyword:val|plain: dishes: |type:List|plain:<|type:T|plain:>) {",
  );
  assert.equal(
    line("suspend fun load"),
    "plain:    |keyword:suspend|plain: |keyword:fun|plain: load(|keyword:vararg|plain: names: |type:String|plain:): |type:List|plain:<|type:String|plain:> {",
  );
  assert.equal(
    line("inline fun <reified"),
    "plain:    |keyword:inline|plain: |keyword:fun|plain: <|keyword:reified|plain: |type:R|plain:> pick(items: |type:List|plain:<|type:Any|plain:>): |type:R|plain:? = items.firstOrNull { it |keyword:is|plain: |type:R|plain: } |keyword:as|plain:? |type:R",
  );
  assert.equal(line("infix fun plus"), "plain:    |keyword:infix|plain: |keyword:fun|plain: plus(other: |type:Int|plain:): |type:Int|plain: = count + other");
  assert.equal(
    line("where T : Comparable"),
    "keyword:fun|plain: <|type:T|plain:> biggest(items: |type:List|plain:<|type:T|plain:>): |type:T|plain:? |keyword:where|plain: |type:T|plain: : |type:Comparable|plain:<|type:T|plain:> {",
  );
  assert.equal(line("`my test with spaces`"), "keyword:fun|plain: `my test with spaces`() = |number:1", "a backtick name is plain");

  // get, set, init and by are keywords only where they work as keywords.
  assert.equal(line("get() = dishes.size"), "plain:        |keyword:get|plain:() = dishes.size");
  assert.equal(line("private set"), "plain:        |keyword:private|plain: |keyword:set");
  assert.equal(line("set(value) {"), "plain:        |keyword:set|plain:(value) {");
  assert.equal(line("field = value.trim()"), "plain:            field = value.trim()", "field and value stay plain");
  assert.equal(line("val greeting by lazy"), 'plain:    |keyword:val|plain: greeting |keyword:by|plain: lazy { |string:"Hello from the pantry"|plain: }');
  assert.equal(line("init {"), "plain:    |keyword:init|plain: {");
  assert.equal(line("val value = 3"), "plain:        |keyword:val|plain: value = |number:3", "a variable named value");
  assert.equal(line("val data = dishes.map"), "plain:        |keyword:val|plain: data = dishes.map { it.name }", "a variable named data");

  // Templates: $name, ${code} with strings and braces inside, and escapes.
  assert.equal(
    line('val message = "Pantry'),
    'plain:        |keyword:val|plain: message = |string:"Pantry |plain:$label|string: has |plain:${dishes.size}|string: dishes, total |plain:${value + count}|string:"',
  );
  assert.equal(
    line("val nested"),
    'plain:        |keyword:val|plain: nested = |string:"outer |plain:${data.joinToString(|string:", "|plain:) { |string:"<|plain:$it|string:>"|plain: }}|string: done"',
    "a string inside ${ } inside a string",
  );
  assert.equal(
    line("val braces"),
    'plain:        |keyword:val|plain: braces = |string:"a map: |plain:${mapOf(|string:"k"|plain: to |string:"}"|plain:)}|string: and a dollar |plain:${|string:\'$\'|plain:}|string:"',
    "a } inside a string inside ${ } does not close it",
  );
  assert.equal(
    line("val escaped"),
    'plain:        |keyword:val|plain: escaped = |string:"price: \\$5 and a quote \\" and \\\\"',
    "\\$ is an escaped dollar, not a template",
  );

  // Raw strings: lines in the middle, templates still work, \n is plain text, and """" ends one.
  assert.equal(line('val rawText = """'), 'plain:        |keyword:val|plain: rawText = |string:"""');
  assert.equal(line("Line one with"), "string:            Line one with |plain:$label");
  assert.equal(line("Line two with"), "string:            Line two with |plain:${value * |number:2|plain:}");
  assert.equal(line("A \"quoted\" word"), 'string:            A "quoted" word, and \\n is not an escape');
  assert.equal(line(".trimIndent()"), 'string:        """|plain:.trimIndent()');
  assert.equal(line("val edge"), 'plain:        |keyword:val|plain: edge = |string:"""ends with a quote""""');
  assert.equal(line("return message"), "plain:        |keyword:return|plain: message + nested + braces + escaped + rawText + edge");

  // Labels, ranges and operators.
  assert.equal(line("return@forEach"), "plain:        |keyword:if|plain: (it < |number:0|plain:) |keyword:return|plain:@forEach");
  assert.equal(line("outer@ for"), "plain:    outer@ |keyword:for|plain: (i |keyword:in|plain: |number:0|plain:..<|number:3|plain:) {");
  assert.equal(line("1..10 step 2"), "plain:        |keyword:for|plain: (j |keyword:in|plain: |number:1|plain:..|number:10|plain: step |number:2|plain:) {");
  assert.equal(line("break@outer"), "plain:            |keyword:if|plain: (j > |number:5|plain:) |keyword:break|plain:@outer");
  assert.equal(line("this@Outer.text"), "plain:        |keyword:fun|plain: show() = |keyword:this|plain:@Outer.text");
  assert.equal(line("val type = Pantry::class"), "plain:    |keyword:val|plain: type = |type:Pantry|plain:::|keyword:class");
  assert.equal(line("numbers?.firstOrNull() ?: 0"), "plain:    |keyword:val|plain: first = numbers?.firstOrNull() ?: |number:0");
  assert.equal(line("numbers!!.last()"), "plain:    |keyword:val|plain: last = numbers!!.last()");
  assert.equal(line("catch (e: Exception)"), "plain:        } |keyword:catch|plain: (e: |type:Exception|plain:) {");
  assert.equal(line("} finally {"), "plain:        } |keyword:finally|plain: {");
  assert.equal(line("inner class Inner"), "plain:    |keyword:inner|plain: |keyword:class|plain: |type:Inner|plain: {");
});

test("tokenizer: Kotlin tricky cases", () => {
  // Every token as kind:text, joined with |, and a " // " marks the start of a new line.
  const kinds = (source: string): string => tokenizeKotlin(source).map((l) => l.map((t) => `${t.kind}:${t.text}`).join("|")).join(" // ");

  // Comments nest, and an unclosed one runs to the end.
  assert.equal(kinds("/* a /* b */ c */ val x"), "comment:/* a /* b */ c */|plain: |keyword:val|plain: x");
  assert.equal(kinds("/* a /* b */ val x"), "comment:/* a /* b */ val x", "one level is still open");
  assert.equal(kinds("/** doc // not line */ x\n// c /* d\ny"), "comment:/** doc // not line */|plain: x // comment:// c /* d // plain:y");
  assert.equal(kinds("#!/usr/bin/env kotlin\nprintln(1)"), "comment:#!/usr/bin/env kotlin // plain:println(|number:1|plain:)", "a script's first line");
  assert.equal(kinds("x #! y"), "plain:x #! y", "#! only counts on the very first line");

  // Strings, templates and escapes.
  assert.equal(kinds('"a $b c"'), 'string:"a |plain:$b|string: c"');
  assert.equal(kinds('"a ${b + 1} c"'), 'string:"a |plain:${b + |number:1|plain:}|string: c"');
  assert.equal(kinds('"$"'), 'string:"$"', "a lone $ is text");
  assert.equal(kinds('"$1 $ {a}"'), 'string:"$1 $ {a}"', "$ before a digit or a space is text");
  assert.equal(kinds('"\\$a \\" $b"'), 'string:"\\$a \\" |plain:$b|string:"', "an escaped $ is not a template");
  assert.equal(kinds('"a ${b" c'), 'string:"a ${b"|plain: c', "a ${ that never closes is text");
  assert.equal(kinds('"x ${f("}")} y" z'), 'string:"x |plain:${f(|string:"}"|plain:)}|string: y"|plain: z');
  assert.equal(kinds('"x ${if (a) "b" else "c"}"'), 'string:"x |plain:${|keyword:if|plain: (a) |string:"b"|plain: |keyword:else|plain: |string:"c"|plain:}|string:"', "keywords inside a template are coloured");
  assert.equal(kinds('"x ${"y ${z} w"} v"'), 'string:"x |plain:${|string:"y |plain:${z}|string: w"|plain:}|string: v"', "a template inside a template");
  assert.equal(kinds('"no end\nval x'), 'string:"no end // keyword:val|plain: x', "a string ends at the line end");
  assert.equal(kinds("'a' '\\n' '\\u0041' '\\'' x"), "string:'a'|plain: |string:'\\n'|plain: |string:'\\u0041'|plain: |string:'\\''|plain: x");

  // Raw strings.
  assert.equal(kinds('"""a $b ${c}"""'), 'string:"""a |plain:$b|string: |plain:${c}|string:"""');
  assert.equal(kinds('"""a""""  x'), 'string:"""a""""|plain:  x', "four quotes at the end: the last three close it");
  assert.equal(kinds('"""a""" b """c"""'), 'string:"""a"""|plain: b |string:"""c"""');
  assert.equal(kinds('"""say "hi" and ""ok"" \\n"""'), 'string:"""say "hi" and ""ok"" \\n"""', "quotes and backslashes are plain text");
  assert.equal(kinds('"""\nno end'), 'string:""" // string:no end', "an unclosed raw string runs to the end");
  assert.equal(kinds('""" ${\n  a\n} """ x'), 'string:""" |plain:${ // plain:  a // plain:}|string: """|plain: x', "a template in a raw string can span lines");
  assert.equal(kinds('"" + ""'), 'string:""|plain: + |string:""', "empty strings");

  // Annotations and labels.
  assert.equal(kinds("@get:Rule val x"), "preprocessor:@get:Rule|plain: |keyword:val|plain: x");
  assert.equal(kinds("@kotlin.jvm.JvmStatic fun f()"), "preprocessor:@kotlin.jvm.JvmStatic|plain: |keyword:fun|plain: f()");
  assert.equal(kinds("@Foo(1) @Bar"), "preprocessor:@Foo|plain:(|number:1|plain:) |preprocessor:@Bar");
  assert.equal(kinds("a@b"), "plain:a@b", "an @ right after a name is a label");
  assert.equal(kinds("return@ x"), "keyword:return|plain:@ x");
  assert.equal(kinds("list.forEach label@{ it }"), "plain:list.forEach label@{ it }");
  assert.equal(kinds("@"), "plain:@");
  assert.equal(kinds("x::get"), "plain:x::get");

  // Backtick names.
  assert.equal(kinds("val `in` = 1; `a b`()"), "keyword:val|plain: `in` = |number:1|plain:; `a b`()");
  assert.equal(kinds("`no end\nval x"), "plain:`no end // keyword:val|plain: x");

  // Numbers.
  assert.equal(kinds("1..10 1.5.toInt() 1.toString() 0..<n"), "number:1|plain:..|number:10|plain: |number:1.5|plain:.toInt() |number:1|plain:.toString() |number:0|plain:..<n");
  assert.equal(kinds("0xFFu 0XFFL 0b1_0 1e3 1E-3 2f 3F 4L 5uL 6UL 1_000"), "number:0xFFu|plain: |number:0XFFL|plain: |number:0b1_0|plain: |number:1e3|plain: |number:1E-3|plain: |number:2f|plain: |number:3F|plain: |number:4L|plain: |number:5uL|plain: |number:6UL|plain: |number:1_000");
  assert.equal(kinds("a1 _2"), "plain:a1 _2", "a digit after a name or underscore is part of the name");

  // Soft and modifier words are plain unless they work as keywords.
  assert.equal(kinds("val value = 1; value + 1; println(value)"), "keyword:val|plain: value = |number:1|plain:; value + |number:1|plain:; println(value)");
  assert.equal(kinds("if (value in 1..3) data is Int"), "keyword:if|plain: (value |keyword:in|plain: |number:1|plain:..|number:3|plain:) data |keyword:is|plain: |type:Int");
  assert.equal(kinds("fun f(data: Int, value: String, set: Int, open: Boolean)"), "keyword:fun|plain: f(data: |type:Int|plain:, value: |type:String|plain:, set: |type:Int|plain:, open: |type:Boolean|plain:)");
  assert.equal(kinds("file.open(); val open = true; open()"), "plain:file.open(); |keyword:val|plain: open = |keyword:true|plain:; open()");
  assert.equal(kinds("override fun a() {}\nprivate val b = 1\nabstract class C"), "keyword:override|plain: |keyword:fun|plain: a() {} // keyword:private|plain: |keyword:val|plain: b = |number:1 // keyword:abstract|plain: |keyword:class|plain: |type:C");
  assert.equal(kinds("companion object\nprivate constructor()\nlateinit var s: String"), "keyword:companion|plain: |keyword:object // keyword:private|plain: |keyword:constructor|plain:() // keyword:lateinit|plain: |keyword:var|plain: s: |type:String");
  assert.equal(kinds("val get = 1; fun get() = 2"), "keyword:val|plain: get = |number:1|plain:; |keyword:fun|plain: get() = |number:2", "a function named get");
  assert.equal(kinds("x.get(1); get(2); map.set(a, b)"), "plain:x.get(|number:1|plain:); get(|number:2|plain:); map.set(a, b)");
  assert.equal(kinds("val x get() = 1"), "keyword:val|plain: x |keyword:get|plain:() = |number:1", "an accessor on the same line");
  assert.equal(kinds("var x = 0\n  private set\n  protected get"), "keyword:var|plain: x = |number:0 // plain:  |keyword:private|plain: |keyword:set // plain:  |keyword:protected|plain: |keyword:get");
  assert.equal(kinds("val by = 1\nval y by lazy { 1 }\nclass A : B by c"), "keyword:val|plain: by = |number:1 // keyword:val|plain: y |keyword:by|plain: lazy { |number:1|plain: } // keyword:class|plain: |type:A|plain: : |type:B|plain: |keyword:by|plain: c");
  assert.equal(kinds("Box<out T> Box<in T> System.out.println(out)"), "type:Box|plain:<|keyword:out|plain: |type:T|plain:> |type:Box|plain:<|keyword:in|plain: |type:T|plain:> |type:System|plain:.out.println(out)");
  assert.equal(kinds("val init = 1\ninit { x() }\nclass A { init {\n}\n}"), "keyword:val|plain: init = |number:1 // keyword:init|plain: { x() } // keyword:class|plain: |type:A|plain: { |keyword:init|plain: { // plain:} // plain:}");
  assert.equal(kinds("try { } catch (e: Exception) { } finally { }\nval catch = 1"), "keyword:try|plain: { } |keyword:catch|plain: (e: |type:Exception|plain:) { } |keyword:finally|plain: { } // keyword:val|plain: catch = |number:1");
  assert.equal(kinds("import a.b\nval import = 1\nx.import"), "keyword:import|plain: a.b // keyword:val|plain: import = |number:1 // plain:x.import");
  assert.equal(kinds("val f: suspend () -> Unit = {}\nsuspend(1)\nsuspend fun g()"), "keyword:val|plain: f: |keyword:suspend|plain: () -> |type:Unit|plain: = {} // plain:suspend(|number:1|plain:) // keyword:suspend|plain: |keyword:fun|plain: g()");
  assert.equal(kinds("fun <T> f(vararg a: Int, noinline b: () -> Unit) where T : Any"), "keyword:fun|plain: <|type:T|plain:> f(|keyword:vararg|plain: a: |type:Int|plain:, |keyword:noinline|plain: b: () -> |type:Unit|plain:) |keyword:where|plain: |type:T|plain: : |type:Any");
  assert.equal(kinds("val where = 1; where(x)"), "keyword:val|plain: where = |number:1|plain:; where(x)");
  assert.equal(kinds("typealias Names = List<String>"), "keyword:typealias|plain: |type:Names|plain: = |type:List|plain:<|type:String|plain:>");
  assert.equal(kinds("HTTP URL_PART Point T it"), "plain:HTTP URL_PART |type:Point|plain: |type:T|plain: it");
  assert.equal(kinds("if (a !in b && a !is C) x as? Y ?: z"), "keyword:if|plain: (a !|keyword:in|plain: b && a !|keyword:is|plain: |type:C|plain:) x |keyword:as|plain:? |type:Y|plain: ?: z");

  // Unusual text never gets lost or changed, and deep nesting does not crash.
  for (const source of ["", '"', "'", '"""', '""""', '"""a"', '"${', '"${a', '"${"', '"$', '"$a', "/*", "/* /*", "/* /* */", "/", "@", "@a:", "@a:b.", "`", "0x", "0b", "1e", "1e+", "1.", "1..", "return@", "$", "${", "#!", "中文 '中' \"é\" 😀", "a\r\nb", '"""\r\n${\r\n}"""']) {
    assert.equal(tokenizeKotlin(source).map(joinLine).join("\n"), source, JSON.stringify(source));
  }
  const deep = '"${'.repeat(100) + "x" + '}"'.repeat(100);
  assert.equal(tokenizeKotlin(deep).map(joinLine).join("\n"), deep, "100 levels of templates");
  const deepComment = "/*".repeat(200) + "*/".repeat(200) + " val x";
  assert.equal(kinds(deepComment), `comment:${"/*".repeat(200)}${"*/".repeat(200)}|plain: |keyword:val|plain: x`, "200 nested comments");
});

test("tokenizer: Swift comments, strings, interpolation, numbers, attributes and keywords", () => {
  const source = fixture("basic.swift");
  const sourceLines = source.split("\n");
  const sw = tokenizeSwift(source);
  assert.equal(sw.length, sourceLines.length, "one token line per source line");
  // One source line as kind:text pieces joined with |, found by a piece of its text.
  const line = (text: string): string => {
    const index = sourceLines.findIndex((l) => l.includes(text));
    assert.ok(index !== -1, `no line with ${text}`);
    return sw[index]!.map((t) => `${t.kind}:${t.text}`).join("|");
  };
  const has = (text: string, kind: TokenKind): boolean => sw.flat().some((t) => t.text === text && t.kind === kind);

  // Comments: the script line, a doc comment, a line comment, and a block comment with another one inside it.
  assert.equal(line("#!/usr/bin/env"), "comment:#!/usr/bin/env swift");
  assert.equal(kindOf(sw, "A small oven timer"), "comment", "doc comment");
  assert.equal(kindOf(sw, "One line comment"), "comment");
  assert.ok(has("/* A block comment /* with a nested one */ that is still a comment */", "comment"), "a nested block comment is one comment");
  assert.equal(line("// A variable named get"), "plain:    |comment:// A variable named get, set, some, any and async stays plain.");
  assert.equal(line("func describe()"), "plain:    |keyword:func|plain: describe() -> |type:String|plain: {", "a comment ending in a full stop does not hide the next keyword");

  // Numbers: separators, hex, binary, octal, floats, hex floats, and tuple positions.
  for (const num of ["1_000", "0xFF_FF", "0b1010", "0o755", "1.5e10", "2.5E-3", "0x1.8p3", "0xAp-2"]) {
    assert.ok(has(num, "number"), `number ${num}`);
  }
  assert.equal(line("let pair"), "keyword:let|plain: pair = (|number:3|plain:, (|number:4|plain:, |number:5|plain:))");
  assert.equal(line("let inner"), "keyword:let|plain: inner = pair.|number:1|plain:.|number:0", "pair.1.0 is two positions, not a float");
  assert.equal(line("let range"), "keyword:let|plain: range = |number:1|plain:...|number:10");
  assert.equal(line("let half"), "keyword:let|plain: half = |number:0|plain:..<|number:5");

  // # directives.
  assert.equal(line("#if DEBUG"), "preprocessor:#if|plain: |type:DEBUG");
  assert.equal(line("#elseif os(macOS)"), "preprocessor:#elseif|plain: os(macOS)");
  assert.ok(has("#else", "preprocessor"));
  assert.equal(line("#endif"), "preprocessor:#endif");
  assert.equal(line("#if os(iOS)"), "plain:    |preprocessor:#if|plain: os(iOS)");
  assert.equal(line("#available(macOS 13, *)"), "plain:    |keyword:if|plain: |preprocessor:#available|plain:(macOS |number:13|plain:, *) {");
  assert.equal(line("#selector"), "plain:    |keyword:let|plain: action = |preprocessor:#selector|plain:(|type:Oven|plain:.ring(_:))");

  // Attributes, and modifiers in front of declarations.
  assert.equal(line("@MainActor"), "preprocessor:@MainActor");
  assert.equal(line("final class Oven"), "keyword:final|plain: |keyword:class|plain: |type:Oven|plain:: |type:ObservableObject|plain: {");
  assert.equal(line("@Published var"), "plain:    |preprocessor:@Published|plain: |keyword:var|plain: trays: [|type:Loaf|plain:] = []");
  assert.equal(line("@State private var open"), "plain:    |preprocessor:@State|plain: |keyword:private|plain: |keyword:var|plain: open = |keyword:false", "a variable named open stays plain");
  assert.equal(line("weak var door"), "plain:    |keyword:weak|plain: |keyword:var|plain: door: |type:AnyObject|plain:?");
  assert.equal(line("@objc func ring"), "plain:    |preprocessor:@objc|plain: |keyword:func|plain: ring(_ sender: |type:Any|plain:?) {}");
  assert.equal(line("required init"), "plain:    |keyword:required|plain: |keyword:init|plain:() {}");
  assert.equal(line("convenience init"), "plain:    |keyword:convenience|plain: |keyword:init|plain:?(name: |type:String|plain:) {");
  assert.equal(line("self.init()"), "plain:        |keyword:self|plain:.|keyword:init|plain:()");
  assert.equal(line("indirect case"), "plain:    |keyword:indirect|plain: |keyword:case|plain: then(|type:Step|plain:, |type:Step|plain:)");
  assert.equal(line("mutating func cool() {"), "plain:    |keyword:mutating|plain: |keyword:func|plain: cool() {");
  assert.equal(line("actor Counter"), "keyword:actor|plain: |type:Counter|plain: {");

  // get, set, willSet and didSet are keywords only as accessors.
  assert.equal(line("var heat: Int { get set }"), "plain:    |keyword:var|plain: heat: |type:Int|plain: { |keyword:get|plain: |keyword:set|plain: }");
  assert.equal(line("private(set) var"), "plain:    |keyword:private|plain:(|keyword:set|plain:) |keyword:var|plain: slices = |number:8");
  assert.equal(line("get { trays.count }"), "plain:        |keyword:get|plain: { trays.count }");
  assert.equal(line("set(newValue)"), "plain:        |keyword:set|plain:(newValue) { print(newValue) }");
  assert.equal(line("willSet"), 'plain:        |keyword:willSet|plain: { print(|string:"going to |plain:\\(newValue)|string:"|plain:) }');
  assert.equal(line("didSet {"), "plain:        |keyword:didSet|plain: {");
  assert.equal(line("let get = 1"), "plain:        |keyword:let|plain: get = |number:1", "a variable named get");
  assert.equal(line("let set = 2"), "plain:        |keyword:let|plain: set = |number:2");
  assert.equal(line("let some = 3"), "plain:        |keyword:let|plain: some = |number:3");
  assert.equal(line("let any = 4"), "plain:        |keyword:let|plain: any = |number:4");
  assert.equal(line("let async = 5"), "plain:        |keyword:let|plain: async = |number:5");
  assert.equal(line("let actor = 6"), "plain:        |keyword:let|plain: actor = |number:6");
  assert.equal(line("let await = 7"), "plain:        |keyword:let|plain: await = |number:7");
  assert.equal(line("return \"\\(get"), 'plain:        |keyword:return|plain: |string:"|plain:\\(get + set + some + any + async + actor + await)|string:"');

  // async, await, some and any.
  assert.equal(line("func bake"), "plain:    |keyword:func|plain: bake(_ loaf: |type:Loaf|plain:, |keyword:for|plain: minutes: |type:Int|plain:) |keyword:async|plain: |keyword:throws|plain: -> |type:Loaf|plain: {");
  assert.equal(line("try await Task"), "plain:        |keyword:try|plain: |keyword:await|plain: |type:Task|plain:.sleep(nanoseconds: |number:1_000|plain:)");
  assert.equal(line("async let extra"), "plain:        |keyword:async|plain: |keyword:let|plain: extra = |type:Task|plain:.sleep(nanoseconds: |number:5|plain:)");
  assert.equal(line("some View"), "plain:    |keyword:func|plain: shapes() -> |keyword:some|plain: |type:View|plain: {");
  assert.equal(line("any Baked, from"), "plain:    |keyword:func|plain: pick(_ item: |keyword:any|plain: |type:Baked|plain:, from list: [|keyword:any|plain: |type:Baked|plain:]) -> |type:Int|plain: {");
  assert.equal(line("for await item"), "plain:    |keyword:for|plain: |keyword:await|plain: item |keyword:in|plain: stream {");

  // Closure arguments and key paths are plain.
  assert.equal(line("trays.map { $0.name }"), "plain:        |keyword:let|plain: names = trays.map { $0.name }");
  assert.equal(line("$0.heat < $1.heat"), "plain:        |keyword:let|plain: sorted = trays.sorted { $0.heat < $1.heat }");
  assert.equal(line("map(\\.name)"), "plain:        |keyword:return|plain: names + sorted.map(\\.name)");

  // Backtick names are plain, and a keyword after a dot is a name.
  assert.equal(line("func `class`"), "keyword:func|plain: `class`(_ value: |type:Int|plain:) -> |type:Int|plain: {");
  assert.equal(line("case .some(let count)"), "plain:    |keyword:case|plain: .some(|keyword:let|plain: count) |keyword:where|plain: count > |number:1|plain::");
  assert.equal(line("case .none:"), "plain:    |keyword:case|plain: .none:");
  assert.equal(line("default:"), "plain:    |keyword:default|plain::");

  // Strings: interpolation, nested strings and brackets, and escapes.
  assert.equal(line("Oven number"), 'plain:    |keyword:lazy|plain: |keyword:var|plain: label: |type:String|plain: = |string:"Oven number |plain:\\(trays.count)|string:"');
  assert.equal(line("let plain"), 'plain:    |keyword:let|plain: plain = |string:"Hello, |plain:\\(name)|string:!"');
  assert.equal(
    line("let nested"),
    'plain:    |keyword:let|plain: nested = |string:"Total: |plain:\\(names.map { |string:"<|plain:\\($0)|string:>"|plain: }.joined(separator: |string:", "|plain:))|string: done"',
    "a string inside \\( ) inside a string",
  );
  assert.equal(
    line("let math"),
    'plain:    |keyword:let|plain: math = |string:"Sum: |plain:\\((|number:1|plain: + |number:2|plain:) * |number:3|plain:)|string: and |plain:\\(max(|number:1|plain:, |number:2|plain:))|string:"',
    "brackets inside \\( ) do not end it early",
  );
  assert.equal(
    line("let escapes"),
    'plain:    |keyword:let|plain: escapes = |string:"tab\\t quote\\" slash\\\\ unicode\\u{1F600} backslash-paren \\\\(not code)"',
    "\\\\( is an escaped backslash, not code",
  );

  // Multi-line strings: lines in the middle, interpolation, quotes, and a backslash at the end of a line.
  assert.equal(line("let multi"), 'plain:    |keyword:let|plain: multi = |string:"""');
  assert.equal(line("Line one with"), "string:        Line one with |plain:\\(name)");
  assert.equal(line("Line two with"), 'string:        Line two with "quotes" and ""double"" quotes');
  assert.equal(line("A \\"), "string:        A \\");
  assert.equal(line("continued line"), "string:        continued line");
  assert.equal(line("a \\\"\"\" is escaped"), 'string:        a \\""" is escaped');

  // Raw strings: \( is plain text, \#( is code, and the closing quote needs the same number of #.
  assert.equal(
    line("let raw = #"),
    'plain:    |keyword:let|plain: raw = |string:#"raw \\(not code) and |plain:\\#(name)|string: and "quotes""#',
  );
  assert.equal(
    line("let raw2"),
    'plain:    |keyword:let|plain: raw2 = |string:##"two hashes "# still raw |plain:\\##(name)|string:"##',
  );
  assert.equal(line("let rawMulti"), 'plain:    |keyword:let|plain: rawMulti = |string:#"""');
  assert.equal(line("raw block"), "string:        raw block \\(literal)");
  assert.equal(line('"""#'), 'string:        """#');
  assert.equal(line("let escapedQuotes"), 'plain:    |keyword:let|plain: escapedQuotes = |string:"""');

  // Other statements.
  assert.equal(line("catch let error"), "plain:    } |keyword:catch|plain: |keyword:let|plain: error |keyword:as|plain: |type:NSError|plain: {");
  assert.equal(line("outer: for"), "plain:    outer: |keyword:for|plain: i |keyword:in|plain: |number:0|plain:..<|number:3|plain: {");
  assert.equal(line("guard let first"), "plain:    |keyword:guard|plain: |keyword:let|plain: first = |type:Optional|plain:(|number:1|plain:) |keyword:else|plain: { |keyword:return|plain: }");
});

test("tokenizer: Swift tricky cases", () => {
  // Every token as kind:text, joined with |, and a " // " marks the start of a new line.
  const kinds = (source: string): string => tokenizeSwift(source).map((l) => l.map((t) => `${t.kind}:${t.text}`).join("|")).join(" // ");

  // Comments nest, and an unclosed one runs to the end.
  assert.equal(kinds("/* a /* b */ c */ let x"), "comment:/* a /* b */ c */|plain: |keyword:let|plain: x");
  assert.equal(kinds("/* a /* b */ let x"), "comment:/* a /* b */ let x", "one level is still open");
  assert.equal(kinds("/// doc // not\nx"), "comment:/// doc // not // plain:x");
  assert.equal(kinds("x #! y"), "plain:x #! y", "#! only counts on the very first line");
  assert.equal(kinds("// ends with dot.\nfunc a() {}"), "comment:// ends with dot. // keyword:func|plain: a() {}");

  // Strings and interpolation.
  assert.equal(kinds('"a \\(b) c"'), 'string:"a |plain:\\(b)|string: c"');
  assert.equal(kinds('"a \\(b + (c * 2)) d"'), 'string:"a |plain:\\(b + (c * |number:2|plain:))|string: d"');
  assert.equal(kinds('"a \\(f(")")) d"'), 'string:"a |plain:\\(f(|string:")"|plain:))|string: d"', "a ) inside a string inside \\( ) does not close it");
  assert.equal(kinds('"x \\("y \\(z) w") v"'), 'string:"x |plain:\\(|string:"y |plain:\\(z)|string: w"|plain:)|string: v"', "interpolation inside interpolation");
  assert.equal(kinds('"no end\nlet x'), 'string:"no end // keyword:let|plain: x', "a string ends at the line end");
  assert.equal(kinds('"a \\(b" c'), 'string:"a \\(b"|plain: c', "a \\( that never closes is text");
  assert.equal(kinds('"\\\\(a) \\" \\(b)"'), 'string:"\\\\(a) \\" |plain:\\(b)|string:"', "an escaped backslash before ( is not code");
  assert.equal(kinds('"" + ""'), 'string:""|plain: + |string:""', "empty strings");
  assert.equal(kinds('"a\\\nlet x'), 'string:"a\\ // keyword:let|plain: x', "a backslash at the end of a single-line string does not join lines");

  // Multi-line strings.
  assert.equal(kinds('"""a \\(b) "c" ""d""" x'), 'string:"""a |plain:\\(b)|string: "c" ""d"""|plain: x', "quotes inside, closed by the first three");
  assert.equal(kinds('"""\nno end'), 'string:""" // string:no end', "an unclosed multi-line string runs to the end");
  assert.equal(kinds('""" \\(\n a\n) """ x'), 'string:""" |plain:\\( // plain: a // plain:)|string: """|plain: x', "interpolation in a multi-line string can span lines");
  assert.equal(kinds('"""\n  a \\"""b\n  """ x'), 'string:""" // string:  a \\"""b // string:  """|plain: x', "an escaped quote does not close it");

  // Raw strings.
  assert.equal(kinds('#"a \\(b) \\#(c) "d""# x'), 'string:#"a \\(b) |plain:\\#(c)|string: "d""#|plain: x');
  assert.equal(kinds('##"a "# \\#(b) \\##(c)"## x'), 'string:##"a "# \\#(b) |plain:\\##(c)|string:"##|plain: x', "only the matching number of # counts");
  assert.equal(kinds('#"""\n a \\(b) \\#n """# x'), 'string:#""" // string: a \\(b) \\#n """#|plain: x');
  assert.equal(kinds('#"no end\nlet x'), 'string:#"no end // keyword:let|plain: x', "a raw string ends at the line end");
  assert.equal(kinds('#"\\"#'), 'string:#"\\"#', "a backslash is plain text in a raw string");

  // Directives and attributes.
  assert.equal(kinds("#x #if #available(iOS 15, *)"), "preprocessor:#x|plain: |preprocessor:#if|plain: |preprocessor:#available|plain:(iOS |number:15|plain:, *)");
  assert.equal(kinds("##a"), "plain:#|preprocessor:#a");
  assert.equal(kinds("@available(iOS 15, *) @objc(foo) @Foo.Bar @ @_x @"), "preprocessor:@available|plain:(iOS |number:15|plain:, *) |preprocessor:@objc|plain:(foo) |preprocessor:@Foo.Bar|plain: @ |preprocessor:@_x|plain: @");

  // Backtick names and $ names.
  assert.equal(kinds("`class` `a b`() `no end\nlet x"), "plain:`class` `a b`() `no end // keyword:let|plain: x");
  assert.equal(kinds("$0 $1.name $name $"), "plain:$0 $1.name $name $", "the digits of $0 are not a number");

  // Numbers.
  assert.equal(
    kinds("0x1p3 0xFF.description 0x1.8p-2 1e3 1E+3 1.5.rounded() 1...2 1..<2 0b1_0 0o17 3.0"),
    "number:0x1p3|plain: |number:0xFF|plain:.description |number:0x1.8p-2|plain: |number:1e3|plain: |number:1E+3|plain: |number:1.5|plain:.rounded() |number:1|plain:...|number:2|plain: |number:1|plain:..<|number:2|plain: |number:0b1_0|plain: |number:0o17|plain: |number:3.0",
  );
  assert.equal(kinds("t.0.1 a.1"), "plain:t.|number:0|plain:.|number:1|plain: a.|number:1", "tuple positions after a dot");

  // Contextual words are plain unless they work as keywords.
  assert.equal(
    kinds("let get = 1\nvar x: Int { get }\nvar y: Int { get set }\nx.get(1); get(2)"),
    "keyword:let|plain: get = |number:1 // keyword:var|plain: x: |type:Int|plain: { |keyword:get|plain: } // keyword:var|plain: y: |type:Int|plain: { |keyword:get|plain: |keyword:set|plain: } // plain:x.get(|number:1|plain:); get(|number:2|plain:)",
  );
  assert.equal(
    kinds("var a: Int { mutating get async throws }"),
    "keyword:var|plain: a: |type:Int|plain: { |keyword:mutating|plain: |keyword:get|plain: |keyword:async|plain: |keyword:throws|plain: }",
  );
  assert.equal(
    kinds("var z = 0 { willSet(v) { } didSet { } }\nobj.didSet { }"),
    "keyword:var|plain: z = |number:0|plain: { |keyword:willSet|plain:(v) { } |keyword:didSet|plain: { } } // plain:obj.didSet { }",
  );
  assert.equal(
    kinds("private(set) var a; public private(set) var b; let set = 1"),
    "keyword:private|plain:(|keyword:set|plain:) |keyword:var|plain: a; |keyword:public|plain: |keyword:private|plain:(|keyword:set|plain:) |keyword:var|plain: b; |keyword:let|plain: set = |number:1",
  );
  assert.equal(
    kinds("let some = 1; x as? any P; func f() -> some View; let s: [any Q]; some(1)"),
    "keyword:let|plain: some = |number:1|plain:; x |keyword:as|plain:? |keyword:any|plain: |type:P|plain:; |keyword:func|plain: f() -> |keyword:some|plain: |type:View|plain:; |keyword:let|plain: s: [|keyword:any|plain: |type:Q|plain:]; some(|number:1|plain:)",
  );
  assert.equal(
    kinds("func f() async {}; func g() async throws -> Int; let t: () async -> Void; async let a = 1; async(1)"),
    "keyword:func|plain: f() |keyword:async|plain: {}; |keyword:func|plain: g() |keyword:async|plain: |keyword:throws|plain: -> |type:Int|plain:; |keyword:let|plain: t: () |keyword:async|plain: -> |type:Void|plain:; |keyword:async|plain: |keyword:let|plain: a = |number:1|plain:; async(|number:1|plain:)",
  );
  assert.equal(
    kinds("await foo(); await in; for await x in y {}; await(1); let await = 1; self.await"),
    "keyword:await|plain: foo(); await |keyword:in|plain:; |keyword:for|plain: |keyword:await|plain: x |keyword:in|plain: y {}; |keyword:await|plain:(|number:1|plain:); |keyword:let|plain: await = |number:1|plain:; |keyword:self|plain:.await",
  );
  assert.equal(
    kinds("actor A {}; distributed actor B: C {}; for actor in actors {}; let actor = 1; actor.run()"),
    "keyword:actor|plain: |type:A|plain: {}; |keyword:distributed|plain: |keyword:actor|plain: |type:B|plain:: |type:C|plain: {}; |keyword:for|plain: actor |keyword:in|plain: actors {}; |keyword:let|plain: actor = |number:1|plain:; actor.run()",
  );
  assert.equal(
    kinds("final class A { lazy var x = 1; weak var y: B?; unowned(unsafe) let z: C; open func f() {}; let open = 1; override init() {} }"),
    "keyword:final|plain: |keyword:class|plain: |type:A|plain: { |keyword:lazy|plain: |keyword:var|plain: x = |number:1|plain:; |keyword:weak|plain: |keyword:var|plain: y: |type:B|plain:?; |keyword:unowned|plain:(unsafe) |keyword:let|plain: z: |type:C|plain:; |keyword:open|plain: |keyword:func|plain: f() {}; |keyword:let|plain: open = |number:1|plain:; |keyword:override|plain: |keyword:init|plain:() {} }",
  );
  assert.equal(
    kinds("func f(isolated a: MyActor, consuming b: Loaf) {}; let each = 1"),
    "keyword:func|plain: f(|keyword:isolated|plain: a: |type:MyActor|plain:, |keyword:consuming|plain: b: |type:Loaf|plain:) {}; |keyword:let|plain: each = |number:1",
  );

  // Keywords after a dot are names, except self and init. Ranges are not member access.
  assert.equal(
    kinds(".default .none x.in x.class x.self x.init Foo.Type 1...self"),
    "plain:.default .none x.in x.class x.|keyword:self|plain: x.|keyword:init|plain: |type:Foo|plain:.|type:Type|plain: |number:1|plain:...|keyword:self",
  );
  assert.equal(kinds("a...b; a..<b"), "plain:a...b; a..<b");

  // Types are capitalised names, and operators stay plain.
  assert.equal(kinds("HTTP URL _Foo t"), "type:HTTP|plain: |type:URL|plain: _Foo t");
  assert.equal(kinds("x ?? y ?.z !.w -> a === b"), "plain:x ?? y ?.z !.w -> a === b");
  assert.equal(kinds('中文 "é" 😀'), 'plain:中文 |string:"é"|plain: 😀');

  // Unusual text never gets lost or changed, and deep nesting does not crash.
  for (const source of ["", '"', "#", '#"', '##"', '"""', '#"""', '"\\(', '"\\(a', '"\\("', '"\\', "/*", "/* /*", "/* /* */", "/", "@", "@a.", "`", "0x", "0b", "0o", "1e", "1e+", "1.", "1..", "$", "#!", "0x1.", "0x1.8", "中文 '中' \"é\" 😀", "a\r\nb", '"""\r\n\\(\r\n)"""']) {
    assert.equal(tokenizeSwift(source).map(joinLine).join("\n"), source, JSON.stringify(source));
  }
  const deep = '"\\('.repeat(100) + "x" + ')"'.repeat(100);
  assert.equal(tokenizeSwift(deep).map(joinLine).join("\n"), deep, "100 levels of interpolation");
  const deepComment = "/*".repeat(200) + "*/".repeat(200) + " let x";
  assert.equal(kinds(deepComment), `comment:${"/*".repeat(200)}${"*/".repeat(200)}|plain: |keyword:let|plain: x`, "200 nested comments");
});

test("tokenizer: Ruby comments, strings, symbols, heredocs, numbers and keywords", () => {
  const source = fixture("basic.rb");
  const sourceLines = source.split("\n");
  const rb = tokenizeRuby(source);
  assert.equal(rb.length, sourceLines.length, "one token line per source line");
  // One source line as kind:text pieces joined with |, found by a piece of its text.
  const line = (text: string): string => {
    const index = sourceLines.findIndex((l) => l.includes(text));
    assert.ok(index !== -1, `no line with ${text}`);
    return rb[index]!.map((t) => `${t.kind}:${t.text}`).join("|");
  };
  // The same, but for the line that is exactly this text (a heredoc tag, for example).
  const exact = (text: string): string => {
    const index = sourceLines.findIndex((l) => l === text);
    assert.ok(index !== -1, `no line that is ${text}`);
    return rb[index]!.map((t) => `${t.kind}:${t.text}`).join("|");
  };

  // Comments: the script line, line comments, and =begin / =end.
  assert.equal(line("#!/usr/bin/env"), "comment:#!/usr/bin/env ruby");
  assert.equal(line("frozen_string_literal"), "comment:# frozen_string_literal: true");
  assert.equal(kindOf(rb, "stay comments"), "comment", "words, quotes and #{} inside a comment");
  assert.equal(exact("=begin"), "comment:=begin");
  assert.equal(line("This block comment"), 'comment:This block comment says def and end and "quotes",');
  assert.equal(exact("=end"), "comment:=end");
  assert.equal(line("this is data"), 'comment:this is data, not code: def class end "quotes"', "after __END__");
  assert.equal(exact("__END__"), "keyword:__END__");

  // Numbers: separators, hex, binary, octal, floats, rationals, and ranges.
  assert.equal(line("MAX_LOAVES"), "type:MAX_LOAVES|plain: = |number:1_000");
  assert.equal(line("MASK ="), "type:MASK|plain: = |number:0xFF_FF");
  assert.equal(line("FLAGS ="), "type:FLAGS|plain: = |number:0b1010");
  assert.equal(line("MODE ="), "type:MODE|plain: = |number:0o755");
  assert.equal(line("RATIO ="), "type:RATIO|plain: = |number:1.5e-3");
  assert.equal(line("HALF ="), "type:HALF|plain: = |number:2.5");
  assert.equal(line("TWO_THIRDS"), "type:TWO_THIRDS|plain: = |number:2r");
  assert.equal(line("SPAN ="), "type:SPAN|plain: = (|number:1|plain:..|number:10|plain:)", "1..10 is two numbers and a range");
  assert.equal(line("OPEN_SPAN"), "type:OPEN_SPAN|plain: = (|number:1|plain:...|number:5|plain:)");

  // Declarations, constants and variables.
  assert.equal(line("require \"set\""), 'keyword:require|plain: |string:"set"');
  assert.equal(line("module Bakery"), "keyword:module|plain: |type:Bakery");
  assert.equal(line("VERSION ="), 'plain:  |type:VERSION|plain: = |string:"1.0"');
  assert.equal(line("class Loaf"), "plain:  |keyword:class|plain: |type:Loaf");
  assert.equal(line("include Comparable"), "plain:    |keyword:include|plain: |type:Comparable");
  assert.equal(line("attr_accessor"), "plain:    |keyword:attr_accessor|plain: |number::name|plain:, |number::slices");
  assert.equal(line("@@count = 0"), "plain:    |type:@@count|plain: = |number:0");
  assert.equal(line("@@count += 1"), "plain:      |type:@@count|plain: += |number:1");
  assert.equal(line("$last_loaf"), "plain:      |type:$last_loaf|plain: = |keyword:self");
  assert.equal(line("@slices.zero?"), "plain:      |type:@slices|plain:.zero?");

  // Method definitions: names, operators, setters, and a keyword used as a name.
  assert.equal(
    line("def initialize"),
    "plain:    |keyword:def|plain: initialize(name, |number:slices:|plain: |number:8|plain:, |number:heat:|plain: |number::medium|plain:)",
    "labels and a symbol value",
  );
  assert.equal(line("def self.count"), "plain:    |keyword:def|plain: |keyword:self|plain:.count");
  assert.equal(line("def empty?"), "plain:    |keyword:def|plain: empty?");
  assert.equal(line("def eat!"), "plain:    |keyword:def|plain: eat!(amount = |number:1|plain:)");
  assert.equal(line("def name="), "plain:    |keyword:def|plain: name=(value)");
  assert.equal(line("def <=>"), "plain:    |keyword:def|plain: <=>(other)");
  assert.equal(line("def +("), "plain:    |keyword:def|plain: +(other)");
  assert.equal(line("def end"), "plain:    |keyword:def|plain: end", "a method named end");
  assert.equal(line("a method named end"), 'plain:      |string:"a method named end"');
  assert.equal(line("slices <=> other.slices"), "plain:      slices <=> other.slices");

  // Strings and interpolation, including a nested string and braces.
  assert.equal(
    line("Loaf.new("),
    'plain:      |type:Loaf|plain:.new(|string:"|plain:#{name}|string: and |plain:#{other.name}|string:"|plain:, |number:slices:|plain: slices + other.slices)',
  );
  assert.equal(
    line("(#{@slices}"),
    'plain:      |string:"|plain:#{|type:@name|plain:}|string: (|plain:#{|type:@slices|plain:}|string: slices, |plain:#{empty? ? |string:"gone"|plain: : |string:"fresh"|plain:}|string:)"',
    "a string inside #{ } inside a string",
  );
  assert.equal(line("kind = :sourdough"), "plain:kind = |number::sourdough");
  assert.equal(line("quoted ="), 'plain:quoted = |string::"two words"');
  assert.equal(line("op = :+"), "plain:op = |number::+");
  assert.equal(line("single #{not code}"), "plain:plain = |string:'single #{not code} and a \\' quote'", "no interpolation in single quotes");
  assert.equal(
    line("double with"),
    'plain:double = |string:"double with |plain:#{kind}|string: and |plain:#{{ |number:a:|plain: |number:1|plain: }.map { |k, v| |string:"|plain:#{k}|string:=|plain:#{v}|string:"|plain: }.join(|string:","|plain:)}|string: inside"',
    "braces and a string inside #{ }",
  );
  assert.equal(
    line("escaped ="),
    'plain:escaped = |string:"tab\\t quote\\" slash\\\\ |plain:#{|string:\'nested\'|plain:}|string:"',
  );

  // % literals.
  assert.equal(line("words = %w"), "plain:words = |string:%w[rye wheat spelt]");
  assert.equal(line("symbols = %i"), "plain:symbols = |string:%i(a b c)");
  assert.equal(line("literal = %q"), "plain:literal = |string:%q{single {nested} braces}");
  assert.equal(line("fancy = %Q"), "plain:fancy = |string:%Q<angle <nested> |plain:#{kind}|string:>");
  assert.equal(line("bare = %("), "plain:bare = |string:%(parens (nested) work |plain:#{|number:1|plain: + |number:2|plain:}|string:)");

  // Heredocs: the tag, the body, the terminator, and what comes after the tag.
  assert.equal(line("text = <<~NOTE"), "plain:text = |string:<<~NOTE");
  assert.equal(line("Today's bake"), "string:  Today's bake: #{kind}");
  assert.equal(line("The word end"), "string:  The word end and \"quotes\" and 'quotes' are string text here.");
  assert.equal(exact("NOTE"), "string:NOTE");
  assert.equal(line("dashed ="), "plain:dashed = |string:<<-SQL|plain:.strip");
  assert.equal(line("SELECT * FROM"), "string:    SELECT * FROM loaves");
  assert.equal(exact("    SQL"), "string:    SQL", "an indented terminator");
  assert.equal(line("plain_heredoc"), "plain:plain_heredoc = |string:<<EOS");
  assert.equal(line("no indent"), "string:no indent, tag at the start");
  assert.equal(exact("EOS"), "string:EOS");
  assert.equal(line("raw = <<~"), "plain:raw = |string:<<~'RAW'");
  assert.equal(line("nothing #{special}"), "string:  nothing #{special} here");
  assert.equal(line("shifted ="), 'plain:shifted = words << |string:"rye"', "a << b is a shift");
  assert.equal(line("bits ="), "plain:bits = |number:1|plain:<<|number:4", "x<<1 is a shift");
  assert.equal(line("words2"), "plain:words2 = [|number:1|plain:, |number:2|plain:] << |number:3");

  // Division, modulo and regexes.
  assert.equal(line("half ="), "plain:half = |number:10|plain: / |number:2");
  assert.equal(line("rest ="), "plain:rest = |number:10|plain: % |number:3");
  assert.equal(
    line("puts :a.to_proc"),
    'keyword:puts|plain: |number::a|plain:.to_proc.call(|string:"x"|plain:) |keyword:if|plain: loaf.name =~ |string:/ry+e/i',
  );
  assert.equal(line("pattern ="), "plain:pattern = |string:%r{^/path/(\\d+)$}x");
  assert.equal(line("matches ="), 'plain:matches = |string:"a/b"|plain:.split(|string:/\\//|plain:)');
  assert.equal(line("total ="), "plain:total = (|number:1|plain:..|number:10|plain:).reduce(|number:0|plain:) { |sum, n| sum + n / |number:2|plain: }");

  // Statements and method names ending in ? or !.
  assert.equal(line("Bakery::Loaf.new"), 'plain:loaf = |type:Bakery|plain:::|type:Loaf|plain:.new(|string:"rye"|plain:, |number:slices:|plain: |number:6|plain:)');
  assert.equal(line("puts loaf.empty?"), 'keyword:puts|plain: loaf.empty? ? |string:"gone"|plain: : |string:"still here"');
  assert.equal(line("when 0 then"), 'keyword:when|plain: |number:0|plain: |keyword:then|plain: |keyword:puts|plain: |string:"none"');
  assert.equal(line("when 1..3"), 'keyword:when|plain: |number:1|plain:..|number:3|plain: |keyword:then|plain: |keyword:puts|plain: |string:"few"');
  assert.equal(line("else puts"), 'keyword:else|plain: |keyword:puts|plain: |string:"plenty"');
  assert.equal(line("raise ArgumentError"), 'plain:  |keyword:raise|plain: |type:ArgumentError|plain:, |string:"bad"|plain: |keyword:unless|plain: loaf.slices.positive?');
  assert.equal(line("rescue ArgumentError"), "keyword:rescue|plain: |type:ArgumentError|plain: => e");
  assert.equal(line("ensure"), "keyword:ensure");
  assert.equal(line("sorted ="), "plain:sorted = [|number:3|plain:, |number:1|plain:, |number:2|plain:].sort_by { |x| -x }.map(&|number::to_s|plain:)");
  assert.equal(
    line("config ="),
    'plain:config = { |number:name:|plain: |string:"rye"|plain:, |string:"key"|plain: => |number:1|plain:, |number::old|plain: => |number:2|plain:, |number:nested:|plain: { |number:deep:|plain: |keyword:true|plain: } }',
    "labels, symbols and string keys",
  );
  assert.equal(line("char ="), "plain:char = |string:?a", "a character literal");
  assert.equal(line("count = defined?"), "plain:count = |keyword:defined?|plain:(loaf) ? loaf.slices : |number:0");
});

test("tokenizer: Ruby tricky cases", () => {
  // Every token as kind:text, joined with |, and a " // " marks the start of a new line.
  const kinds = (source: string): string => tokenizeRuby(source).map((l) => l.map((t) => `${t.kind}:${t.text}`).join("|")).join(" // ");

  // Comments: =begin only counts at the start of a line, and =end must be followed by a space or the end of the line.
  assert.equal(kinds("a # b\nc"), "plain:a |comment:# b // plain:c");
  assert.equal(kinds("=begin\nfoo\n=end\nx"), "comment:=begin // comment:foo // comment:=end // plain:x");
  assert.equal(kinds("=begin\n=endx\n=end"), "comment:=begin // comment:=endx // comment:=end");
  assert.equal(kinds("=begin\nnever closed"), "comment:=begin // comment:never closed");
  assert.equal(kinds("=begin comment text\n=end trailing words\nx"), "comment:=begin comment text // comment:=end trailing words // plain:x");
  assert.equal(kinds("x = 1 =begin"), "plain:x = |number:1|plain: =|keyword:begin");
  assert.equal(kinds("  =begin\nx"), "plain:  =|keyword:begin // plain:x");
  assert.equal(kinds("=beginner"), "plain:=beginner");
  assert.equal(kinds("__END__\nx = 1"), "keyword:__END__ // comment:x = 1");
  assert.equal(kinds("__END__x"), "plain:__END__x");

  // Single and double quotes.
  assert.equal(kinds("'a #{b}'"), "string:'a #{b}'");
  assert.equal(kinds("'it\\'s' x"), "string:'it\\'s'|plain: x");
  assert.equal(kinds('"a #{b + "c #{d}"} e"'), 'string:"a |plain:#{b + |string:"c |plain:#{d}|string:"|plain:}|string: e"');
  assert.equal(kinds('"#{h.map { |k| k }}"'), 'string:"|plain:#{h.map { |k| k }}|string:"');
  assert.equal(kinds('"a\\"b" x'), 'string:"a\\"b"|plain: x');
  assert.equal(kinds('"a\nb" x'), 'string:"a // string:b"|plain: x', "a string can span lines");
  assert.equal(kinds('"unclosed'), 'string:"unclosed');
  assert.equal(kinds('"a #{b'), 'string:"a |plain:#{b');
  assert.equal(kinds("`ls #{dir}`"), "string:`ls |plain:#{dir}|string:`");

  // Heredocs.
  assert.equal(kinds("puts <<~EOS\n  hi\nEOS\nputs 1"), "keyword:puts|plain: |string:<<~EOS // string:  hi // string:EOS // keyword:puts|plain: |number:1");
  assert.equal(kinds("x = <<-EOS\n  hi\n  EOS\ny"), "plain:x = |string:<<-EOS // string:  hi // string:  EOS // plain:y");
  assert.equal(kinds("x = <<EOS\n  EOS\nEOS\ny"), "plain:x = |string:<<EOS // string:  EOS // string:EOS // plain:y", "a bare tag must start the line");
  assert.equal(kinds('x = <<~"EOS"\n#{a}\nEOS'), 'plain:x = |string:<<~"EOS" // string:#{a} // string:EOS');
  assert.equal(
    kinds("foo(<<~A, <<~B)\n  a\nA\n  b\nB\nbar"),
    "plain:foo(|string:<<~A|plain:, |string:<<~B|plain:) // string:  a // string:A // string:  b // string:B // plain:bar",
    "two heredocs on one line",
  );
  assert.equal(kinds("x = a <<~EOS"), "plain:x = a <<~|type:EOS", "no terminator line, so not a heredoc");
  assert.equal(kinds("x = <<~EOS\nfoo"), "plain:x = <<~|type:EOS // plain:foo");
  assert.equal(kinds("a << b"), "plain:a << b");
  assert.equal(kinds("x<<1"), "plain:x<<|number:1");
  assert.equal(kinds("(a)<<EOS\nEOS"), "plain:(a)<<|type:EOS // type:EOS", "after a bracket it is a shift");
  assert.equal(kinds("class << self\nend"), "keyword:class|plain: << |keyword:self // keyword:end");
  assert.equal(kinds("list <<VALUE"), "plain:list <<|type:VALUE");

  // Symbols, labels and ternaries.
  assert.equal(kinds(":a :b? :c! :d= :@e :$f"), "number::a|plain: |number::b?|plain: |number::c!|plain: |number::d=|plain: |number::@e|plain: |number::$f");
  assert.equal(kinds(":a=>1"), "number::a|plain:=>|number:1");
  assert.equal(kinds(':"q #{x}" :\'s\''), 'string::"q |plain:#{x}|string:"|plain: |string::\'s\'');
  assert.equal(kinds(":+ :<=> :[] :== :!"), "number::+|plain: |number::<=>|plain: |number::[]|plain: |number::==|plain: |number::!");
  assert.equal(kinds("a ? b : c"), "plain:a ? b : c");
  assert.equal(kinds("a ?b:c"), "plain:a ?b:c");
  assert.equal(kinds("puts(x ? 1:2)"), "keyword:puts|plain:(x ? |number:1|plain::|number:2|plain:)");
  assert.equal(kinds("{a:1, b: 2}"), "plain:{a:|number:1|plain:, |number:b:|plain: |number:2|plain:}");
  assert.equal(kinds("Foo::Bar"), "type:Foo|plain:::|type:Bar");
  assert.equal(kinds("x::y"), "plain:x::y");
  assert.equal(kinds("puts(a::B)"), "keyword:puts|plain:(a::|type:B|plain:)");
  assert.equal(kinds("f(if: 1, end: 2)"), "plain:f(|number:if:|plain: |number:1|plain:, |number:end:|plain: |number:2|plain:)");
  assert.equal(kinds("valid?: true"), "number:valid?:|plain: |keyword:true");

  // Variables.
  assert.equal(kinds("@a @@b $c $1 $! $stdout @"), "type:@a|plain: |type:@@b|plain: |type:$c|plain: |type:$1|plain: |type:$!|plain: |type:$stdout|plain: @");

  // Numbers.
  assert.equal(
    kinds("1..10 1...3 1.5 1.times 3.14e2 1_000_000 0x1F 5r 2i 1e3"),
    "number:1|plain:..|number:10|plain: |number:1|plain:...|number:3|plain: |number:1.5|plain: |number:1|plain:.times |number:3.14e2|plain: |number:1_000_000|plain: |number:0x1F|plain: |number:5r|plain: |number:2i|plain: |number:1e3",
  );

  // Regex or division.
  assert.equal(kinds("a / b"), "plain:a / b");
  assert.equal(kinds("n / 2 / 3"), "plain:n / |number:2|plain: / |number:3");
  assert.equal(kinds("(a) / 2"), "plain:(a) / |number:2");
  assert.equal(kinds("x /= 2"), "plain:x /= |number:2");
  assert.equal(kinds("x = /ab+c/i"), "plain:x = |string:/ab+c/i");
  assert.equal(kinds("if /x/ =~ s"), "keyword:if|plain: |string:/x/|plain: =~ s");
  assert.equal(kinds("when /a#{b}c/"), "keyword:when|plain: |string:/a|plain:#{b}|string:c/");
  assert.equal(kinds("str.split /,/"), "plain:str.split |string:/,/", "a regex given to a method without brackets");
  assert.equal(kinds("a /b"), "plain:a /b", "no closing slash, so it is division");
  assert.equal(kinds("/a/\nx / 2"), "string:/a/ // plain:x / |number:2");

  // % literals or modulo.
  assert.equal(kinds("10 % 3"), "number:10|plain: % |number:3");
  assert.equal(kinds("a %= 2"), "plain:a %= |number:2");
  assert.equal(kinds('"%05d" % [3]'), 'string:"%05d"|plain: % [|number:3|plain:]');
  assert.equal(kinds("puts %w[a b]"), "keyword:puts|plain: |string:%w[a b]");
  assert.equal(kinds("x %w[a]"), "plain:x |string:%w[a]");
  assert.equal(kinds("x % (y)"), "plain:x % (y)");
  assert.equal(kinds("%w(a (b) c) + x"), "string:%w(a (b) c)|plain: + x");
  assert.equal(kinds("%r{a}i"), "string:%r{a}i");
  assert.equal(kinds("x = %Q|a #{b}|"), "plain:x = |string:%Q|a |plain:#{b}|string:|");
  assert.equal(kinds("%q(it's)"), "string:%q(it's)");
  assert.equal(kinds("%w[a #{b}]"), "string:%w[a #{b}]", "no interpolation in %w");

  // Character literals and ternaries.
  assert.equal(kinds("c == ?a"), "plain:c == |string:?a");
  assert.equal(kinds("x = ?\\n"), "plain:x = |string:?\\n");
  assert.equal(kinds("x ? 1 : 2"), "plain:x ? |number:1|plain: : |number:2");
  assert.equal(kinds("x = ?\""), 'plain:x = |string:?"', "a quote character does not start a string");

  // Keywords and method names.
  assert.equal(kinds("x.class x.end self.then"), "plain:x.class x.end |keyword:self|plain:.then");
  assert.equal(kinds("a&.b"), "plain:a&.b");
  assert.equal(kinds("def class; end"), "keyword:def|plain: class; |keyword:end");
  assert.equal(kinds("def ==(o); end"), "keyword:def|plain: ==(o); |keyword:end");
  assert.equal(kinds("def self.[](i)"), "keyword:def|plain: |keyword:self|plain:.[](i)");
  assert.equal(kinds("def Foo.bar"), "keyword:def|plain: |type:Foo|plain:.bar");
  assert.equal(kinds("def /(o)\n1 / 2\nend"), "keyword:def|plain: /(o) // number:1|plain: / |number:2 // keyword:end", "def / is a method name, not a regex");
  assert.equal(kinds("def foo = 1"), "keyword:def|plain: foo = |number:1");
  assert.equal(kinds("empty? !x != y a!=b"), "plain:empty? !x != y a!=b");
  assert.equal(kinds("puts = 1; print == 2"), "plain:puts = |number:1|plain:; |keyword:print|plain: == |number:2");
  assert.equal(kinds("Integer(x) HTTP _foo Élan"), "type:Integer|plain:(x) |type:HTTP|plain: _foo |type:Élan");
  assert.equal(kinds("if x then y elsif z else w end"), "keyword:if|plain: x |keyword:then|plain: y |keyword:elsif|plain: z |keyword:else|plain: w |keyword:end");
  assert.equal(kinds("defined?(x) defined? y"), "keyword:defined?|plain:(x) |keyword:defined?|plain: y");
  assert.equal(kinds('中文 "é" 😀'), 'plain:中文 |string:"é"|plain: 😀');

  // A mix of everyday lines, checked as whole lines.
  assert.equal(kinds("x = a << b"), "plain:x = a << b");
  assert.equal(kinds("y = x<<1"), "plain:y = x<<|number:1");
  assert.equal(
    kinds('s = "hi #{ {a: "b"}[:a] } there"'),
    'plain:s = |string:"hi |plain:#{ {|number:a:|plain: |string:"b"|plain:}[|number::a|plain:] }|string: there"',
    "the outer string carries on after the closing brace",
  );
  assert.equal(kinds('h = { key: 1, "k" => :sym }'), 'plain:h = { |number:key:|plain: |number:1|plain:, |string:"k"|plain: => |number::sym|plain: }');
  assert.equal(kinds("Foo::Bar.baz"), "type:Foo|plain:::|type:Bar|plain:.baz");
  assert.equal(kinds("c = ok ? :yes : :no"), "plain:c = ok ? |number::yes|plain: : |number::no");
  assert.equal(kinds("r = (1..10).to_a"), "plain:r = (|number:1|plain:..|number:10|plain:).to_a");
  assert.equal(kinds("v = 1_000 / 2 / 3"), "plain:v = |number:1_000|plain: / |number:2|plain: / |number:3");
  assert.equal(kinds("%w[a b [c]]"), "string:%w[a b [c]]");
  assert.equal(kinds("def empty?; @x.nil? || $y; end"), "keyword:def|plain: empty?; |type:@x|plain:.nil? || |type:$y|plain:; |keyword:end");
  assert.equal(kinds("text = <<~EOS\n  #{x} body\nEOS\nputs 1"), "plain:text = |string:<<~EOS // string:  #{x} body // string:EOS // keyword:puts|plain: |number:1");
  assert.equal(kinds("=begin\nnot code\n=end\nz = 1"), "comment:=begin // comment:not code // comment:=end // plain:z = |number:1");
  assert.equal(kinds("n = 10 % 3"), "plain:n = |number:10|plain: % |number:3");
  assert.equal(kinds("p x.class"), "plain:p x.class");
  assert.equal(kinds("arr.map { |e| e * 2 } # done"), "plain:arr.map { |e| e * |number:2|plain: } |comment:# done");

  // Unusual text never gets lost or changed, and deep nesting does not crash.
  for (const source of [
    "", '"', "'", "`", "%", "%w[", "%q(", "%r{", "/", "<<", "<<~", "<<~EOS", "x = <<~EOS", "=begin", "=end", "__END__", ":", "::", ':"', "?", "?\\", "@", "@@", "$", "$-", "#{", '"#{', '"#{"',
    "0x", "0b", "1e", "1.", "1..", "a\r\nb", "=begin\r\nx\r\n=end\r\n", "x = <<~EOS\r\n  a\r\nEOS\r\n", "中文 '中' \"é\" 😀", "def", "def ", "def self.", "end\n__END__",
  ]) {
    assert.equal(tokenizeRuby(source).map(joinLine).join("\n"), source, JSON.stringify(source));
  }
  const deep = '"#{'.repeat(100) + "x" + '}"'.repeat(100);
  assert.equal(tokenizeRuby(deep).map(joinLine).join("\n"), deep, "100 levels of interpolation");
});

test("tokenizer: Dart comments, strings, interpolation, numbers, annotations and keywords", () => {
  const source = fixture("basic.dart");
  const sourceLines = source.split("\n");
  const dart = tokenizeDart(source);
  assert.equal(dart.length, sourceLines.length, "one token line per source line");
  // One source line as kind:text pieces joined with |, found by a piece of its text.
  const line = (text: string): string => {
    const index = sourceLines.findIndex((l) => l.includes(text));
    assert.ok(index !== -1, `no line with ${text}`);
    return dart[index]!.map((t) => `${t.kind}:${t.text}`).join("|");
  };
  // The same, but for the line that is exactly this text.
  const exact = (text: string): string => {
    const index = sourceLines.findIndex((l) => l === text);
    assert.ok(index !== -1, `no line that is ${text}`);
    return dart[index]!.map((t) => `${t.kind}:${t.text}`).join("|");
  };

  // Comments.
  assert.equal(line("#!/usr/bin/env"), "comment:#!/usr/bin/env dart");
  assert.equal(line("/// A small oven"), 'comment:/// A small oven timer. This doc comment says class and "string" but stays a comment.');
  assert.equal(line("One line comment"), "comment:// One line comment: void final if 'quotes'");
  assert.equal(line("A block comment"), "comment:/* A block comment /* with a nested one */ that is still a comment */");

  // Libraries, imports and combinators.
  assert.equal(line("library bakery"), "keyword:library|plain: bakery;");
  assert.equal(line("dart:async"), "keyword:import|plain: |string:'dart:async'|plain:;");
  assert.equal(line("dart:math"), "keyword:import|plain: |string:'dart:math'|plain: |keyword:as|plain: math |keyword:show|plain: max, min;");
  assert.equal(line("oven.dart"), "keyword:import|plain: |string:'package:oven/oven.dart'|plain: |keyword:hide|plain: |type:Broken|plain:;");
  assert.equal(line("export 'src"), "keyword:export|plain: |string:'src/loaf.dart'|plain: |keyword:show|plain: |type:Loaf|plain:;");
  assert.equal(line("part 'bakery"), "keyword:part|plain: |string:'bakery.g.dart'|plain:;");

  // Numbers: hex, exponents, a leading dot, and digit separators.
  assert.equal(line("maxLoaves"), "keyword:const|plain: maxLoaves = |number:1000|plain:;");
  assert.equal(line("mask ="), "keyword:const|plain: mask = |number:0xFF|plain:;");
  assert.equal(line("ratio ="), "keyword:const|plain: ratio = |number:1.5e-3|plain:;");
  assert.equal(line("big ="), "keyword:const|plain: big = |number:2E10|plain:;");
  assert.equal(line("half ="), "keyword:const|plain: half = |number:.5|plain:;");
  assert.equal(line("spaced ="), "keyword:const|plain: spaced = |number:1_000|plain:;");
  assert.equal(line("flag ="), "keyword:const|plain: flag = |keyword:true|plain:;");

  // Declarations and contextual modifiers.
  assert.equal(line("typedef Recipe"), "keyword:typedef|plain: |type:Recipe|plain: = |type:Map|plain:<|type:String|plain:, |type:List|plain:<|keyword:int|plain:>>;");
  assert.equal(line("enum Heat"), "keyword:enum|plain: |type:Heat|plain: { low, medium, high }");
  assert.equal(line("sealed class"), "keyword:sealed|plain: |keyword:class|plain: |type:Dough|plain: {");
  assert.equal(line("base class"), "keyword:base|plain: |keyword:class|plain: |type:Rye|plain: |keyword:extends|plain: |type:Dough|plain: {");
  assert.equal(line("interface class Starter"), "keyword:interface|plain: |keyword:class|plain: |type:Starter|plain: {}");
  assert.equal(line("abstract interface"), "keyword:abstract|plain: |keyword:interface|plain: |keyword:class|plain: |type:Baked|plain: {");
  assert.equal(line("mixin Slicer"), "keyword:mixin|plain: |type:Slicer|plain: |keyword:on|plain: |type:Baked|plain: {");
  assert.equal(line("mixin class"), "keyword:mixin|plain: |keyword:class|plain: |type:Warmer|plain: {}");
  assert.equal(line("extension LoafText"), "keyword:extension|plain: |type:LoafText|plain: |keyword:on|plain: |type:String|plain: {");
  assert.equal(line("class Loaf extends"), "keyword:class|plain: |type:Loaf|plain: |keyword:extends|plain: |type:Dough|plain: |keyword:with|plain: |type:Slicer|plain: |keyword:implements|plain: |type:Baked|plain: {");
  assert.equal(line("class _Counter"), "keyword:class|plain: |type:_Counter|plain:<|type:T|plain: |keyword:extends|plain: |keyword:num|plain:> {");
  assert.equal(line("static int _count"), "plain:  |keyword:static|plain: |keyword:int|plain: _count = |number:0|plain:;");
  assert.equal(line("late final"), "plain:  |keyword:late|plain: |keyword:final|plain: |keyword:int|plain: weight;");
  assert.equal(line("int? _heat"), "plain:  |keyword:int|plain:? _heat;");
  assert.equal(line("List<Map<String, int>> history"), "plain:  |type:List|plain:<|type:Map|plain:<|type:String|plain:, |keyword:int|plain:>> history = [];");
  assert.equal(
    line("Loaf(this._name"),
    "plain:  |type:Loaf|plain:(|keyword:this|plain:._name, {|keyword:required|plain: |keyword:this|plain:.weight, |keyword:int|plain: heat = |number:200|plain:}) : _heat = heat {",
  );
  assert.equal(line("factory Loaf.plain"), "plain:  |keyword:factory|plain: |type:Loaf|plain:.plain() => |type:Loaf|plain:(|string:'plain'|plain:, weight: |number:500|plain:);");

  // Getters, setters and operators.
  assert.equal(line("String get name;"), "plain:  |type:String|plain: |keyword:get|plain: name;");
  assert.equal(line("String get name =>"), "plain:  |type:String|plain: |keyword:get|plain: name => _name;");
  assert.equal(line("set heat(int value);"), "plain:  |keyword:set|plain: heat(|keyword:int|plain: value);");
  assert.equal(line("set heat(int value) =>"), "plain:  |keyword:set|plain: heat(|keyword:int|plain: value) => _heat = value;");
  assert.equal(line("bool operator =="), "plain:  |keyword:bool|plain: |keyword:operator|plain: ==(|type:Object|plain: other) => other |keyword:is|plain: |type:Loaf|plain: && other._name == _name;");
  assert.equal(line("int get hashCode"), "plain:  |keyword:int|plain: |keyword:get|plain: hashCode => _name.hashCode;");

  // Annotations.
  assert.equal(exact("  @override"), "plain:  |preprocessor:@override");
  assert.equal(line("@Deprecated"), "plain:  |preprocessor:@Deprecated|plain:(|string:'Use bake instead'|plain:)");
  assert.equal(line("@pragma"), "plain:  |preprocessor:@pragma|plain:(|string:'vm:prefer-inline'|plain:)");

  // async, await, yield.
  assert.equal(line("await Future.delayed"), "plain:    |keyword:await|plain: |type:Future|plain:.delayed(|keyword:const|plain: |type:Duration|plain:(seconds: |number:1|plain:));");
  assert.equal(line("Future<String> bake"), "plain:  |type:Future|plain:<|type:String|plain:> bake() |keyword:async|plain: {");
  assert.equal(line("Stream<int> counter"), "plain:  |type:Stream|plain:<|keyword:int|plain:> counter() |keyword:async|plain:* {");
  assert.equal(line("yield i;"), "plain:      |keyword:yield|plain: i;");
  assert.equal(line("yield* ["), "plain:    |keyword:yield|plain:* [|number:2|plain:, |number:4|plain:, |number:6|plain:];");
  assert.equal(line("evens()"), "plain:  |type:Iterable|plain:<|keyword:int|plain:> evens() |keyword:sync|plain:* {");
  assert.equal(line("void main()"), "keyword:void|plain: main() |keyword:async|plain: {");
  assert.equal(line("print(await"), "plain:  print(|keyword:await|plain: loaf.bake());");

  // ?. ?? ??= .. ...? and #symbols.
  assert.equal(line("final name = loaf?.name"), "plain:  |keyword:final|plain: name = loaf?.name ?? |string:'none'|plain:;");
  assert.equal(line("count ??= 0"), "plain:  count ??= |number:0|plain:;");
  assert.equal(line("final list"), "plain:  |keyword:final|plain: list = [|number:1|plain:, |number:2|plain:, ...?extras?.values, ...[|number:3|plain:, |number:4|plain:]];");
  assert.equal(line("..write(name)"), "plain:    ..write(name)");
  assert.equal(line("sym ="), "plain:  |keyword:final|plain: sym = |number:#bake|plain:;");
  assert.equal(line("qual ="), "plain:  |keyword:final|plain: qual = |number:#dart.core.int|plain:;");
  assert.equal(line("op = #+"), "plain:  |keyword:final|plain: op = |number:#+|plain:;");

  // Strings: escapes, $name, ${code} with nested braces and strings.
  assert.equal(
    line("var single"),
    "plain:  |keyword:var|plain: single = |string:'It\\'s |plain:$kind|string: with |plain:${n + |number:1|plain:}|string: slices'|plain:;",
  );
  assert.equal(line("var quoted"), 'plain:  |keyword:var|plain: quoted = |string:"say \\"hi\\" to |plain:$kind|string:"|plain:;');
  assert.equal(
    line("var nested"),
    "plain:  |keyword:var|plain: nested = |string:'a |plain:${n > |number:1|plain: ? |string:'many |plain:${kind.length}|string:'|plain: : |string:\"one\"|plain:}|string: b'|plain:;",
  );
  assert.equal(
    line("var braces"),
    "plain:  |keyword:var|plain: braces = |string:'map: |plain:${ {|string:'a'|plain:: |number:1|plain:}.length }|string: end'|plain:;",
  );
  assert.equal(line("var escaped"), "plain:  |keyword:var|plain: escaped = |string:'cost: \\$5 and \\${not code}'|plain:;", "an escaped $ is plain string text");

  // Raw strings: no escapes, no interpolation.
  assert.equal(line("var raw ="), "plain:  |keyword:var|plain: raw = |string:r'raw $kind \\n ${nothing}'|plain:;");
  assert.equal(line("var rawDouble"), 'plain:  |keyword:var|plain: rawDouble = |string:r"also raw $kind \\t"|plain:;');
  assert.equal(line("no $interpolation"), "string:no $interpolation here \\n", "a raw triple-quoted string");

  // Triple-quoted strings span lines and still interpolate.
  assert.equal(line("var multi ="), "plain:  |keyword:var|plain: multi = |string:'''");
  assert.equal(line("Today's bake"), "string:Today's bake: |plain:$kind");
  assert.equal(line("a \"quote\""), "string:  a \"quote\" and 'quotes' stay string text");
  assert.equal(line("sum is"), "string:  sum is |plain:${n + n}");
  assert.equal(exact("''';"), "string:'''|plain:;");
  assert.equal(line("Heat: ${"), "string:Heat: |plain:${|type:Heat|plain:.high.name}");

  // Pattern guards, on clauses and plain uses of contextual words.
  assert.equal(line("int n when"), "plain:    |keyword:int|plain: n |keyword:when|plain: n > |number:100|plain: => |string:'big'|plain:,");
  assert.equal(line("String s when"), "plain:    |type:String|plain: s |keyword:when|plain: s.isEmpty => |string:'empty'|plain:,");
  assert.equal(line("on FormatException"), "plain:  } |keyword:on|plain: |type:FormatException|plain: |keyword:catch|plain: (e) {");
  assert.equal(line("on Exception"), "plain:  } |keyword:on|plain: |type:Exception|plain: {");
  assert.equal(line("var get = 1"), "plain:  |keyword:var|plain: get = |number:1|plain:;");
  assert.equal(line("var base = 2"), "plain:  |keyword:var|plain: base = |number:2|plain:;");
  assert.equal(line("var late = 3"), "plain:  |keyword:var|plain: late = |number:3|plain:;");
  assert.equal(line("var async = 4"), "plain:  |keyword:var|plain: async = |number:4|plain:;");
  assert.equal(line("var show ="), "plain:  |keyword:var|plain: show = get + base + late + async;");
});

test("tokenizer: Dart tricky cases", () => {
  // Every token as kind:text, joined with |, and a " // " marks the start of a new line.
  const kinds = (source: string): string => tokenizeDart(source).map((l) => l.map((t) => `${t.kind}:${t.text}`).join("|")).join(" // ");

  // Comments nest, and an unclosed one runs to the end.
  assert.equal(kinds("/* a /* b */ c */ var x"), "comment:/* a /* b */ c */|plain: |keyword:var|plain: x");
  assert.equal(kinds("/* a /* b */ var x"), "comment:/* a /* b */ var x", "one level is still open");
  assert.equal(kinds("/// doc // not\nx"), "comment:/// doc // not // plain:x");
  assert.equal(kinds("x #! y"), "plain:x #! y", "#! only counts on the very first line");
  assert.equal(kinds("#!/usr/bin/env dart\nvar x"), "comment:#!/usr/bin/env dart // keyword:var|plain: x");
  const deepComment = `${"/*".repeat(200)}${"*/".repeat(200)} var x`;
  assert.equal(kinds(deepComment), `comment:${"/*".repeat(200)}${"*/".repeat(200)}|plain: |keyword:var|plain: x`, "200 nested comments");

  // Interpolation.
  assert.equal(kinds("'a $b c'"), "string:'a |plain:$b|string: c'");
  assert.equal(kinds("'a $b.c'"), "string:'a |plain:$b|string:.c'", "$name stops at the dot");
  assert.equal(kinds("'a ${b + (c * 2)} d'"), "string:'a |plain:${b + (c * |number:2|plain:)}|string: d'");
  assert.equal(kinds("'a ${f('}')} d'"), "string:'a |plain:${f(|string:'}'|plain:)}|string: d'", "a } inside a string inside ${ } does not close it");
  assert.equal(kinds("'a ${f(r'}')} d'"), "string:'a |plain:${f(|string:r'}'|plain:)}|string: d'", "a raw string inside ${ }");
  assert.equal(kinds("'x ${'y ${z} w'} v'"), "string:'x |plain:${|string:'y |plain:${z}|string: w'|plain:}|string: v'", "interpolation inside interpolation");
  assert.equal(kinds("'\\$a $b'"), "string:'\\$a |plain:$b|string:'", "an escaped $ is text");
  assert.equal(kinds("'cost $'"), "string:'cost $'", "a lone $ is text");
  assert.equal(kinds("'$1 and ${}'"), "string:'$1 and |plain:${}|string:'", "a digit after $ is text, an empty ${} is allowed");
  assert.equal(kinds("'a ${b' c"), "string:'a ${b'|plain: c", "a ${ that never closes is text");
  assert.equal(kinds("'no end\nvar x"), "string:'no end // keyword:var|plain: x", "a one-line string ends at the line end");
  assert.equal(kinds("'' + \"\""), "string:''|plain: + |string:\"\"", "empty strings");
  assert.equal(kinds("\"it's\" 'say \"hi\"'"), "string:\"it's\"|plain: |string:'say \"hi\"'", "the other quote kind inside");

  // Raw strings.
  assert.equal(kinds("r'a\\' b"), "string:r'a\\'|plain: b", "a backslash does not escape in a raw string");
  assert.equal(kinds("r'$a ${b}'"), "string:r'$a ${b}'", "no interpolation in a raw string");
  assert.equal(kinds("r\"\"\"a\n$b\n\"\"\" x"), 'string:r"""a // string:$b // string:"""|plain: x', "raw triple-quoted, over lines");
  assert.equal(kinds("bar'x'"), "plain:bar|string:'x'", "an r at the end of a name is not a raw prefix");
  assert.equal(kinds("r = 'x'"), "plain:r = |string:'x'", "a variable named r");

  // Triple-quoted strings.
  assert.equal(kinds("'''a 'b' ''c'' d''' x"), "string:'''a 'b' ''c'' d'''|plain: x", "quotes inside, closed by the first three");
  assert.equal(kinds("'''\nno end"), "string:''' // string:no end", "an unclosed triple-quoted string runs to the end");
  assert.equal(kinds("'''a ${\n b\n} c''' x"), "string:'''a |plain:${ // plain: b // plain:}|string: c'''|plain: x", "a ${ } in a triple-quoted string can span lines");
  assert.equal(kinds("'''\\''' x\n'''"), "string:'''\\''' x // string:'''", "an escaped quote does not close it");

  // Annotations and symbols.
  assert.equal(kinds("@override\nvoid f() {}"), "preprocessor:@override // keyword:void|plain: f() {}");
  assert.equal(kinds("@pkg.Name(1)"), "preprocessor:@pkg.Name|plain:(|number:1|plain:)");
  assert.equal(kinds("a @ b"), "plain:a @ b");
  assert.equal(kinds("[#a, #b.c, #[]=, #==]"), "plain:[|number:#a|plain:, |number:#b.c|plain:, |number:#[]=|plain:, |number:#==|plain:]");
  assert.equal(kinds("# x"), "plain:# x");

  // Numbers.
  assert.equal(kinds("0x1F + 1e10 + 1.5E-3"), "number:0x1F|plain: + |number:1e10|plain: + |number:1.5E-3");
  assert.equal(kinds("1.abs()"), "number:1|plain:.abs()", "a dot without a digit after it is not part of the number");
  assert.equal(kinds("1.5.toString()"), "number:1.5|plain:.toString()");
  assert.equal(kinds("(.5, 0.5)"), "plain:(|number:.5|plain:, |number:0.5|plain:)");
  assert.equal(kinds("a[0].b"), "plain:a[|number:0|plain:].b", "a dot after a bracket is a member access");
  assert.equal(kinds("1_000_000"), "number:1_000_000");
  assert.equal(kinds("1_a"), "number:1|plain:_a", "an underscore only counts before a digit");

  // Spreads, cascades and member names.
  assert.equal(kinds("[...this.items]"), "plain:[...|keyword:this|plain:.items]", "this after a spread is still a keyword");
  assert.equal(kinds("[...?x]"), "plain:[...?x]");
  assert.equal(kinds("a..add(1)..clear()"), "plain:a..add(|number:1|plain:)..clear()");
  assert.equal(kinds("Foo.new()"), "type:Foo|plain:.new()", "a keyword after a dot is a name");
  assert.equal(kinds("x?.default"), "plain:x?.default");
  assert.equal(kinds("a is! B"), "plain:a |keyword:is|plain:! |type:B");
  assert.equal(kinds("List<Map<String,int>> x"), "type:List|plain:<|type:Map|plain:<|type:String|plain:,|keyword:int|plain:>> x");
  assert.equal(kinds("a ??= b ?? c"), "plain:a ??= b ?? c");
  assert.equal(kinds("_Counter _name _HTTP HTTP T"), "type:_Counter|plain: _name _HTTP HTTP |type:T", "types by capital letter, constants in capitals left plain");

  // Contextual words are plain when used as names.
  assert.equal(kinds("int get length => 1;"), "keyword:int|plain: |keyword:get|plain: length => |number:1|plain:;");
  assert.equal(kinds("get(x); set.add(1);"), "plain:get(x); set.add(|number:1|plain:);");
  assert.equal(kinds("Set<int> set = {};"), "type:Set|plain:<|keyword:int|plain:> set = {};");
  assert.equal(kinds("late int x; late = 1;"), "keyword:late|plain: |keyword:int|plain: x; late = |number:1|plain:;");
  assert.equal(kinds("f(required: true, static: 1)"), "plain:f(required: |keyword:true|plain:, static: |number:1|plain:)", "named arguments are plain");
  assert.equal(kinds("x.static + y.factory"), "plain:x.static + y.factory");
  assert.equal(kinds("sealed = 1; sealed class A {}"), "plain:sealed = |number:1|plain:; |keyword:sealed|plain: |keyword:class|plain: |type:A|plain: {}");
  assert.equal(kinds("base.x; base mixin M {}"), "plain:base.x; |keyword:base|plain: |keyword:mixin|plain: |type:M|plain: {}");
  assert.equal(kinds("extension type Id(int v) {}"), "keyword:extension|plain: |keyword:type|plain: |type:Id|plain:(|keyword:int|plain: v) {}");
  assert.equal(kinds("var on = 1;"), "keyword:var|plain: on = |number:1|plain:;");
  assert.equal(kinds("try {} on Foo catch (e) {}"), "keyword:try|plain: {} |keyword:on|plain: |type:Foo|plain: |keyword:catch|plain: (e) {}");
  assert.equal(kinds("show(x);"), "plain:show(x);");
  assert.equal(kinds("part of 'a.dart';"), "keyword:part|plain: |keyword:of|plain: |string:'a.dart'|plain:;");
  assert.equal(kinds("var part = 1; parts.of"), "keyword:var|plain: part = |number:1|plain:; parts.of");
  assert.equal(kinds("bool operator <(Foo o) => true;"), "keyword:bool|plain: |keyword:operator|plain: <(|type:Foo|plain: o) => |keyword:true|plain:;");
  assert.equal(kinds("var operator = 1;"), "keyword:var|plain: operator = |number:1|plain:;");
  assert.equal(kinds("var await = 1; await foo();"), "keyword:var|plain: await = |number:1|plain:; |keyword:await|plain: foo();");
  assert.equal(kinds("f() async {} g() async => 1; var async = 2;"), "plain:f() |keyword:async|plain: {} g() |keyword:async|plain: => |number:1|plain:; |keyword:var|plain: async = |number:2|plain:;");
  assert.equal(kinds("case int x when x > 0:"), "keyword:case|plain: |keyword:int|plain: x |keyword:when|plain: x > |number:0|plain::");
  assert.equal(kinds("when(a).thenReturn(1);"), "plain:when(a).thenReturn(|number:1|plain:);", "a call named when");
  assert.equal(kinds("var r = when(a);"), "keyword:var|plain: r = when(a);");
  assert.equal(kinds("void main() { when(x); }"), "keyword:void|plain: main() { when(x); }");
});

test("tokenizer: Lua comments, strings, numbers, keywords, labels and built-ins", () => {
  const source = fixture("basic.lua");
  const sourceLines = source.split("\n");
  const lua = tokenizeLua(source);
  assert.equal(lua.length, sourceLines.length, "one token line per source line");
  // One source line as kind:text pieces joined with |, found by a piece of its text.
  const line = (text: string): string => {
    const index = sourceLines.findIndex((l) => l.includes(text));
    assert.ok(index !== -1, `no line with ${text}`);
    return lua[index]!.map((t) => `${t.kind}:${t.text}`).join("|");
  };
  // The same, but for the line that is exactly this text.
  const exact = (text: string): string => {
    const index = sourceLines.findIndex((l) => l === text);
    assert.ok(index !== -1, `no line that is ${text}`);
    return lua[index]!.map((t) => `${t.kind}:${t.text}`).join("|");
  };

  // Comments.
  assert.equal(line("#!/usr/bin/env"), "comment:#!/usr/bin/env lua");
  assert.equal(line("A small bakery helper"), 'comment:-- A small bakery helper. The words function "quotes" and [[brackets]] in this comment stay comments.');
  assert.equal(line("This block comment"), 'comment:This block comment says function and end and "quotes",');
  assert.equal(exact("--[==["), "comment:--[==[");
  assert.equal(line("A deeper comment"), "comment:A deeper comment can hold ]] and still go on");
  assert.equal(exact("]==]"), "comment:]==]");
  assert.equal(line("---[["), "comment:---[[ This is only a one line comment, even with the brackets");
  assert.equal(line("print_me"), "keyword:local|plain: print_me = |keyword:true");

  // Numbers.
  assert.equal(line("MAX_LOAVES"), "keyword:local|plain: MAX_LOAVES = |number:1000");
  assert.equal(line("mask ="), "keyword:local|plain: mask = |number:0xFF");
  assert.equal(line("ratio ="), "keyword:local|plain: ratio = |number:1.5e-3");
  assert.equal(line("half ="), "keyword:local|plain: half = |number:.5");
  assert.equal(line("hexfloat"), "keyword:local|plain: hexfloat = |number:0xA.8p0");
  assert.equal(line("power ="), "keyword:local|plain: power = |number:0x1p4");
  assert.equal(line("span ="), "keyword:local|plain: span = |number:1|plain: .. |number:2");

  // Strings.
  assert.equal(line("She said"), 'keyword:local|plain: text = |string:"She said \\"hi\\" and left\\n"');
  assert.equal(line("it\\'s"), "keyword:local|plain: single = |string:'it\\'s warm'");
  assert.equal(line("first part"), 'keyword:local|plain: joined = |string:"first part \\z');
  assert.equal(line("second part"), 'string:                second part"');
  assert.equal(line("local note"), "keyword:local|plain: note = |string:[[");
  assert.equal(line("A long string"), 'string:A long string can hold "quotes" and');
  assert.equal(line("span many lines."), "string:span many lines.");
  assert.equal(exact("]]"), "comment:]]", "the first ]] line is the end of the block comment");
  assert.equal(line("fancy"), "keyword:local|plain: fancy = |string:[==[has ]] and ]=] inside]==]");

  // Functions, locals and attributes.
  assert.equal(line("setmetatable"), "plain:  |keyword:local|plain: self = |keyword:setmetatable|plain:({}, Loaf)");
  assert.equal(line("function Loaf.new"), "keyword:function|plain: Loaf.new(name, weight)");
  assert.equal(line("function Loaf:describe"), "keyword:function|plain: Loaf:describe()");
  assert.equal(line("weight or 500"), "plain:  self.weight = weight |keyword:or|plain: |number:500");
  assert.equal(line("string.format"), 'plain:  |keyword:return|plain: |type:string|plain:.format(|string:"%s weighs %d"|plain:, self.name, self.weight)');
  assert.equal(line("local function slices"), "keyword:local|plain: |keyword:function|plain: slices(loaf, count)");
  assert.equal(line("for i = 1"), "plain:  |keyword:for|plain: i = |number:1|plain:, count |keyword:do");
  assert.equal(line("a, b <const>"), "keyword:local|plain: a, b <|keyword:const|plain:> = |number:1|plain:, |number:2");
  assert.equal(line("<close>"), "keyword:local|plain: handle <|keyword:close|plain:> = |keyword:nil");
  assert.equal(line("local table"), "keyword:local|plain: table = {}");
  assert.equal(line("local type"), 'keyword:local|plain: type = |string:"rye"');

  // Control flow, labels, and built-ins only when called.
  assert.equal(line("ipairs"), "keyword:for|plain: index, loaf |keyword:in|plain: |keyword:ipairs|plain:(loaves) |keyword:do");
  assert.equal(line("loaf.sold"), "plain:  |keyword:if|plain: loaf.weight > |number:500|plain: |keyword:and|plain: |keyword:not|plain: loaf.sold |keyword:then");
  assert.equal(line("loaf:describe())"), "plain:    |keyword:print|plain:(loaf:describe())");
  assert.equal(line("goto continue"), "plain:    |keyword:goto|plain: |preprocessor:continue");
  assert.equal(line('print "small loaf"'), 'plain:    |keyword:print|plain: |string:"small loaf"');
  assert.equal(exact("  ::continue::"), "plain:  |preprocessor:::continue::");
  assert.equal(line("pcall"), "keyword:local|plain: ok, err = |keyword:pcall|plain:(|keyword:function|plain:()");
  assert.equal(line('error("oven'), 'plain:  |keyword:error|plain:(|string:"oven is cold"|plain:)');
  assert.equal(line("a ~= b"), 'keyword:print|plain:(ok, err, #loaves, |number:2|plain: ^ |number:3|plain:, |number:7|plain: % |number:2|plain:, a ~= b, |string:"a"|plain: .. |string:"b"|plain:)');
  assert.equal(line("repeat"), "keyword:repeat");
  assert.equal(line("count <= 0"), "keyword:until|plain: count <= |number:0");
  assert.equal(line("return Loaf"), "keyword:return|plain: Loaf");
});

test("tokenizer: Lua tricky cases", () => {
  // Every token as kind:text, joined with |, and a " // " marks the start of a new line.
  const kinds = (source: string): string => tokenizeLua(source).map((l) => l.map((t) => `${t.kind}:${t.text}`).join("|")).join(" // ");

  // Comments: the level of = signs must match, and ---[[ is only a one-line comment.
  assert.equal(kinds("--[[ a ]] x"), "comment:--[[ a ]]|plain: x");
  assert.equal(kinds("--[==[ a ]] b ]=] c ]==] x"), "comment:--[==[ a ]] b ]=] c ]==]|plain: x");
  assert.equal(kinds("--[[ open\nstill"), "comment:--[[ open // comment:still", "an unclosed long comment runs to the end");
  assert.equal(kinds("--[=[ a ]]\nb"), "comment:--[=[ a ]] // comment:b", "a ]] does not close a level 1 comment");
  assert.equal(kinds("---[[ x\ny"), "comment:---[[ x // plain:y");
  assert.equal(kinds("--[ x\ny"), "comment:--[ x // plain:y", "--[ is only a one-line comment");
  assert.equal(kinds("--[=x\ny"), "comment:--[=x // plain:y");
  assert.equal(kinds("-- hi\nx"), "comment:-- hi // plain:x");
  assert.equal(kinds("x - -y"), "plain:x - -y", "two separate minus signs are not a comment");
  assert.equal(kinds("x #! y"), "plain:x #! y", "#! only counts on the very first line");
  assert.equal(kinds("#!/usr/bin/env lua\nlocal x"), "comment:#!/usr/bin/env lua // keyword:local|plain: x");

  // Long strings and brackets.
  assert.equal(kinds("[[a]] x"), "string:[[a]]|plain: x");
  assert.equal(kinds("[=[ ]] ]=] x"), "string:[=[ ]] ]=]|plain: x", "a ]] inside [=[ does not end it");
  assert.equal(kinds("[==[ ]=] ]==]"), "string:[==[ ]=] ]==]");
  assert.equal(kinds("[[a\nb]]"), "string:[[a // string:b]]");
  assert.equal(kinds("x = [==[ open\nstill"), "plain:x = |string:[==[ open // string:still", "an unclosed long string runs to the end");
  assert.equal(kinds("t[i] = t[1]"), "plain:t[i] = t[|number:1|plain:]", "a lone [ is punctuation");
  assert.equal(kinds("t[=x]"), "plain:t[=x]");
  assert.equal(kinds("t[ [[k]] ]"), "plain:t[ |string:[[k]]|plain: ]");

  // Quoted strings.
  assert.equal(kinds("'it\\'s' x"), "string:'it\\'s'|plain: x");
  assert.equal(kinds('"a\\\\" x'), 'string:"a\\\\"|plain: x', "an escaped backslash does not escape the quote");
  assert.equal(kinds('"a\\z   \n   b" x'), 'string:"a\\z    // string:   b"|plain: x', "\\z skips the white space after it, even over a line break");
  assert.equal(kinds('"a\\\nb" x'), 'string:"a\\ // string:b"|plain: x', "a backslash before a line break continues the string");
  assert.equal(kinds('"abc\nx'), 'string:"abc // plain:x', "an unfinished string ends at the line break");
  assert.equal(kinds('"abc'), 'string:"abc', "an unfinished string at the end of the file");
  assert.equal(kinds('"\\x41\\065\\u{48}" x'), 'string:"\\x41\\065\\u{48}"|plain: x');
  assert.equal(kinds('"a -- b" x'), 'string:"a -- b"|plain: x', "-- inside a string is not a comment");
  assert.equal(kinds('-- "a\nx'), 'comment:-- "a // plain:x', "a quote inside a comment is not a string");

  // Numbers.
  assert.equal(kinds("0xA.8p0"), "number:0xA.8p0");
  assert.equal(kinds("0x1p-4"), "number:0x1p-4");
  assert.equal(kinds("0x.1p4"), "number:0x.1p4");
  assert.equal(kinds("0xe+1"), "number:0xe|plain:+|number:1", "e is a digit in hex, so the + is not an exponent sign");
  assert.equal(kinds("3."), "number:3.");
  assert.equal(kinds("1e+5 2E3"), "number:1e+5|plain: |number:2E3");
  assert.equal(kinds("1e-"), "number:1|plain:e-", "an exponent without digits is not part of the number");
  assert.equal(kinds("1..2"), "number:1|plain:..|number:2");
  assert.equal(kinds("a..b"), "plain:a..b");
  assert.equal(kinds("f(...)"), "plain:f(...)");
  assert.equal(kinds("x.5"), "plain:x|number:.5", "a dot followed by a digit starts a number");
  assert.equal(kinds("a.b"), "plain:a.b");

  // Labels and goto.
  assert.equal(kinds("::done::"), "preprocessor:::done::");
  assert.equal(kinds(":: done ::"), "preprocessor::: done ::");
  assert.equal(kinds("goto done"), "keyword:goto|plain: |preprocessor:done");
  assert.equal(kinds("goto\ndone"), "keyword:goto // preprocessor:done");
  assert.equal(kinds("goto print"), "keyword:goto|plain: |preprocessor:print", "the label wins over a built-in name");
  assert.equal(kinds("a::b"), "plain:a::b", "a :: without a closing :: is not a label");
  assert.equal(kinds("x = done"), "plain:x = done");

  // Attributes.
  assert.equal(kinds("local x <const> = 1"), "keyword:local|plain: x <|keyword:const|plain:> = |number:1");
  assert.equal(kinds("local x < const > = 1"), "keyword:local|plain: x < |keyword:const|plain: > = |number:1");
  assert.equal(kinds("local a <close>, b <const> = f()"), "keyword:local|plain: a <|keyword:close|plain:>, b <|keyword:const|plain:> = f()");
  assert.equal(kinds("x <const>"), "plain:x <const>", "an attribute only counts right after a local name");
  assert.equal(kinds("local x\nif a <const> then"), "keyword:local|plain: x // keyword:if|plain: a <const> |keyword:then");
  assert.equal(kinds("local x = a <const>"), "keyword:local|plain: x = a <const>");
  assert.equal(kinds("local x <other> = 1"), "keyword:local|plain: x <other> = |number:1");

  // Local names and functions.
  assert.equal(kinds("local function f"), "keyword:local|plain: |keyword:function|plain: f");
  assert.equal(kinds("local function print() end"), "keyword:local|plain: |keyword:function|plain: print() |keyword:end");
  assert.equal(kinds("function print() end"), "keyword:function|plain: print() |keyword:end");
  assert.equal(kinds("local a, b <const> = 1, 2"), "keyword:local|plain: a, b <|keyword:const|plain:> = |number:1|plain:, |number:2");
  assert.equal(kinds("local table = {}"), "keyword:local|plain: table = {}");
  assert.equal(kinds("local print, pairs = 1, 2"), "keyword:local|plain: print, pairs = |number:1|plain:, |number:2");
  assert.equal(kinds("local x = print(1)"), "keyword:local|plain: x = |keyword:print|plain:(|number:1|plain:)");
  assert.equal(kinds("local x\nprint(x)"), "keyword:local|plain: x // keyword:print|plain:(x)");
  assert.equal(kinds("local x, y = 1, print(2)"), "keyword:local|plain: x, y = |number:1|plain:, |keyword:print|plain:(|number:2|plain:)");

  // Built-in functions only when called, library tables only before a dot.
  assert.equal(kinds("print(x)"), "keyword:print|plain:(x)");
  assert.equal(kinds("print 'x'"), "keyword:print|plain: |string:'x'");
  assert.equal(kinds("print{1}"), "keyword:print|plain:{|number:1|plain:}");
  assert.equal(kinds("require[[mod]]"), "keyword:require|string:[[mod]]");
  assert.equal(kinds('require"mod"'), 'keyword:require|string:"mod"');
  assert.equal(kinds("print = 1"), "plain:print = |number:1");
  assert.equal(kinds("if type == x then"), "keyword:if|plain: type == x |keyword:then");
  assert.equal(kinds("local t = type"), "keyword:local|plain: t = type");
  assert.equal(kinds("print\n(x)"), "plain:print // plain:(x)", "a bracket on the next line does not count");
  assert.equal(kinds("t.print(x)"), "plain:t.print(x)");
  assert.equal(kinds("obj:type()"), "plain:obj:type()");
  assert.equal(kinds("t.x = print(y)"), "plain:t.x = |keyword:print|plain:(y)");
  assert.equal(kinds("t.end"), "plain:t.end", "a keyword right after a dot is a field name");
  assert.equal(kinds("t. -- c\nprint(x)"), "plain:t. |comment:-- c // plain:print(x)", "a comment between the dot and the name changes nothing");
  assert.equal(kinds("string.format(x)"), "type:string|plain:.format(x)");
  assert.equal(kinds("string = 1"), "plain:string = |number:1");
  assert.equal(kinds("string..x"), "plain:string..x");
  assert.equal(kinds("a.string.x"), "plain:a.string.x");
  assert.equal(kinds("math.floor(table.unpack(t))"), "type:math|plain:.floor(|type:table|plain:.unpack(t))");
  assert.equal(kinds("_G.x = _VERSION"), "type:_G|plain:.x = |type:_VERSION");
  assert.equal(kinds("local _ENV = {}"), "keyword:local|plain: _ENV = {}");
  assert.equal(kinds("x = nil and true or false"), "plain:x = |keyword:nil|plain: |keyword:and|plain: |keyword:true|plain: |keyword:or|plain: |keyword:false");
  assert.equal(kinds("print2(x)"), "plain:print2(x)", "a longer name is not the built-in");

  // Operators and odd characters are plain and never lost.
  assert.equal(kinds("a // b ~= #c << 2"), "plain:a // b ~= #c << |number:2");
  assert.equal(kinds('x = "😀"'), 'plain:x = |string:"😀"');
  assert.equal(kinds("x = 😀"), "plain:x = 😀");
  assert.equal(kinds(""), "");
  const deep = `${"[==[".repeat(200)} ]==] x`;
  assert.equal(tokenizeLua(deep).map((l) => l.map((t) => t.text).join("")).join("\n"), deep, "200 long bracket openers");
});

test("tokenizer: R comments, strings, raw strings, numbers, names, operators and keywords", () => {
  const source = fixture("basic.r");
  const sourceLines = source.split("\n");
  const r = tokenizeR(source);
  assert.equal(r.length, sourceLines.length, "one token line per source line");
  // One source line as kind:text pieces joined with |, found by a piece of its text.
  const line = (text: string): string => {
    const index = sourceLines.findIndex((l) => l.includes(text));
    assert.ok(index !== -1, `no line with ${text}`);
    return r[index]!.map((t) => `${t.kind}:${t.text}`).join("|");
  };

  // Comments, roxygen lines included.
  assert.equal(line("#!/usr/bin/env"), "comment:#!/usr/bin/env Rscript");
  assert.equal(line("A small bakery helper"), 'comment:# A small bakery helper. The words function and "quotes" in this comment stay comments.');
  assert.equal(line("Total weight"), "comment:#' Total weight of some loaves.");
  assert.equal(line("@param"), "comment:#' @param weights a numeric vector, like c(500, 750)");
  assert.equal(line("library(stats)"), "keyword:library|plain:(stats)");

  // Numbers.
  assert.equal(line("MAX_LOAVES"), "plain:MAX_LOAVES <- |number:1000L");
  assert.equal(line("mask <-"), "plain:mask <- |number:0x1F");
  assert.equal(line("big_mask"), "plain:big_mask <- |number:0x10L");
  assert.equal(line("ratio"), "plain:ratio <- |number:1.5e-3");
  assert.equal(line("half"), "plain:half <- |number:.5");
  assert.equal(line("one <-"), "plain:one <- |number:1");
  assert.equal(line("nine"), "plain:nine <- |number:9.");
  assert.equal(line("imag"), "plain:imag <- |number:2i");

  // Constants.
  assert.equal(line("count <-"), "plain:count <- |keyword:NA_integer_");
  assert.equal(line("missing_name"), "plain:missing_name <- |keyword:NA_character_");
  assert.equal(line("empty"), "plain:empty <- |keyword:NULL");
  assert.equal(line("limit"), "plain:limit <- |keyword:Inf");

  // Strings: escapes, a # inside a string, several lines.
  assert.equal(line("She said"), 'plain:text <- |string:"She said \\"hi\\" # not a comment"');
  assert.equal(line("it\\'s"), "plain:single <- |string:'it\\'s warm'");
  assert.equal(line("a string"), 'plain:spread <- |string:"a string');
  assert.equal(line("that runs over"), 'string:that runs over two lines"');

  // Raw strings, with dashes and each kind of bracket.
  assert.equal(line("bakery\\loaves"), 'plain:path <- |string:r"(C:\\bakery\\loaves)"');
  assert.equal(line("fancy"), 'plain:fancy <- |string:R"-(has )" and )- inside)-"');
  assert.equal(line("square <-"), "plain:square <- |string:r'[a [nested] \"quote\"]'");
  assert.equal(line("curly"), 'plain:curly <- |string:r"{braces # here}"');

  // Names: dots, underscores, a leading dot and backticks.
  assert.equal(line(".hidden <-"), "plain:.hidden <- |number:5");
  assert.equal(line("my_var.2"), "plain:my_var.2 <- |keyword:is.na|plain:(.hidden)");
  assert.equal(line("`my loaf`"), "plain:`my loaf` <- |number:3");
  assert.equal(line("`if`"), "plain:`if` <- |number:4", "a backtick name is never a keyword");

  // Functions and control flow.
  assert.equal(line("total_weight <-"), "plain:total_weight <- |keyword:function|plain:(weights, extra = |number:0|plain:) {");
  assert.equal(line("length(weights)"), "plain:  |keyword:if|plain: (|keyword:length|plain:(weights) == |number:0|plain:) {");
  assert.equal(line("return(extra)"), "plain:    |keyword:return|plain:(extra)");
  assert.equal(line("} else {"), "plain:  } |keyword:else|plain: {");
  assert.equal(line("sum(weights)"), "plain:    |keyword:sum|plain:(weights) + extra");
  assert.equal(line("square_it"), "plain:square_it <- \\(x) x^|number:2");
  assert.equal(line("sapply"), "plain:doubled <- |keyword:sapply|plain:(|number:1|plain::|number:5|plain:, \\(n) n * |number:2|plain:)");
  assert.equal(line("for (i in"), "keyword:for|plain: (i |keyword:in|plain: |keyword:seq_len|plain:(|number:3|plain:)) {");
  assert.equal(line("next"), "plain:  |keyword:if|plain: (i == |number:2|plain:) |keyword:next");
  assert.equal(line("cat("), 'plain:  |keyword:cat|plain:(|string:"loaf"|plain:, i, |string:"\\n"|plain:)');
  assert.equal(line("while"), "keyword:while|plain: (|keyword:TRUE|plain:) {");
  assert.equal(line("repeat"), "keyword:repeat|plain: {");

  // $, @, :: and the operators.
  assert.equal(line("Loaf <- list"), 'plain:Loaf <- |keyword:list|plain:(name = |string:"rye"|plain:, weight = |number:750|plain:)');
  assert.equal(line("Loaf$weight"), "plain:Loaf$weight <- |number:800");
  assert.equal(line("stats::sd"), "type:stats|plain:::sd(|keyword:c|plain:(|number:1|plain:, |number:2|plain:, |number:3|plain:))");
  assert.equal(line("stats:::var"), "type:stats|plain::::var(|keyword:c|plain:(|number:4|plain:, |number:5|plain:, |number:6|plain:))");
  assert.equal(line("|>"), "plain:result <- |keyword:c|plain:(|number:1|plain:, |number:2|plain:, |number:3|plain:) |> |keyword:rev|plain:() |> |keyword:head|plain:(|number:2|plain:)");
  assert.equal(line("%in%"), "plain:passed <- |number:3|plain: %in% |keyword:c|plain:(|number:1|plain:, |number:2|plain:, |number:3|plain:)");
  assert.equal(line("%%"), "plain:leftover <- |number:17|plain: %% |number:5");
  assert.equal(line("%/%"), "plain:whole <- |number:17|plain: %/% |number:5");
  assert.equal(line("5 ->"), "number:5|plain: -> five");
  assert.equal(line("10 ->>"), "number:10|plain: ->> ten");
  assert.equal(line("counter"), "plain:counter <<- |number:1");
});

test("tokenizer: R tricky cases", () => {
  // Every token as kind:text, joined with |, and a " // " marks the start of a new line.
  const kinds = (source: string): string => tokenizeR(source).map((l) => l.map((t) => `${t.kind}:${t.text}`).join("|")).join(" // ");

  // Comments and strings.
  assert.equal(kinds("x # note"), "plain:x |comment:# note");
  assert.equal(kinds("#' @export\nx"), "comment:#' @export // plain:x");
  assert.equal(kinds('x <- "a # b" # c'), 'plain:x <- |string:"a # b"|plain: |comment:# c', "a # inside a string is not a comment");
  assert.equal(kinds("x <- 'a # b'"), "plain:x <- |string:'a # b'");
  assert.equal(kinds('"a\\\\" x'), 'string:"a\\\\"|plain: x', "an escaped backslash does not escape the quote");
  assert.equal(kinds('"a\nb" x'), 'string:"a // string:b"|plain: x', "a string can run over lines");
  assert.equal(kinds('"abc'), 'string:"abc', "an unfinished string runs to the end");
  assert.equal(kinds("# \"a\nx"), 'comment:# "a // plain:x', "a quote inside a comment is not a string");

  // Raw strings.
  assert.equal(kinds('r"(a)" x'), 'string:r"(a)"|plain: x');
  assert.equal(kinds('R"[a]" x'), 'string:R"[a]"|plain: x');
  assert.equal(kinds("r'{a}' x"), "string:r'{a}'|plain: x");
  assert.equal(kinds('r"-(a)-" x'), 'string:r"-(a)-"|plain: x');
  assert.equal(kinds('r"--[a]--" x'), 'string:r"--[a]--"|plain: x');
  assert.equal(kinds('r"-(a)" b)-" x'), 'string:r"-(a)" b)-"|plain: x', "the dashes have to match to close it");
  assert.equal(kinds('r"(a\\)" x'), 'string:r"(a\\)"|plain: x', "no escapes inside a raw string");
  assert.equal(kinds('r"(a\nb)" x'), 'string:r"(a // string:b)"|plain: x');
  assert.equal(kinds('r"(a"'), 'string:r"(a"', "an unfinished raw string runs to the end");
  assert.equal(kinds('r"(# not a comment)"'), 'string:r"(# not a comment)"');
  assert.equal(kinds('r"x"'), 'plain:r|string:"x"', "r without a bracket is a name followed by a string");
  assert.equal(kinds('bar"(x)"'), 'plain:bar|string:"(x)"', "only a lone r or R starts a raw string");
  assert.equal(kinds("r <- 1"), "plain:r <- |number:1");
  assert.equal(kinds("R"), "plain:R");

  // Backtick names.
  assert.equal(kinds("`my var` <- 1"), "plain:`my var` <- |number:1");
  assert.equal(kinds("`a\\`b` x"), "plain:`a\\`b` x");
  assert.equal(kinds("`# not a comment` x"), "plain:`# not a comment` x");
  assert.equal(kinds("`if`(a, b)"), "plain:`if`(a, b)");
  assert.equal(kinds("`unfinished\nx"), "plain:`unfinished // plain:x", "an unfinished backtick name ends at the line break");
  assert.equal(kinds('x$`my "var"`'), 'plain:x$`my "var"`');

  // Numbers.
  assert.equal(kinds("1 1.5 .5 1. 1e3 1E-3 1e+3"), "number:1|plain: |number:1.5|plain: |number:.5|plain: |number:1.|plain: |number:1e3|plain: |number:1E-3|plain: |number:1e+3");
  assert.equal(kinds("0x1F 0XAB 0x10L"), "number:0x1F|plain: |number:0XAB|plain: |number:0x10L");
  assert.equal(kinds("0x1p4 0x1.8p-2"), "number:0x1p4|plain: |number:0x1.8p-2");
  assert.equal(kinds("1L 100L 2i 1e3L"), "number:1L|plain: |number:100L|plain: |number:2i|plain: |number:1e3L");
  assert.equal(kinds("1e-"), "number:1|plain:e-", "an exponent without digits is not part of the number");
  assert.equal(kinds("1:3"), "number:1|plain::|number:3");
  assert.equal(kinds("x[2]"), "plain:x[|number:2|plain:]");
  assert.equal(kinds("-5"), "plain:-|number:5");
  assert.equal(kinds("0xe+1"), "number:0xe|plain:+|number:1", "e is a digit in hex, so the + is not an exponent sign");

  // Names with dots, underscores and a leading dot.
  assert.equal(kinds(".x"), "plain:.x", ".x is a name");
  assert.equal(kinds(".5"), "number:.5", ".5 is a number");
  assert.equal(kinds("x.5"), "plain:x.5", "a digit after a dot inside a name stays in the name");
  assert.equal(kinds("my_var.2 <- is.na(x)"), "plain:my_var.2 <- |keyword:is.na|plain:(x)");
  assert.equal(kinds("...length()"), "plain:...length()");
  assert.equal(kinds("f(...)"), "plain:f(...)");
  assert.equal(kinds("..1"), "plain:..1");
  assert.equal(kinds("café <- 1"), "plain:café <- |number:1");
  assert.equal(kinds("if.x <- 1"), "plain:if.x <- |number:1", "a name that starts with a keyword is not a keyword");
  assert.equal(kinds("function.name <- 1"), "plain:function.name <- |number:1");
  assert.equal(kinds("TRUE.value"), "plain:TRUE.value");

  // Keywords and constants.
  assert.equal(kinds("if (a) b else c"), "keyword:if|plain: (a) b |keyword:else|plain: c");
  assert.equal(kinds("repeat { break }"), "keyword:repeat|plain: { |keyword:break|plain: }");
  assert.equal(kinds("while (x) next"), "keyword:while|plain: (x) |keyword:next");
  assert.equal(kinds("for (i in 1:2) NULL"), "keyword:for|plain: (i |keyword:in|plain: |number:1|plain::|number:2|plain:) |keyword:NULL");
  assert.equal(kinds("TRUE FALSE NULL Inf NaN NA"), "keyword:TRUE|plain: |keyword:FALSE|plain: |keyword:NULL|plain: |keyword:Inf|plain: |keyword:NaN|plain: |keyword:NA");
  assert.equal(kinds("NA_integer_ NA_real_ NA_character_ NA_complex_"), "keyword:NA_integer_|plain: |keyword:NA_real_|plain: |keyword:NA_character_|plain: |keyword:NA_complex_");
  assert.equal(kinds("T F true na"), "plain:T F true na", "T, F and lower case words are plain");
  assert.equal(kinds("NA_other_"), "plain:NA_other_");

  // Lambdas and the other operators.
  assert.equal(kinds("\\(x) x + 1"), "plain:\\(x) x + |number:1");
  assert.equal(kinds("f <- \\(x, y = 2) x * y"), "plain:f <- \\(x, y = |number:2|plain:) x * y");
  assert.equal(kinds("a <- b <<- c -> d ->> e"), "plain:a <- b <<- c -> d ->> e");
  assert.equal(kinds("x |> f()"), "plain:x |> f()");
  assert.equal(kinds("a %in% b"), "plain:a %in% b");
  assert.equal(kinds("a %>% b %>% c"), "plain:a %>% b %>% c");
  assert.equal(kinds("a %% b %/% c"), "plain:a %% b %/% c");
  assert.equal(kinds("a %o% b # note"), "plain:a %o% b |comment:# note");
  assert.equal(kinds("a %# b"), "plain:a %|comment:# b", "a # after a lone % starts a comment");
  assert.equal(kinds("x %\ny %"), "plain:x % // plain:y %", "a % operator has to close on its own line");
  assert.equal(kinds('a %"% b'), 'plain:a %"% b', "a quote inside %...% does not start a string");
  assert.equal(kinds("y ~ x + z"), "plain:y ~ x + z");
  assert.equal(kinds("x[[1]]$y@z"), "plain:x[[|number:1|plain:]]$y@z");
  assert.equal(kinds("a == b && c || !d"), "plain:a == b && c || !d");

  // Built-ins are only coloured when called, and never after $, @ or ::.
  assert.equal(kinds("print(x)"), "keyword:print|plain:(x)");
  assert.equal(kinds("print (x)"), "keyword:print|plain: (x)", "a space before the bracket is fine");
  assert.equal(kinds("print"), "plain:print", "a built-in that is not called is plain");
  assert.equal(kinds("print <- 1"), "plain:print <- |number:1");
  assert.equal(kinds("sapply(x, print)"), "keyword:sapply|plain:(x, print)");
  assert.equal(kinds("print\n(x)"), "plain:print // plain:(x)", "a bracket on the next line does not count");
  assert.equal(kinds("x$print(1)"), "plain:x$print(|number:1|plain:)");
  assert.equal(kinds("x@print(1)"), "plain:x@print(|number:1|plain:)");
  assert.equal(kinds("x$if"), "plain:x$if", "a keyword after $ is a name");
  assert.equal(kinds("x$NULL"), "plain:x$NULL");
  assert.equal(kinds("x$\n  next"), "plain:x$ // plain:  next", "a name on the next line after $ is still a member");
  assert.equal(kinds("x$ # note\nnext"), "plain:x$ |comment:# note // plain:next");
  assert.equal(kinds("x$a\nnext"), "plain:x$a // keyword:next");
  assert.equal(kinds("base::print(x)"), "type:base|plain:::print(x)");
  assert.equal(kinds("pkg::if"), "type:pkg|plain:::if");
  assert.equal(kinds("pkg:::fn(1)"), "type:pkg|plain::::fn(|number:1|plain:)");
  assert.equal(kinds("a:b"), "plain:a:b", "a single colon is not a package separator");
  assert.equal(kinds("x$\"name\""), 'plain:x$|string:"name"');
  assert.equal(kinds("print2(x)"), "plain:print2(x)", "a longer name is not the built-in");
  assert.equal(kinds("is.na(x)"), "keyword:is.na|plain:(x)");
  assert.equal(kinds("is(x)"), "plain:is(x)");

  // Odd characters are plain and never lost.
  assert.equal(kinds('x <- "😀"'), 'plain:x <- |string:"😀"');
  assert.equal(kinds("x <- 😀"), "plain:x <- 😀");
  assert.equal(kinds(""), "");
  const deep = `${'r"-('.repeat(200)} )-" x`;
  assert.equal(tokenizeR(deep).map((l) => l.map((t) => t.text).join("")).join("\n"), deep, "200 raw string openers");
});

test("tokenizer: MATLAB comments, strings, transposes, numbers, names and keywords", () => {
  const source = fixture("basic.m");
  const sourceLines = source.split("\n");
  const m = tokenizeMatlab(source);
  assert.equal(m.length, sourceLines.length, "one token line per source line");
  // One source line as kind:text pieces joined with |, found by a piece of its text.
  const line = (text: string): string => {
    const index = sourceLines.findIndex((l) => l.includes(text));
    assert.ok(index !== -1, `no line with ${text}`);
    return m[index]!.map((t) => `${t.kind}:${t.text}`).join("|");
  };

  // Comments and block comments, nested ones included.
  assert.equal(line("A small bakery helper"), "comment:% A small bakery helper. The words function and 'quotes' in this comment stay comments.");
  for (const text of ["This block comment", "but it is all comment", "A nested block", "Still comment here"]) {
    assert.equal(line(text), `comment:${text}${sourceLines.find((l) => l.includes(text))!.slice(text.length)}`, `${text} is inside the block comment`);
  }
  assert.deepEqual(m.slice(2, 10).map((l) => l.map((t) => t.kind).join("|")), Array(8).fill("comment"), "the nested block comment is one comment");
  assert.equal(line("MAX_LOAVES"), "plain:MAX_LOAVES = |number:1000|plain:;", "code after the block comment is code again");

  // Numbers.
  assert.equal(line("mask ="), "plain:mask = |number:0x1F|plain:;");
  assert.equal(line("bits ="), "plain:bits = |number:0b101|plain:;");
  assert.equal(line("small ="), "plain:small = |number:0xFFu8|plain:;");
  assert.equal(line("ratio ="), "plain:ratio = |number:1.5e-3|plain:;");
  assert.equal(line("half ="), "plain:half = |number:.5|plain:;");
  assert.equal(line("nine ="), "plain:nine = |number:9.|plain:;");
  assert.equal(line("voltage ="), "plain:voltage = |number:3|plain: + |number:2i|plain:;");
  assert.equal(line("phase ="), "plain:phase = |number:2.5j|plain:;");
  assert.equal(line("doubled ="), "plain:doubled = |number:1|plain:.*|number:2|plain:;", "the dot in 1.*2 belongs to the operator");
  assert.equal(line("inverse ="), "plain:inverse = |number:1|plain:./x;");

  // Constants.
  assert.equal(line("limit ="), "plain:limit = |keyword:Inf|plain:;");
  assert.equal(line("missing ="), "plain:missing = |keyword:NaN|plain:;");

  // Strings: doubled quotes, a % inside a string, an unfinished string.
  assert.equal(line("name ="), "plain:name = |string:'Rye loaf'|plain:;");
  assert.equal(line("quote ="), "plain:quote = |string:'it''s warm'|plain:;");
  assert.equal(line("label ="), 'plain:label = |string:"She said ""hi"" % not a comment"|plain:;');
  assert.equal(line("percent ="), "plain:percent = |string:'% not a comment either'|plain:;");
  assert.equal(line("broken ="), "plain:broken = |string:'no end");
  assert.equal(m[sourceLines.findIndex((l) => l.startsWith("function total"))]![0]!.kind, "keyword", "the unfinished string ends at its line");

  // Transpose or string.
  assert.equal(line("flipped ="), "plain:flipped = M';");
  assert.equal(line("column ="), "plain:column = [|number:1|plain: |number:2|plain: |number:3|plain:]';");
  assert.equal(line("last ="), "plain:last = weights(|keyword:end|plain:)';");
  assert.equal(line("both ="), "plain:both = M'*M';", "two transposes, not a string between them");
  assert.equal(line("twice ="), "plain:twice = M'';", "a transpose of a transpose");
  assert.equal(line("plain_dot ="), "plain:plain_dot = M.';");
  assert.equal(line("words ="), "plain:words = [|string:'rye'|plain: |string:'wheat'|plain:];", "a space before the quote makes it a string");
  assert.equal(line("mixed ="), "plain:mixed = [name' |string:'x'|plain:];");
  assert.equal(line("cells ="), "plain:cells = {|string:'a'|plain:, |string:'b'|plain:, |string:\"c\"|plain:};");
  assert.equal(line("tail ="), "plain:tail = names{|keyword:end|plain:}';");

  // Function lines: the names stay plain, even a built-in name.
  assert.equal(line("total_weight(weights"), "keyword:function|plain: total = total_weight(weights, extra)");
  assert.equal(line("[low, high]"), "keyword:function|plain: [low, high] = spread(values)");
  assert.equal(line("function disp"), "keyword:function|plain: disp(obj)");
  assert.equal(line("fprintf('%d"), "plain:  |keyword:fprintf|plain:(|string:'%d loaves\\n'|plain:, obj.count);");

  // Control flow, built-ins and member names.
  assert.equal(line("isempty(weights)"), "plain:  |keyword:if|plain: |keyword:isempty|plain:(weights)");
  assert.equal(line("elseif"), "plain:  |keyword:elseif|plain: |keyword:numel|plain:(weights) == |number:1");
  assert.equal(line("for i ="), "keyword:for|plain: i = |number:1|plain::|number:3");
  assert.equal(line("continue"), "plain:  |keyword:if|plain: i == |number:2|plain:, |keyword:continue|plain:; |keyword:end");
  assert.equal(line("while true"), "keyword:while|plain: |keyword:true");
  assert.equal(line("case {"), "plain:  |keyword:case|plain: {|string:'wheat'|plain:, |string:'spelt'|plain:}");
  assert.equal(line("otherwise"), "plain:  |keyword:otherwise");
  assert.equal(line("catch err"), "keyword:catch|plain: err");
  assert.equal(line("err.message"), "plain:  |keyword:disp|plain:(err.message);");
  assert.equal(line("s.end"), "plain:s.end = |number:5|plain:;", "a word after a dot is a name");
  assert.equal(line("s.size"), "plain:s.size = |number:6|plain:;");
  assert.equal(line("size = 4"), "plain:size = |number:4|plain:;", "a built-in that is not called is plain");
  assert.equal(line("square ="), "plain:square = @(x) x.^|number:2|plain:;");
  assert.equal(line("arrayfun"), "plain:result = |keyword:arrayfun|plain:(@(k) k*|number:2|plain:, |number:1|plain::|number:5|plain:);");

  // Continuation lines.
  assert.equal(line("1 + 2 + ..."), "plain:total = |number:1|plain: + |number:2|plain: + |comment:...");
  assert.equal(line("this part is a comment"), "plain:total = |number:1|plain: + |number:2|plain: |comment:... this part is a comment, 'quotes' and all");
  assert.equal(line("3 + 4"), "plain:        |number:3|plain: + |number:4|plain:;");

  // Class sections.
  assert.equal(line("classdef"), "keyword:classdef|plain: Loaf < handle");
  assert.equal(line("properties"), "plain:  |keyword:properties|plain: (Access = public)");
  assert.equal(line("methods"), "plain:  |keyword:methods");
  assert.equal(line("function obj = Loaf"), "plain:    |keyword:function|plain: obj = Loaf(w)");
});

test("tokenizer: MATLAB tricky cases", () => {
  // Every token as kind:text, joined with |, and a " // " marks the start of a new line.
  const kinds = (source: string): string => tokenizeMatlab(source).map((l) => l.map((t) => `${t.kind}:${t.text}`).join("|")).join(" // ");

  // Comments and block comments.
  assert.equal(kinds("x % note"), "plain:x |comment:% note");
  assert.equal(kinds("x = 'a % b' % c"), "plain:x = |string:'a % b'|plain: |comment:% c", "a % inside a string is not a comment");
  assert.equal(kinds("%{\nhi\n%}\nx"), "comment:%{ // comment:hi // comment:%} // plain:x");
  assert.equal(kinds("  %{  \nhi\n  %}  \nx"), "plain:  |comment:%{   // comment:hi // comment:  %}   // plain:x", "spaces around %{ and %} are fine");
  assert.equal(kinds("%{ not a block\nx"), "comment:%{ not a block // plain:x", "%{ with text after it is a one line comment");
  assert.equal(kinds("x = 1; %{\ny"), "plain:x = |number:1|plain:; |comment:%{ // plain:y", "%{ after code is a one line comment");
  assert.equal(kinds("%{\n%{\nin\n%}\nstill\n%}\nx"), "comment:%{ // comment:%{ // comment:in // comment:%} // comment:still // comment:%} // plain:x", "block comments nest");
  assert.equal(kinds("%{\nnever closed\nx = 1"), "comment:%{ // comment:never closed // comment:x = 1", "an unclosed block comment runs to the end");
  assert.equal(kinds("%{\na %} b\n%}\nx"), "comment:%{ // comment:a %} b // comment:%} // plain:x", "a %} with other text on its line does not close it");
  assert.equal(kinds("%}\nx"), "comment:%} // plain:x", "a lone %} is a one line comment");
  assert.equal(kinds("%%{\nx"), "comment:%%{ // plain:x", "%%{ is a one line comment");
  assert.equal(kinds("% 'a\nx"), "comment:% 'a // plain:x", "a quote inside a comment is not a string");

  // Continuation.
  assert.equal(kinds("a = [1 ... c\n2]"), "plain:a = [|number:1|plain: |comment:... c // number:2|plain:]");
  assert.equal(kinds("a ..."), "plain:a |comment:...");
  assert.equal(kinds("a = 'x...y'"), "plain:a = |string:'x...y'", "... inside a string is part of the string");
  assert.equal(kinds("x...\ny"), "plain:x|comment:... // plain:y");
  assert.equal(kinds("function f(a, ... c\nb)"), "keyword:function|plain: f(a, |comment:... c // plain:b)");
  assert.equal(kinds("function [a, ...\nb] = f"), "keyword:function|plain: [a, |comment:... // plain:b] = f", "a function line can continue on the next line");

  // Strings.
  assert.equal(kinds("'a''b'"), "string:'a''b'");
  assert.equal(kinds("'''"), "string:'''");
  assert.equal(kinds("''"), "string:''", "an empty string");
  assert.equal(kinds('"a""b"'), 'string:"a""b"');
  assert.equal(kinds('"a\\"'), 'string:"a\\"', "a backslash is not an escape");
  assert.equal(kinds("'a\\n'"), "string:'a\\n'");
  assert.equal(kinds("'abc"), "string:'abc", "an unfinished string runs to the end");
  assert.equal(kinds("'abc\nx"), "string:'abc // plain:x", "an unfinished string stops at the line break");
  assert.equal(kinds('"abc\nx'), 'string:"abc // plain:x');
  assert.equal(kinds("'it''s' x"), "string:'it''s'|plain: x");
  assert.equal(kinds("disp('a')"), "keyword:disp|plain:(|string:'a'|plain:)");

  // Transpose or string.
  assert.equal(kinds("x'"), "plain:x'");
  assert.equal(kinds("x' y'"), "plain:x' y'");
  assert.equal(kinds("x'*y"), "plain:x'*y");
  assert.equal(kinds("x '"), "plain:x |string:'", "a space before the quote makes it a string");
  assert.equal(kinds("x 'a'"), "plain:x |string:'a'");
  assert.equal(kinds("x_1'"), "plain:x_1'");
  assert.equal(kinds("2'"), "number:2|plain:'");
  assert.equal(kinds("2.5'"), "number:2.5|plain:'");
  assert.equal(kinds("2.'"), "number:2|plain:.'", "2.' is a 2 and then the .' operator");
  assert.equal(kinds("x.'"), "plain:x.'");
  assert.equal(kinds("x.''"), "plain:x.''", "a transpose after .' is a transpose");
  assert.equal(kinds("(a)'"), "plain:(a)'");
  assert.equal(kinds("[1 2]'"), "plain:[|number:1|plain: |number:2|plain:]'");
  assert.equal(kinds("{1}'"), "plain:{|number:1|plain:}'");
  assert.equal(kinds("x'''"), "plain:x'''", "three transposes");
  assert.equal(kinds("x''y"), "plain:x''y");
  assert.equal(kinds("= 'a'"), "plain:= |string:'a'");
  assert.equal(kinds("('a')"), "plain:(|string:'a'|plain:)");
  assert.equal(kinds("['a' 'b']"), "plain:[|string:'a'|plain: |string:'b'|plain:]");
  assert.equal(kinds("['a''b']"), "plain:[|string:'a''b'|plain:]", "a doubled quote is inside the string");
  assert.equal(kinds(",'a'"), "plain:,|string:'a'");
  assert.equal(kinds("x(end)'"), "plain:x(|keyword:end|plain:)'");
  assert.equal(kinds("x(end')"), "plain:x(|keyword:end|plain:')", "end inside brackets is an index, so ' after it is a transpose");
  assert.equal(kinds("end'a'"), "keyword:end|string:'a'", "an end outside brackets is a keyword, so ' after it starts a string");
  assert.equal(kinds("case'a'"), "keyword:case|string:'a'", "a quote right after a keyword is a string");
  assert.equal(kinds("return'x'"), "keyword:return|string:'x'");
  assert.equal(kinds("pi'"), "keyword:pi|plain:'");
  assert.equal(kinds("zeros(2)'"), "keyword:zeros|plain:(|number:2|plain:)'");
  assert.equal(kinds('"a"\''), "string:\"a\"'", "a quote after a double quoted string starts a string");
  assert.equal(kinds("s.name'"), "plain:s.name'");
  assert.equal(kinds("x'; y = 'b'"), "plain:x'; y = |string:'b'");

  // Numbers.
  assert.equal(kinds("1 1.5 .5 1. 1e3 1E-3 1e+3"), "number:1|plain: |number:1.5|plain: |number:.5|plain: |number:1.|plain: |number:1e3|plain: |number:1E-3|plain: |number:1e+3");
  assert.equal(kinds("0x1F 0XAB 0b101 0B11"), "number:0x1F|plain: |number:0XAB|plain: |number:0b101|plain: |number:0B11");
  assert.equal(kinds("0xFFu8 0x1s16 0b1u64"), "number:0xFFu8|plain: |number:0x1s16|plain: |number:0b1u64");
  assert.equal(kinds("0xFFu7"), "number:0xFF|plain:u7", "u7 is not a number ending");
  assert.equal(kinds("3i 2.5j 1e3i .5i"), "number:3i|plain: |number:2.5j|plain: |number:1e3i|plain: |number:.5i");
  assert.equal(kinds("3ix"), "number:3|plain:ix", "an i followed by more letters is not an imaginary ending");
  assert.equal(kinds("1e-"), "number:1|plain:e-", "an exponent without digits is not part of the number");
  assert.equal(kinds("0x"), "number:0|plain:x");
  assert.equal(kinds("0b2"), "number:0|plain:b2", "b2 is not binary digits, so this is a 0 and a name");
  assert.equal(kinds("1:3"), "number:1|plain::|number:3");
  assert.equal(kinds("1.*2 1./2 1.^2 1.\\2"), "number:1|plain:.*|number:2|plain: |number:1|plain:./|number:2|plain: |number:1|plain:.^|number:2|plain: |number:1|plain:.\\|number:2");
  assert.equal(kinds("x.*.5"), "plain:x.*|number:.5");
  assert.equal(kinds("1...\n2"), "number:1|comment:... // number:2");
  assert.equal(kinds("A(1,:)"), "plain:A(|number:1|plain:,:)");

  // Names and member access.
  assert.equal(kinds("café = 1"), "plain:café = |number:1");
  assert.equal(kinds("if1 = 1"), "plain:if1 = |number:1", "a name that starts with a keyword is not a keyword");
  assert.equal(kinds("end_ = 1"), "plain:end_ = |number:1");
  assert.equal(kinds("s.if"), "plain:s.if", "a keyword after a dot is a name");
  assert.equal(kinds("s.end"), "plain:s.end");
  assert.equal(kinds("s.pi"), "plain:s.pi");
  assert.equal(kinds("s.zeros(1)"), "plain:s.zeros(|number:1|plain:)", "a built-in after a dot is a name");
  assert.equal(kinds("s.(name)"), "plain:s.(name)");
  assert.equal(kinds("s.a.b"), "plain:s.a.b");
  assert.equal(kinds("s.\nif"), "plain:s. // plain:if", "a name on the next line after a dot is still a member");
  assert.equal(kinds("s.a\nif"), "plain:s.a // keyword:if");

  // Keywords, constants and built-ins.
  assert.equal(kinds("if x, y, end"), "keyword:if|plain: x, y, |keyword:end");
  assert.equal(kinds("for k = 1:n end"), "keyword:for|plain: k = |number:1|plain::n |keyword:end");
  assert.equal(kinds("parfor spmd global persistent"), "keyword:parfor|plain: |keyword:spmd|plain: |keyword:global|plain: |keyword:persistent");
  assert.equal(kinds("true false pi Inf NaN NaT eps"), "keyword:true|plain: |keyword:false|plain: |keyword:pi|plain: |keyword:Inf|plain: |keyword:NaN|plain: |keyword:NaT|plain: |keyword:eps");
  assert.equal(kinds("i j inf nan True"), "plain:i j inf nan True", "i, j and the wrong letter case are plain");
  assert.equal(kinds("zeros(3)"), "keyword:zeros|plain:(|number:3|plain:)");
  assert.equal(kinds("zeros (3)"), "plain:zeros (|number:3|plain:)", "a built-in needs its bracket right after it");
  assert.equal(kinds("zeros"), "plain:zeros");
  assert.equal(kinds("zeros = 1"), "plain:zeros = |number:1");
  assert.equal(kinds("zeros2(1)"), "plain:zeros2(|number:1|plain:)", "a longer name is not the built-in");
  assert.equal(kinds("x = @sin"), "plain:x = @sin");

  // Function lines.
  assert.equal(kinds("function f"), "keyword:function|plain: f");
  assert.equal(kinds("function out = f(a)"), "keyword:function|plain: out = f(a)");
  assert.equal(kinds("function [a, b] = f(zeros)"), "keyword:function|plain: [a, b] = f(zeros)");
  assert.equal(kinds("function zeros(a)"), "keyword:function|plain: zeros(a)", "a function can be named like a built-in");
  assert.equal(kinds("function r = f(a)\nr = size(a);"), "keyword:function|plain: r = f(a) // plain:r = |keyword:size|plain:(a);");
  assert.equal(kinds("function f\nsize(a)"), "keyword:function|plain: f // keyword:size|plain:(a)", "the function line ends at the line break");
  assert.equal(kinds("function v = get.Prop(obj)"), "keyword:function|plain: v = get.Prop(obj)");

  // Class sections.
  assert.equal(kinds("classdef A\nproperties\nx\nend\nmethods (Static)\nend\nend"), "keyword:classdef|plain: A // keyword:properties // plain:x // keyword:end // keyword:methods|plain: (Static) // keyword:end // keyword:end");
  assert.equal(kinds("classdef A\n  events % notes\n  enumeration\n"), "keyword:classdef|plain: A // plain:  |keyword:events|plain: |comment:% notes // plain:  |keyword:enumeration // ");
  assert.equal(kinds("properties\nx"), "plain:properties // plain:x", "no classdef, so properties is a name");
  assert.equal(kinds("classdef A\nx = properties\ny = methods(1)"), "keyword:classdef|plain: A // plain:x = properties // plain:y = methods(|number:1|plain:)", "only a word alone at the start of a line counts");
  assert.equal(kinds("classdef A\nmethods = 1"), "keyword:classdef|plain: A // plain:methods = |number:1");
  assert.equal(kinds("arguments\n  x\nend"), "keyword:arguments // plain:  x // keyword:end");
  assert.equal(kinds("arguments (Repeating)"), "plain:arguments (Repeating)", "arguments only counts when alone on its line");
  assert.equal(kinds("x = arguments"), "plain:x = arguments");

  // Odd characters are plain and never lost.
  assert.equal(kinds("x = '😀'"), "plain:x = |string:'😀'");
  assert.equal(kinds("x = 😀"), "plain:x = 😀");
  assert.equal(kinds("x = a.*b + c.^2 - d./e & f | ~g"), "plain:x = a.*b + c.^|number:2|plain: - d./e & f | ~g");
  assert.equal(kinds(""), "");
  assert.equal(kinds("\r\nx"), "plain:\r // plain:x");
  const deep = `${"%{\n".repeat(200)}x`;
  assert.equal(tokenizeMatlab(deep).map((l) => l.map((t) => t.text).join("")).join("\n"), deep, "200 block comment openers");
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
  assert.equal(languageForFile("composer.lock"), undefined);
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
  assert.equal(languageForFile("Pantry.kt"), "kotlin");
  assert.equal(languageForFile("build.gradle.kts"), "kotlin");
  assert.equal(languageForFile("MAIN.KT"), "kotlin");
  assert.equal(languageForFile("Main.ktm"), undefined);
  assert.equal(languageForFile("kt"), undefined);
  assert.equal(languageForVscodeId("kotlin"), "kotlin");
  assert.equal(languageForFile("Oven.swift"), "swift");
  assert.equal(languageForFile("MAIN.SWIFT"), "swift");
  assert.equal(languageForFile("Oven.swiftmodule"), undefined);
  assert.equal(languageForFile("swift"), undefined);
  assert.equal(languageForVscodeId("swift"), "swift");
  assert.equal(languageForFile("loaves.rb"), "ruby");
  assert.equal(languageForFile("LOAVES.RB"), "ruby");
  assert.equal(languageForFile("loaves.rbi"), undefined);
  assert.equal(languageForFile("loaves.erb"), undefined);
  assert.equal(languageForFile("rb"), undefined);
  assert.equal(languageForVscodeId("ruby"), "ruby");
  assert.equal(languageForFile("dough.dart"), "dart");
  assert.equal(languageForFile("DOUGH.DART"), "dart");
  assert.equal(languageForFile("dough.dart.bak"), undefined);
  assert.equal(languageForFile("dough.g.dart"), "dart");
  assert.equal(languageForFile("dart"), undefined);
  assert.equal(languageForVscodeId("dart"), "dart");
  assert.equal(languageForFile("shelf.lua"), "lua");
  assert.equal(languageForFile("SHELF.LUA"), "lua");
  assert.equal(languageForFile("shelf.lua.bak"), undefined);
  assert.equal(languageForFile("shelf.luac"), undefined);
  assert.equal(languageForFile("shelf.rockspec"), undefined);
  assert.equal(languageForFile("lua"), undefined);
  assert.equal(languageForVscodeId("lua"), "lua");
  assert.equal(languageForFile("model.r"), "r");
  assert.equal(languageForFile("foo.R"), "r", "a capital .R is R too");
  assert.equal(languageForFile("MODEL.R"), "r");
  assert.equal(languageForFile("model.r.bak"), undefined);
  assert.equal(languageForFile("model.Rmd"), undefined);
  assert.equal(languageForFile("model.Rproj"), undefined);
  assert.equal(languageForFile("r"), undefined);
  assert.equal(languageForVscodeId("r"), "r");
  assert.equal(languageForFile("sim.m"), "matlab");
  assert.equal(languageForFile("SIM.M"), "matlab", "a capital .M is MATLAB too");
  assert.equal(languageForFile("sim.m.bak"), undefined);
  assert.equal(languageForFile("sim.mat"), undefined);
  assert.equal(languageForFile("sim.mlx"), undefined);
  assert.equal(languageForFile("sim.mm"), undefined);
  assert.equal(languageForFile("m"), undefined);
  assert.equal(languageForVscodeId("matlab"), "matlab");
  assert.equal(languageForVscodeId("objective-c"), undefined, "Objective-C is not supported");
  assert.equal(languageForFile("blink.ino"), "arduino");
  assert.equal(languageForFile("BLINK.INO"), "arduino", "a capital .INO is Arduino too");
  assert.equal(languageForFile("blink.ino.bak"), undefined);
  assert.equal(languageForFile("blink.pde"), undefined);
  assert.equal(languageForFile("ino"), undefined);
  assert.equal(languageForVscodeId("arduino"), "arduino");
  assert.equal(languageForFile("top.v"), "verilog");
  assert.equal(languageForFile("defs.vh"), "verilog");
  assert.equal(languageForFile("TOP.V"), "verilog", "a capital .V is Verilog too");
  assert.equal(languageForFile("top.sv"), "systemverilog");
  assert.equal(languageForFile("pkg.svh"), "systemverilog");
  assert.equal(languageForFile("TOP.SV"), "systemverilog");
  assert.equal(languageForFile("top.v.bak"), undefined);
  assert.equal(languageForFile("top.vhd"), "vhdl", "VHDL is not Verilog");
  assert.equal(languageForFile("top.vhdl"), "vhdl");
  assert.equal(languageForFile("TOP.VHD"), "vhdl");
  assert.equal(languageForFile("top.vhd.bak"), undefined);
  assert.equal(languageForFile("top.vho"), undefined, "ModelSim output files are not supported");
  assert.equal(languageForFile("vhd"), undefined);
  assert.equal(languageForFile("top.vcd"), undefined);
  assert.equal(languageForFile("top.vo"), undefined, "Coq object files are not supported");
  assert.equal(languageForFile("v"), undefined);
  assert.equal(languageForFile("sv"), undefined);
  assert.equal(languageForVscodeId("verilog"), "verilog");
  assert.equal(languageForVscodeId("systemverilog"), "systemverilog");
  assert.equal(languageForVscodeId("vhdl"), "vhdl");
  assert.equal(LANGUAGES.verilog.label, "Verilog");
  assert.equal(LANGUAGES.systemverilog.label, "SystemVerilog");
  assert.equal(LANGUAGES.vhdl.label, "VHDL");
  assert.equal(languageForFile("start.s"), "asm");
  assert.equal(languageForFile("start.S"), "asm", "a capital .S (preprocessed assembly) is the same language");
  assert.equal(languageForFile("START.ASM"), "asm");
  assert.equal(languageForFile("boot.asm"), "asm");
  assert.equal(languageForFile("start.s.bak"), undefined);
  assert.equal(languageForFile("start.asm.bak"), undefined);
  assert.equal(languageForFile("start.sh"), "shell", "a .sh file is still Shell");
  assert.equal(languageForFile("start.sx"), undefined);
  assert.equal(languageForFile("s"), undefined);
  assert.equal(languageForFile("asm"), undefined);
  assert.equal(languageForVscodeId("asm"), "asm");
  assert.equal(languageForVscodeId("arm"), undefined);
  assert.equal(LANGUAGES.asm.label, "Assembly");
  for (const name of ["paper.tex", "PAPER.TEX", "style.sty", "report.cls", "Report.CLS"]) {
    assert.equal(languageForFile(name), "latex", name);
  }
  for (const name of ["paper.tex.bak", "paper.text", "paper.tx", "style.st", "report.cl", "report.class", "paper.texi", "paper.aux", "paper.log", "paper.bib", "paper.bst", "tex", "sty", "cls"]) {
    assert.equal(languageForFile(name), undefined, name);
  }
  assert.equal(languageForVscodeId("latex"), "latex", "VS Code's id for .tex files");
  assert.equal(languageForVscodeId("tex"), "latex", "VS Code's id for .sty and .cls files");
  assert.equal(languageForVscodeId("latex-expl3"), undefined);
  assert.equal(languageForVscodeId("bibtex"), undefined);
  assert.equal(languageForVscodeId(undefined), undefined);
  assert.equal(LANGUAGES.latex.label, "LaTeX");
  assert.equal(LANGUAGE_NAMES, "C, C++, Python, CSS, HTML, JavaScript, TypeScript, React, Rust, Java, C#, Go, PHP, SQL, Shell, Kotlin, Swift, Ruby, Dart, Lua, R, MATLAB, Arduino, Verilog, SystemVerilog, VHDL, Assembly, LaTeX, JSON, YAML and XML");
  assert.equal(LANGUAGE_NAMES_OR, "C, C++, Python, CSS, HTML, JavaScript, TypeScript, React, Rust, Java, C#, Go, PHP, SQL, Shell, Kotlin, Swift, Ruby, Dart, Lua, R, MATLAB, Arduino, Verilog, SystemVerilog, VHDL, Assembly, LaTeX, JSON, YAML or XML");
  for (const name of ["config.json", "CONFIG.JSON", "tsconfig.json", "settings.jsonc", "Data.JSONC"]) {
    assert.equal(languageForFile(name), "json", name);
  }
  for (const name of ["config.json5", "config.jsonl", "config.json.bak", "config.geojson", "json", "jsonc", "config.jso"]) {
    assert.equal(languageForFile(name), undefined, name);
  }
  assert.equal(languageForVscodeId("json"), "json", "VS Code's id for .json files");
  assert.equal(languageForVscodeId("jsonc"), "json", "VS Code's id for tsconfig.json, settings.json and .jsonc files");
  assert.equal(languageForVscodeId("jsonl"), undefined);
  assert.equal(languageForVscodeId("json5"), undefined);
  assert.equal(LANGUAGES.json.label, "JSON");
  for (const name of ["docker-compose.yml", "ci.yaml", "CONFIG.YML", "Data.YAML", "pubspec.yaml"]) {
    assert.equal(languageForFile(name), "yaml", name);
  }
  for (const name of ["a.yaml.bak", "a.yml.tmpl", "a.yamll", "a.ymls", "yaml", "yml", "a.toml", "a.ya"]) {
    assert.equal(languageForFile(name), undefined, name);
  }
  assert.equal(languageForVscodeId("yaml"), "yaml", "VS Code's id for .yml and .yaml files");
  assert.equal(languageForVscodeId("yml"), undefined);
  assert.equal(languageForVscodeId("home-assistant"), undefined);
  assert.equal(LANGUAGES.yaml.label, "YAML");
  for (const name of ["data.xml", "schema.xsd", "style.xsl", "style.xslt", "DATA.XML", "Schema.XSD", "Style.XSLT", "pom.xml"]) {
    assert.equal(languageForFile(name), "xml", name);
  }
  for (const name of ["a.xml.bak", "a.xmls", "a.xmll", "a.xsdl", "a.xslx", "a.xsltt", "a.svg", "a.xhtml", "a.plist", "xml", "xsd", "xslt", "a.xs"]) {
    assert.equal(languageForFile(name), undefined, name);
  }
  assert.equal(languageForVscodeId("xml"), "xml", "VS Code's id for .xml and .xsd files");
  assert.equal(languageForVscodeId("xsl"), "xml", "VS Code's id for .xsl and .xslt files");
  assert.equal(languageForVscodeId("xslt"), undefined);
  assert.equal(languageForVscodeId("html"), "html", "HTML is still HTML");
  assert.equal(languageForVscodeId("svg"), undefined);
  assert.equal(LANGUAGES.xml.label, "XML");
});

test("tokenizer: Arduino sketches use the C++ tokenizer for comments, preprocessor lines, strings and keywords", () => {
  const source = fixture("basic.ino");
  const arduino = LANGUAGES[languageForFile("blink.ino")!].tokenize(source);
  const cpp = tokenizeCpp(source);
  assert.deepEqual(arduino, cpp, "an .ino file is tokenized exactly like C++");
  assert.equal(arduino.map(joinLine).join("\n"), source, "no text lost or changed");
  assert.equal(kindOf(arduino, "// A made-up sketch"), "comment");
  assert.equal(kindOf(arduino, "Wiring:"), "comment", "a block comment over two lines");
  assert.equal(kindOf(arduino, "#include"), "preprocessor");
  assert.equal(kindOf(arduino, "<Servo.h>"), "string");
  assert.equal(kindOf(arduino, '"pins.h"'), "string");
  assert.equal(kindOf(arduino, "Sensor demo // not a comment"), "string", "a // inside a string is not a comment");
  assert.equal(kindOf(arduino, "0x1F4"), "number");
  assert.equal(kindOfWord(arduino, "void"), "keyword");
  assert.equal(kindOfWord(arduino, "if"), "keyword");
});

test("tokenizer: Verilog / SystemVerilog fixture colours", () => {
  const source = fixture("basic.sv");
  const sv = LANGUAGES[languageForFile("top.sv")!].tokenize(source);
  assert.deepEqual(LANGUAGES.verilog.tokenize(source), sv, ".v and .sv use the same tokenizer");
  assert.equal(sv.map(joinLine).join("\n"), source, "no text lost or changed");
  assert.equal(kindOf(sv, "// A made-up toaster timer"), "comment");
  assert.equal(kindOf(sv, "Counts clock ticks"), "comment", "a block comment over two lines");
  assert.equal(kindOf(sv, "`timescale"), "preprocessor");
  assert.equal(kindOf(sv, "`include"), "preprocessor");
  assert.equal(kindOf(sv, "`define"), "preprocessor");
  assert.equal(kindOf(sv, "`TICKS"), "preprocessor", "a macro use is a directive too");
  assert.equal(kindOf(sv, '"toaster_defs.vh"'), "string");
  assert.equal(kindOf(sv, "8'd200"), "number");
  assert.equal(kindOf(sv, "2.5e1"), "number");
  assert.equal(kindOf(sv, "4'b10_1x"), "number");
  assert.equal(kindOf(sv, "16'sd5"), "number");
  assert.equal(kindOf(sv, "1_000"), "number");
  assert.equal(kindOf(sv, "10ns"), "number", "a time literal is one number");
  assert.equal(kindOf(sv, "$display"), "keyword");
  assert.equal(kindOf(sv, "$clog2"), "keyword");
  assert.equal(sv.flat().find((t) => t.text === "(* keep *)")?.kind, "preprocessor", "an attribute is its own token");
  assert.equal(kindOfWord(sv, "module"), "keyword");
  assert.equal(kindOfWord(sv, "endmodule"), "keyword");
  assert.equal(kindOfWord(sv, "always_ff"), "keyword");
  assert.equal(kindOfWord(sv, "posedge"), "keyword");
  assert.equal(kindOfWord(sv, "typedef"), "keyword");
  assert.equal(kindOfWord(sv, "logic"), "type");
  assert.equal(kindOfWord(sv, "wire"), "type");
  assert.equal(kindOfWord(sv, "int"), "type");
  assert.equal(kindOfWord(sv, "state_t"), "plain", "a name made by typedef stays plain");
});

test("tokenizer: Verilog tricky cases", () => {
  // Every token as kind:text, joined with |, and a " // " marks the start of a new line.
  const kinds = (source: string): string => tokenizeVerilog(source).map((l) => l.map((t) => `${t.kind}:${t.text}`).join("|")).join(" // ");

  // Comments.
  assert.equal(kinds("a // b"), "plain:a |comment:// b");
  assert.equal(kinds("a /* b */ c"), "plain:a |comment:/* b */|plain: c");
  assert.equal(kinds("/* a\nb */ c"), "comment:/* a // comment:b */|plain: c");
  assert.equal(kinds("/* /* a */ b */"), "comment:/* /* a */|plain: b */","block comments do not nest");
  assert.equal(kinds("/* never closed\nx"), "comment:/* never closed // comment:x", "an unclosed block comment runs to the end");
  assert.equal(kinds('a = "x // y";'), 'plain:a = |string:"x // y"|plain:;', "a // inside a string is not a comment");

  // Strings.
  assert.equal(kinds('"a\\"b" c'), 'string:"a\\"b"|plain: c', "an escaped quote does not end the string");
  assert.equal(kinds('"a\\nb"'), 'string:"a\\nb"');
  assert.equal(kinds('"no end\nx'), 'string:"no end // plain:x', "a string ends at the line break");
  assert.equal(kinds('"cont\\\nmore" x'), 'string:"cont\\ // string:more"|plain: x', "a backslash before the line break continues the string");
  assert.equal(kinds('"""a\nb""" x'), 'string:"""a // string:b"""|plain: x', "a triple quoted string spans lines");

  // Directives.
  assert.equal(kinds("`define W 8"), "preprocessor:`define|plain: W |number:8");
  assert.equal(kinds("x[`W-1:0]"), "plain:x[|preprocessor:`W|plain:-|number:1|plain::|number:0|plain:]");
  assert.equal(kinds('`include "a.vh"'), 'preprocessor:`include|plain: |string:"a.vh"');
  assert.equal(kinds("`ifdef FOO\n`endif"), "preprocessor:`ifdef|plain: FOO // preprocessor:`endif");
  assert.equal(kinds("`timescale 1ns/1ps"), "preprocessor:`timescale|plain: |number:1ns|plain:/|number:1ps");
  assert.equal(kinds("a``b"), "plain:a|preprocessor:``|plain:b", "`` pastes two words together");
  assert.equal(kinds('`"a`"'), 'preprocessor:`"|plain:a|preprocessor:`"', "a quote inside a macro does not start a string");
  assert.equal(kinds("` x"), "preprocessor:`|plain: x", "a lone backtick is one character");

  // System tasks and functions.
  assert.equal(kinds("$finish;"), "keyword:$finish|plain:;");
  assert.equal(kinds("x = $clog2(N);"), "plain:x = |keyword:$clog2|plain:(N);");
  assert.equal(kinds("q[$]"), "plain:q[$]", "a lone $ is plain");

  // Numbers.
  assert.equal(kinds("42"), "number:42");
  assert.equal(kinds("1_000"), "number:1_000");
  assert.equal(kinds("8'hFF"), "number:8'hFF");
  assert.equal(kinds("8'HFF"), "number:8'HFF");
  assert.equal(kinds("4'b10_1x"), "number:4'b10_1x");
  assert.equal(kinds("16'sd5"), "number:16'sd5");
  assert.equal(kinds("12'o7_7zx"), "number:12'o7_7zx");
  assert.equal(kinds("'d10"), "number:'d10");
  assert.equal(kinds("'hz"), "number:'hz");
  assert.equal(kinds("'sb1"), "number:'sb1");
  assert.equal(kinds("8'h FF;"), "number:8'h FF|plain:;", "a space after the base is fine");
  assert.equal(kinds("8 'hFF"), "number:8 'hFF", "a space before the base is fine");
  assert.equal(kinds("8'h\nFF"), "number:8'h // plain:FF", "a line break after the base ends the number");
  assert.equal(kinds("'0 '1 'x 'z"), "number:'0|plain: |number:'1|plain: |number:'x|plain: |number:'z");
  assert.equal(kinds("x = '1;"), "plain:x = |number:'1|plain:;");
  assert.equal(kinds("1.5"), "number:1.5");
  assert.equal(kinds("2.0e-3"), "number:2.0e-3");
  assert.equal(kinds("1e3"), "number:1e3");
  assert.equal(kinds("1_0.2_5E+2"), "number:1_0.2_5E+2");
  assert.equal(kinds("10ns"), "number:10ns");
  assert.equal(kinds("1.5ps"), "number:1.5ps");
  assert.equal(kinds("100us"), "number:100us");
  assert.equal(kinds("#1step"), "plain:#|number:1step");
  assert.equal(kinds("#5 a"), "plain:#|number:5|plain: a");
  assert.equal(kinds("10nsx"), "number:10|plain:nsx", "ns only counts as a unit when the word ends there");
  assert.equal(kinds("a[1].b"), "plain:a[|number:1|plain:].b", "a dot after a number is not a fraction");
  assert.equal(kinds("x1 y_2"), "plain:x1 y_2", "digits inside a name stay in the name");

  // The apostrophe is never a string quote.
  assert.equal(kinds("x = '{a, b};"), "plain:x = '{a, b};");
  assert.equal(kinds("x = '{1, 2};\ny = 3;"), "plain:x = '{|number:1|plain:, |number:2|plain:}; // plain:y = |number:3|plain:;","the line after an assignment pattern is not swallowed");
  assert.equal(kinds("y = int'(x);"), "plain:y = |type:int|plain:'(x);");
  assert.equal(kinds("y = 16'(x) + 1;"), "plain:y = |number:16|plain:'(x) + |number:1|plain:;");
  assert.equal(kinds("y = it's;"), "plain:y = it's;");

  // Escaped identifiers.
  assert.equal(kinds("wire \\bus+index ;"), "type:wire|plain: \\bus+index ;", "the escaped name ends at the space");
  assert.equal(kinds("\\module x"), "plain:\\module x", "a keyword after the backslash is just a name");
  assert.equal(kinds("a \\x*y\nb"), "plain:a \\x*y // plain:b");
  assert.equal(kinds("`define A x \\\ny"), "preprocessor:`define|plain: A x \\ // plain:y", "a backslash at the end of a line is plain");

  // Attributes and always @(*).
  assert.equal(kinds("(* full_case *) x"), "preprocessor:(* full_case *)|plain: x");
  assert.equal(kinds("(* a *) (* b *) x"), "preprocessor:(* a *)|plain: |preprocessor:(* b *)|plain: x");
  assert.equal(kinds("(* a,\nb *)"), "preprocessor:(* a, // preprocessor:b *)");
  assert.equal(
    kinds("always @(*) begin\n  y = a;\nend"),
    "keyword:always|plain: @(*) |keyword:begin // plain:  y = a; // keyword:end",
    "(*) is not an attribute, so the code after it is still coloured",
  );
  assert.equal(
    kinds("always @ (*) begin\n  y = 1;\nend"),
    "keyword:always|plain: @ (*) |keyword:begin // plain:  y = |number:1|plain:; // keyword:end",
  );
  assert.equal(kinds("always @(*)\n  y = 1;"), "keyword:always|plain: @(*) // plain:  y = |number:1|plain:;");
  assert.equal(kinds("(* never closed\nx"), "plain:(* never closed // plain:x", "an attribute with no end is plain");
  assert.equal(kinds("foo (.*);"), "plain:foo (.*);", "an implicit port list is plain");
  assert.equal(kinds("a = (b)*(c);"), "plain:a = (b)*(c);");

  // Keywords, types and names.
  assert.equal(kinds("module m; endmodule"), "keyword:module|plain: m; |keyword:endmodule");
  assert.equal(kinds("Module"), "plain:Module", "keywords are case-sensitive");
  assert.equal(kinds("BEGIN"), "plain:BEGIN");
  assert.equal(kinds("beginning"), "plain:beginning", "a keyword inside a longer name is not a keyword");
  assert.equal(kinds("input wire [7:0] d;"), "keyword:input|plain: |type:wire|plain: [|number:7|plain::|number:0|plain:] d;");
  // Only the coloured tokens, as kind:text, so the plain spaces between words don't get in the way.
  const colored = (source: string): string => tokenizeVerilog(source).flat().filter((t) => t.kind !== "plain").map((t) => `${t.kind}:${t.text}`).join(" ");
  assert.equal(colored("logic bit byte int shortint longint integer real time reg"), "type:logic type:bit type:byte type:int type:shortint type:longint type:integer type:real type:time type:reg");
  assert.equal(colored("wire tri supply0 supply1 wand wor string void"), "type:wire type:tri type:supply0 type:supply1 type:wand type:wor type:string type:void");
  assert.equal(colored("always_ff always_comb always_latch"), "keyword:always_ff keyword:always_comb keyword:always_latch");
  assert.equal(colored("class endclass extends virtual interface endinterface modport package endpackage"), "keyword:class keyword:endclass keyword:extends keyword:virtual keyword:interface keyword:endinterface keyword:modport keyword:package keyword:endpackage");
  assert.equal(colored("assign initial always posedge negedge generate endgenerate genvar"), "keyword:assign keyword:initial keyword:always keyword:posedge keyword:negedge keyword:generate keyword:endgenerate type:genvar");
  assert.equal(colored("case casez casex endcase default function endfunction task endtask fork join"), "keyword:case keyword:casez keyword:casex keyword:endcase keyword:default keyword:function keyword:endfunction keyword:task keyword:endtask keyword:fork keyword:join");
  assert.equal(colored("parameter localparam signed unsigned specify endspecify defparam"), "keyword:parameter keyword:localparam keyword:signed keyword:unsigned keyword:specify keyword:endspecify keyword:defparam");
  assert.equal(colored("typedef enum struct union packed unique priority return break continue do foreach"), "keyword:typedef keyword:enum keyword:struct keyword:union keyword:packed keyword:unique keyword:priority keyword:return keyword:break keyword:continue keyword:do keyword:foreach");
  assert.equal(colored("automatic static const new null this super program endprogram property endproperty"), "keyword:automatic keyword:static keyword:const keyword:new keyword:null keyword:this keyword:super keyword:program keyword:endprogram keyword:property keyword:endproperty");
  assert.equal(colored("sequence endsequence assert assume cover constraint rand randc covergroup endgroup clocking endclocking import export"), "keyword:sequence keyword:endsequence keyword:assert keyword:assume keyword:cover keyword:constraint keyword:rand keyword:randc keyword:covergroup keyword:endgroup keyword:clocking keyword:endclocking keyword:import keyword:export");
  assert.equal(kinds("a or b and c"), "plain:a |keyword:or|plain: b |keyword:and|plain: c");
  assert.equal(kinds("q.size()"), "plain:q.size()");
  assert.equal(kinds("x.type = 1;"), "plain:x.type = |number:1|plain:;", "a name after a dot is never a keyword");
  assert.equal(kinds(".clk(clk)"), "plain:.clk(clk)");
  assert.equal(kinds("a$b $x"), "plain:a$b |keyword:$x", "$ can be inside a name");
  assert.equal(kinds("a <= b ? c : d;"), "plain:a <= b ? c : d;");
  assert.equal(kinds("é = 1"), "plain:é = |number:1");

  // Odd input never loses text or crashes.
  for (const source of ["", "'", "`", "$", "\\", "(*", "(* x", "\"", '"""', "8'", "8'h", "1e", "1e+", "'s", "/*", "//", "a\r\nb"]) {
    const lines = tokenizeVerilog(source);
    assert.equal(lines.map(joinLine).join("\n"), source, `lost text for ${JSON.stringify(source)}`);
  }
});

test("languages: the other languages are not changed by Verilog", () => {
  assert.equal(languageForFile("a.m"), "matlab");
  assert.equal(languageForFile("a.h"), "cpp");
  assert.equal(languageForFile("a.ino"), "arduino");
  assert.equal(languageForFile("a.vue"), undefined);
  // The same text in another language is not read as Verilog: `define and $display are not special in C++.
  assert.equal(kindOf(tokenizeCpp("$display"), "$display"), "plain");
  assert.equal(kindOfWord(tokenizeCpp("always_ff"), "always_ff"), "plain");
  assert.equal(kindOfWord(tokenizeCpp("endmodule"), "endmodule"), "plain");
});

test("tokenizer: VHDL fixture colours", () => {
  const source = fixture("basic.vhd");
  const vhdl = LANGUAGES[languageForFile("top.vhd")!].tokenize(source);
  assert.equal(vhdl.map(joinLine).join("\n"), source, "no text lost or changed");
  assert.equal(kindOf(vhdl, "-- A made-up toaster timer"), "comment");
  assert.equal(kindOf(vhdl, "Counts clock ticks"), "comment", "a block comment over two lines");
  assert.equal(kindOf(vhdl, "The heater stays on"), "comment");
  assert.equal(kindOf(vhdl, "x\"C8\""), "number", "a bit string is one number");
  assert.equal(kindOf(vhdl, "b\"10_1X\""), "number");
  assert.equal(kindOf(vhdl, "12X\"0FF\""), "number", "a VHDL-2008 sized bit string");
  assert.equal(kindOf(vhdl, "16#FF#"), "number");
  assert.equal(kindOf(vhdl, "2#1010_1010#"), "number");
  assert.equal(kindOf(vhdl, "1_000"), "number");
  assert.equal(kindOf(vhdl, "2.5e1"), "number");
  assert.equal(kindOf(vhdl, "10 ns"), "number", "a time unit belongs to its number");
  assert.equal(kindOf(vhdl, "'0'"), "string", "a character literal");
  assert.equal(kindOf(vhdl, "\"Bad width: \"\"ticks\"\"\""), "string", "a doubled quote stays inside the string");
  assert.equal(kindOfWord(vhdl, "entity"), "keyword");
  assert.equal(kindOfWord(vhdl, "architecture"), "keyword");
  assert.equal(kindOfWord(vhdl, "downto"), "keyword");
  assert.equal(kindOfWord(vhdl, "others"), "keyword");
  assert.equal(kindOfWord(vhdl, "generate"), "keyword");
  assert.equal(kindOfWord(vhdl, "std_logic"), "type");
  assert.equal(kindOfWord(vhdl, "std_logic_vector"), "type");
  assert.equal(kindOfWord(vhdl, "unsigned"), "type");
  assert.equal(kindOfWord(vhdl, "integer"), "type");
  assert.equal(kindOfWord(vhdl, "rising_edge"), "plain", "rising_edge is a function, not a keyword");
  assert.equal(kindOfWord(vhdl, "state_t"), "plain", "a name made by type ... is stays plain");
  assert.equal(kindOf(vhdl, "\\bus+index\\"), "plain", "an extended identifier is plain");
});

test("tokenizer: VHDL tricky cases", () => {
  // Every token as kind:text, joined with |, and a " // " marks the start of a new line.
  const kinds = (source: string): string => tokenizeVhdl(source).map((l) => l.map((t) => `${t.kind}:${t.text}`).join("|")).join(" // ");

  // Comments.
  assert.equal(kinds("a -- b"), "plain:a |comment:-- b");
  assert.equal(kinds("a /* b */ c"), "plain:a |comment:/* b */|plain: c");
  assert.equal(kinds("/* a\nb */ c"), "comment:/* a // comment:b */|plain: c");
  assert.equal(kinds("/* /* a */ b */"), "comment:/* /* a */|plain: b */", "block comments do not nest");
  assert.equal(kinds("/* never closed\nx"), "comment:/* never closed // comment:x", "an unclosed block comment runs to the end");
  assert.equal(kinds('a <= "x -- y";'), 'plain:a <= |string:"x -- y"|plain:;', "a -- inside a string is not a comment");
  assert.equal(kinds("a--b"), "plain:a|comment:--b", "-- starts a comment even with no space");
  assert.equal(kinds("a - b"), "plain:a - b", "one dash is a minus");
  assert.equal(kinds("a / b"), "plain:a / b");
  assert.equal(kinds("a /= b"), "plain:a /= b", "/= is an operator, not a comment");

  // Case does not matter for keywords and types.
  assert.equal(kinds("ENTITY Foo IS"), "keyword:ENTITY|plain: Foo |keyword:IS");
  assert.equal(kinds("Begin"), "keyword:Begin");
  assert.equal(kinds("STD_LOGIC_Vector"), "type:STD_LOGIC_Vector");
  assert.equal(kinds("Signal x : Std_Logic;"), "keyword:Signal|plain: x : |type:Std_Logic|plain:;");
  assert.equal(kinds("a Xor b NAND c"), "plain:a |keyword:Xor|plain: b |keyword:NAND|plain: c");
  assert.equal(kinds("a sll 2 rol 1"), "plain:a |keyword:sll|plain: |number:2|plain: |keyword:rol|plain: |number:1");
  assert.equal(kinds("a mod b rem c abs d"), "plain:a |keyword:mod|plain: b |keyword:rem|plain: c |keyword:abs|plain: d");
  assert.equal(kinds("rising_edge(clk)"), "plain:rising_edge(clk)", "rising_edge is not a keyword");
  assert.equal(kinds("port map (a => b)"), "keyword:port|plain: |keyword:map|plain: (a => b)");
  assert.equal(kinds("in out inout buffer"), "keyword:in|plain: |keyword:out|plain: |keyword:inout|plain: |keyword:buffer");
  assert.equal(kinds("x to y"), "plain:x |keyword:to|plain: y");
  assert.equal(kinds("entity_name"), "plain:entity_name", "a word that only starts with a keyword is plain");
  assert.equal(kinds("natural positive boolean signed"), "type:natural|plain: |type:positive|plain: |type:boolean|plain: |type:signed");

  // Character literals.
  assert.equal(kinds("x <= '0';"), "plain:x <= |string:'0'|plain:;");
  assert.equal(kinds("x <= 'Z';"), "plain:x <= |string:'Z'|plain:;");
  assert.equal(kinds("(others => '1')"), "plain:(|keyword:others|plain: => |string:'1'|plain:)", "a character after => is a literal");
  assert.equal(kinds("when '1' =>"), "keyword:when|plain: |string:'1'|plain: =>", "a character after a keyword is a literal");
  assert.equal(kinds("else '0'"), "keyword:else|plain: |string:'0'");
  assert.equal(kinds("x <= ''';"), "plain:x <= |string:'''|plain:;", "''' is the character literal for a quote");
  assert.equal(kinds("c = ''' and d"), "plain:c = |string:'''|plain: |keyword:and|plain: d");
  assert.equal(kinds("x <= ' ';"), "plain:x <= |string:' '|plain:;", "a space character literal");
  assert.equal(kinds("x = 'a' or y = 'b'"), "plain:x = |string:'a'|plain: |keyword:or|plain: y = |string:'b'");
  assert.equal(kinds("('(')"), "plain:(|string:'('|plain:)", "a bracket character literal");

  // Attribute ticks.
  assert.equal(kinds("clk'event"), "plain:clk'event", "an attribute is not a character literal");
  assert.equal(kinds("clk'event and clk = '1'"), "plain:clk'event |keyword:and|plain: clk = |string:'1'");
  assert.equal(kinds("x'length"), "plain:x'length");
  assert.equal(kinds("for i in a'range loop"), "keyword:for|plain: i |keyword:in|plain: a'range |keyword:loop", "range after a tick is plain");
  assert.equal(kinds("a'reverse_range"), "plain:a'reverse_range");
  assert.equal(kinds("data(3)'length"), "plain:data(|number:3|plain:)'length", "a tick after a closing bracket is an attribute");
  assert.equal(kinds("v'high - v'low"), "plain:v'high - v'low");
  assert.equal(kinds("clk'event and clk'last_value = '0'"), "plain:clk'event |keyword:and|plain: clk'last_value = |string:'0'");
  assert.equal(kinds("integer'image(i)"), "type:integer|plain:'image(i)", "a type can have an attribute");
  assert.equal(kinds("t'subtype"), "plain:t'subtype", "subtype after a tick is plain");
  assert.equal(kinds("s'delayed(1 ns)'event"), "plain:s'delayed(|number:1 ns|plain:)'event");
  assert.equal(kinds("a'(b)"), "plain:a'(b)");
  assert.equal(kinds("Clk'Event"), "plain:Clk'Event");

  // Qualified expressions.
  assert.equal(kinds("std_logic'('1')"), "type:std_logic|plain:'(|string:'1'|plain:)", "a tick after a type, then a character literal");
  assert.equal(kinds("unsigned'(x\"F\")"), "type:unsigned|plain:'(|number:x\"F\"|plain:)");
  assert.equal(kinds("my_t'(a, b)"), "plain:my_t'(a, b)");
  assert.equal(kinds("character'(''')"), "type:character|plain:'(|string:'''|plain:)", "a quote character inside a qualified expression");

  // Strings.
  assert.equal(kinds('"a""b" c'), 'string:"a""b"|plain: c', 'a doubled "" does not end the string');
  assert.equal(kinds('""'), 'string:""', "an empty string");
  assert.equal(kinds('"""" x'), 'string:""""|plain: x', 'a string holding one quote');
  assert.equal(kinds('"a\\nb"'), 'string:"a\\nb"', "a backslash is not an escape");
  assert.equal(kinds('"no end\nx'), 'string:"no end // plain:x', "a string ends at the line break");
  assert.equal(kinds('report "a" & "b"'), 'keyword:report|plain: |string:"a"|plain: & |string:"b"');

  // Bit strings.
  assert.equal(kinds('x"FF"'), 'number:x"FF"');
  assert.equal(kinds('X"ff"'), 'number:X"ff"', "the prefix can be upper case");
  assert.equal(kinds('b"1010"'), 'number:b"1010"');
  assert.equal(kinds('B"1010"'), 'number:B"1010"');
  assert.equal(kinds('o"17"'), 'number:o"17"');
  assert.equal(kinds('d"15"'), 'number:d"15"');
  assert.equal(kinds('8x"FF"'), 'number:8x"FF"', "VHDL-2008 sized");
  assert.equal(kinds('12UB"1_0"'), 'number:12UB"1_0"');
  assert.equal(kinds('ux"FF"'), 'number:ux"FF"');
  assert.equal(kinds('UX"F-Z"'), 'number:UX"F-Z"');
  assert.equal(kinds('sx"F"'), 'number:sx"F"');
  assert.equal(kinds('SB"01"'), 'number:SB"01"');
  assert.equal(kinds('uo"7"'), 'number:uo"7"');
  assert.equal(kinds('x"F" & x"0"'), 'number:x"F"|plain: & |number:x"0"');
  assert.equal(kinds('x "FF"'), 'plain:x |string:"FF"', "a space makes it a name and a string");
  assert.equal(kinds('ax"FF"'), 'plain:ax|string:"FF"', "a name that ends in x is not a bit string");
  assert.equal(kinds('x"F\nG"'), 'number:x"F // plain:G|string:"', "a bit string ends at the line break");

  // Numbers.
  assert.equal(kinds("42"), "number:42");
  assert.equal(kinds("1_000"), "number:1_000");
  assert.equal(kinds("3.14"), "number:3.14");
  assert.equal(kinds("1.0e-3"), "number:1.0e-3");
  assert.equal(kinds("1E+6"), "number:1E+6");
  assert.equal(kinds("2e3"), "number:2e3");
  assert.equal(kinds("16#FF#"), "number:16#FF#");
  assert.equal(kinds("2#1010_1010#"), "number:2#1010_1010#");
  assert.equal(kinds("16#F.F#E2"), "number:16#F.F#E2");
  assert.equal(kinds("8#77#"), "number:8#77#");
  assert.equal(kinds("16#ff#"), "number:16#ff#");
  assert.equal(kinds("a(7 downto 0)"), "plain:a(|number:7|plain: |keyword:downto|plain: |number:0|plain:)");
  assert.equal(kinds("x := 16#FF"), "plain:x := |number:16|plain:#FF", "a based number with no closing # is not one number");
  assert.equal(kinds("1e"), "number:1|plain:e", "an exponent needs digits");
  assert.equal(kinds("10 ns"), "number:10 ns");
  assert.equal(kinds("2.5 us"), "number:2.5 us");
  assert.equal(kinds("100 ps"), "number:100 ps");
  assert.equal(kinds("5 sec"), "number:5 sec");
  assert.equal(kinds("wait for 20 NS;"), "keyword:wait|plain: |keyword:for|plain: |number:20 NS|plain:;");
  assert.equal(kinds("10 nsx"), "number:10|plain: nsx", "a longer name is not a unit");
  assert.equal(kinds("x(1) + 1"), "plain:x(|number:1|plain:) + |number:1");

  // Extended identifiers.
  assert.equal(kinds("\\foo bar\\"), "plain:\\foo bar\\");
  assert.equal(kinds("signal \\a end\\ : bit;"), "keyword:signal|plain: \\a end\\ : |type:bit|plain:;", "a keyword inside \\...\\ stays plain");
  assert.equal(kinds("\\a\\\\b\\ x"), "plain:\\a\\\\b\\ x", "a doubled backslash is inside the name");
  assert.equal(kinds("\\a -- b\\"), "plain:\\a -- b\\", "-- inside an extended identifier is not a comment");
  assert.equal(kinds("\\never closed\nx"), "plain:\\never closed // plain:x", "an extended identifier ends at the line break");
  assert.equal(kinds("\\a\\'length"), "plain:\\a\\'length", "an extended identifier can have an attribute");

  // Operators.
  assert.equal(kinds("a <= b := c => d /= e ** f >= g ?= h"), "plain:a <= b := c => d /= e ** f >= g ?= h");
  assert.equal(kinds("a & b ; c : d"), "plain:a & b ; c : d");
  assert.equal(kinds("<< signal .tb.x : bit >>"), "plain:<< |keyword:signal|plain: .tb.x : |type:bit|plain: >>");
  assert.equal(kinds("use ieee.std_logic_1164.all;"), "keyword:use|plain: ieee.std_logic_1164.|keyword:all|plain:;");
  assert.equal(kinds("library work;"), "keyword:library|plain: work;", "work is a normal name");

  // Other.
  assert.equal(kinds(""), "");
  assert.equal(kinds("a\n\nb"), "plain:a //  // plain:b");
  assert.equal(kinds("x <= '😀';"), "plain:x <= '😀';", "a character literal holds one character, so an emoji is not one");
  assert.equal(kinds("日本 <= 1;"), "plain:日本 <= |number:1|plain:;");
});

test("tokenizer: VHDL keeps every character, even in broken code", () => {
  for (const source of ["", "'", "''", "'''", "''''", "x'", "x\"", "\"", "\\", "\\a", "/*", "/* a", "--", "16#", "16#F", "1.", "1e+", "a'\n", "'\n'", "x\"F", "8x", "(*", "-- é\r\nx", "\t'a'\t", "'😀'", "<<", "a ' b"]) {
    const lines = tokenizeVhdl(source);
    assert.equal(lines.map(joinLine).join("\n"), source, `lost text for ${JSON.stringify(source)}`);
  }
});

test("languages: other languages do not read VHDL words and VHDL does not read theirs", () => {
  assert.equal(kindOfWord(tokenizeCpp("architecture"), "architecture"), "plain");
  assert.equal(kindOfWord(tokenizeVerilog("architecture"), "architecture"), "plain");
  assert.equal(kindOfWord(tokenizeVerilog("ENTITY"), "ENTITY"), "plain", "Verilog is case-sensitive");
  assert.equal(kindOfWord(tokenizeVhdl("module"), "module"), "plain");
  assert.equal(kindOfWord(tokenizeVhdl("always"), "always"), "plain");
  assert.equal(kindOf(tokenizeVhdl("$display"), "$display"), "plain");
  assert.equal(kindOf(tokenizeVhdl("// hello there"), "// hello there"), "plain");
  assert.equal(kindOf(tokenizeVhdl("# hello there"), "# hello there"), "plain");
});

test("tokenizer: Assembly fixture colours", () => {
  const source = fixture("basic.s");
  const asm = LANGUAGES[languageForFile("start.s")!].tokenize(source);
  assert.equal(asm.map(joinLine).join("\n"), source, "no text lost or changed");
  assert.equal(kindOf(asm, "@ A made-up toaster"), "comment", "an ARM @ comment");
  assert.equal(kindOf(asm, "Counts the seconds"), "comment", "a block comment over two lines");
  assert.equal(kindOf(asm, "then stops the heater"), "comment");
  assert.equal(kindOf(asm, "#include"), "preprocessor", "a # followed by include is a C preprocessor line");
  assert.equal(kindOf(asm, "#define"), "preprocessor");
  assert.equal(kindOf(asm, "// seconds left"), "comment");
  assert.equal(kindOf(asm, "@ save the registers"), "comment");
  assert.equal(kindOf(asm, ".syntax"), "preprocessor");
  assert.equal(kindOf(asm, ".globl"), "preprocessor");
  assert.equal(kindOf(asm, ".asciz"), "preprocessor");
  assert.equal(kindOf(asm, "\"Toast is ready!\\n\""), "string");
  assert.equal(kindOf(asm, "'T'"), "string", "a character literal");
  assert.equal(kindOf(asm, "0xFF"), "number");
  assert.equal(kindOf(asm, "0b1010"), "number");
  assert.equal(kindOf(asm, "#-4"), "number", "an ARM immediate");
  assert.equal(kindOf(asm, "#0x10"), "number");
  assert.equal(kindOf(asm, "1f"), "number", "a local label reference");
  assert.equal(kindOfWord(asm, "push"), "keyword");
  assert.equal(kindOfWord(asm, "subs"), "keyword");
  assert.equal(kindOfWord(asm, "bne"), "keyword");
  assert.equal(kindOfWord(asm, "svc"), "keyword");
  assert.equal(kindOfWord(asm, "r4"), "type", "a register");
  assert.equal(kindOfWord(asm, "lr"), "type");
  assert.equal(kindOfWord(asm, "pc"), "type");
  assert.equal(kindOfWord(asm, "sp"), "type");
  assert.equal(kindOfWord(asm, "main"), "plain", "a label name is plain");
  assert.equal(kindOfWord(asm, "msg"), "plain");
  assert.equal(kindOfWord(asm, "function"), "plain", "%function and @function are plain");
});

test("tokenizer: Assembly tricky cases", () => {
  // Every token as kind:text, joined with |, and a " // " marks the start of a new line.
  const kinds = (source: string): string => tokenizeAsm(source).map((l) => l.map((t) => `${t.kind}:${t.text}`).join("|")).join(" // ");

  // Comments.
  assert.equal(kinds("nop ; hi"), "keyword:nop|plain: |comment:; hi");
  assert.equal(kinds("nop // hi"), "keyword:nop|plain: |comment:// hi");
  assert.equal(kinds("/* a */ nop"), "comment:/* a */|plain: |keyword:nop");
  assert.equal(kinds("/* a\nb */ nop"), "comment:/* a // comment:b */|plain: |keyword:nop", "a block comment over lines, then an instruction");
  assert.equal(kinds("/* never closed\nnop"), "comment:/* never closed // comment:nop", "an unclosed block comment runs to the end");
  assert.equal(kinds("mov r0, r1 /* x */ ; y"), "keyword:mov|plain: |type:r0|plain:, |type:r1|plain: |comment:/* x */|plain: |comment:; y");
  assert.equal(kinds("mov r0, a / b"), "keyword:mov|plain: |type:r0|plain:, a / b", "one slash is not a comment");

  // The # sign: comment, ARM immediate or C preprocessor.
  assert.equal(kinds("# whole line"), "comment:# whole line");
  assert.equal(kinds("  # indented"), "plain:  |comment:# indented");
  assert.equal(kinds("#!shell"), "comment:#!shell", "a # with an unknown word is a comment");
  assert.equal(kinds("mov r0, #5"), "keyword:mov|plain: |type:r0|plain:, |number:#5", "# before a digit after a comma is a number");
  assert.equal(kinds("mov r0, #0x10"), "keyword:mov|plain: |type:r0|plain:, |number:#0x10");
  assert.equal(kinds("ldr r0, [r1, #-4]"), "keyword:ldr|plain: |type:r0|plain:, [|type:r1|plain:, |number:#-4|plain:]");
  assert.equal(kinds("ldr r0, [r1,#4]!"), "keyword:ldr|plain: |type:r0|plain:, [|type:r1|plain:,|number:#4|plain:]!");
  assert.equal(kinds("svc #0"), "keyword:svc|plain: |number:#0", "# right after the instruction name, before a digit");
  assert.equal(kinds("mov r0, #SECONDS"), "keyword:mov|plain: |type:r0|plain:, #SECONDS", "#name is an immediate, so no comment");
  assert.equal(kinds("add a0, a0, 1 # add one"), "keyword:add|plain: |type:a0|plain:, |type:a0|plain:, |number:1|plain: |comment:# add one", "# after a number is a comment");
  assert.equal(kinds("mov r0, r1 #5"), "keyword:mov|plain: |type:r0|plain:, |type:r1|plain: |comment:#5", "# after a register is a comment");
  assert.equal(kinds("ret #done"), "keyword:ret|plain: |comment:#done", "# and a word right after the name is a comment");
  assert.equal(kinds("nop # note"), "keyword:nop|plain: |comment:# note");
  assert.equal(kinds("mov r0, # note"), "keyword:mov|plain: |type:r0|plain:, |comment:# note", "# and a space is always a comment");
  assert.equal(kinds("main: # note"), "plain:main: |comment:# note");
  assert.equal(kinds("#include <x.h>"), "preprocessor:#include|plain: <x.h>");
  assert.equal(kinds('#include "x.h"'), 'preprocessor:#include|plain: |string:"x.h"');
  assert.equal(kinds("#define N 5"), "preprocessor:#define|plain: N |number:5");
  assert.equal(kinds("  #endif"), "plain:  |preprocessor:#endif");
  assert.equal(kinds("#ifdef DEBUG // x"), "preprocessor:#ifdef|plain: DEBUG |comment:// x");
  assert.equal(kinds("# define x"), "comment:# define x", "a space after the # makes it a comment");
  assert.equal(kinds("#includes"), "comment:#includes", "only whole preprocessor words count");
  assert.equal(kinds("#define MOVE mov r0, r1"), "preprocessor:#define|plain: MOVE mov |type:r0|plain:, |type:r1", "after a preprocessor word no word is read as the instruction name");

  // The @ sign.
  assert.equal(kinds("@ start of line"), "comment:@ start of line");
  assert.equal(kinds("mov r0, r1 @ note"), "keyword:mov|plain: |type:r0|plain:, |type:r1|plain: |comment:@ note");
  assert.equal(kinds(".type f, @function"), "preprocessor:.type|plain: f, @function", "@function after a comma is not a comment");
  assert.equal(kinds('.section .text, "ax", @progbits'), 'preprocessor:.section|plain: .text, |string:"ax"|plain:, @progbits');
  assert.equal(kinds(".type f, %function"), "preprocessor:.type|plain: f, %function");
  assert.equal(kinds("call foo@PLT"), "keyword:call|plain: foo@PLT", "a relocation name keeps its @");
  assert.equal(kinds("mov rax, [rip + x@GOTPCREL]").includes("comment"), false);
  assert.equal(kinds("mov r0, r1@note").includes("comment"), false, "an @ with no space before it is not a comment");

  // Labels.
  assert.equal(kinds("main:"), "plain:main:");
  assert.equal(kinds(".Lloop:"), "plain:.Lloop:");
  assert.equal(kinds("1:"), "plain:1:");
  assert.equal(kinds("1: b 1b"), "plain:1: |keyword:b|plain: |number:1b", "a numeric local label and a reference to it");
  assert.equal(kinds("_start: mov eax, 1"), "plain:_start: |keyword:mov|plain: |type:eax|plain:, |number:1");
  assert.equal(kinds("a: b: nop"), "plain:a: b: |keyword:nop", "two labels in a row");
  assert.equal(kinds("$L1:"), "plain:$L1:", "a MIPS style label");
  assert.equal(kinds("mov r0, x:"), "keyword:mov|plain: |type:r0|plain:, x:", "a colon later in the line is not a label");

  // Directives.
  assert.equal(kinds(".text"), "preprocessor:.text");
  assert.equal(kinds("  .globl main"), "plain:  |preprocessor:.globl|plain: main");
  assert.equal(kinds("section .text"), "preprocessor:section|plain: .text");
  assert.equal(kinds("SECTION .DATA"), "preprocessor:SECTION|plain: .DATA", "case does not matter");
  assert.equal(kinds("global _start"), "preprocessor:global|plain: _start");
  assert.equal(kinds("extern puts"), "preprocessor:extern|plain: puts");
  assert.equal(kinds("[bits 32]"), "plain:[|preprocessor:bits|plain: |number:32|plain:]");
  assert.equal(kinds('msg db "hi", 0'), 'plain:msg |preprocessor:db|plain: |string:"hi"|plain:, |number:0', "a name before db is a label with no colon");
  assert.equal(kinds("len equ $ - msg"), "plain:len |preprocessor:equ|plain: $ - msg");
  assert.equal(kinds("buf resb 64"), "plain:buf |preprocessor:resb|plain: |number:64");
  assert.equal(kinds("  dd 1, 2"), "plain:  |preprocessor:dd|plain: |number:1|plain:, |number:2");
  assert.equal(kinds("times 510-($-$$) db 0"), "preprocessor:times|plain: |number:510|plain:-($-$$) |preprocessor:db|plain: |number:0");
  assert.equal(kinds("%define X 5"), "preprocessor:%define|plain: X |number:5");
  assert.equal(kinds("%macro m 1"), "preprocessor:%macro|plain: m |number:1");
  assert.equal(kinds("rep movsb"), "keyword:rep|plain: |keyword:movsb", "a prefix does not hide the instruction");
  assert.equal(kinds("lock cmpxchg [x], eax"), "keyword:lock|plain: |keyword:cmpxchg|plain: [x], |type:eax");
  assert.equal(kinds("."), "plain:.", "a lone dot is not a directive");

  // Registers.
  assert.equal(kinds("mov %rax, %rbx"), "keyword:mov|plain: |type:%rax|plain:, |type:%rbx");
  assert.equal(kinds("mov RAX, Eax"), "keyword:mov|plain: |type:RAX|plain:, |type:Eax", "case does not matter");
  assert.equal(kinds("mov eax, [rbp-8]"), "keyword:mov|plain: |type:eax|plain:, [|type:rbp|plain:-|number:8|plain:]");
  assert.equal(kinds("mov r8d, r15"), "keyword:mov|plain: |type:r8d|plain:, |type:r15");
  assert.equal(kinds("mov r99, r16"), "keyword:mov|plain: r99, |type:r16", "r99 is not a register");
  assert.equal(kinds("movaps xmm0, xmm15"), "keyword:movaps|plain: |type:xmm0|plain:, |type:xmm15");
  assert.equal(kinds("mov x0, w30"), "keyword:mov|plain: |type:x0|plain:, |type:w30");
  assert.equal(kinds("addi sp, sp, -16"), "keyword:addi|plain: |type:sp|plain:, |type:sp|plain:, -|number:16");
  assert.equal(kinds("add a0, t1, s11"), "keyword:add|plain: |type:a0|plain:, |type:t1|plain:, |type:s11");
  assert.equal(kinds("jalr zero, ra"), "keyword:jalr|plain: |type:zero|plain:, |type:ra");
  assert.equal(kinds("lw $t0, 4($sp)"), "keyword:lw|plain: |type:$t0|plain:, |number:4|plain:(|type:$sp|plain:)");
  assert.equal(kinds("move $a0, $zero"), "keyword:move|plain: |type:$a0|plain:, |type:$zero");
  assert.equal(kinds("move $a0, $at"), "keyword:move|plain: |type:$a0|plain:, |type:$at");
  assert.equal(kinds("ld1 {v0.16b}, [x0]"), "keyword:ld1|plain: {|type:v0|plain:.16b}, [|type:x0|plain:]", "a register with a suffix after the dot");
  assert.equal(kinds("mov r0, foo"), "keyword:mov|plain: |type:r0|plain:, foo", "a name is plain");
  assert.equal(kinds("mov dword [x], 5"), "keyword:mov|plain: |type:dword|plain: [x], |number:5");
  assert.equal(kinds("r0"), "keyword:r0", "the first word on a line is always the instruction name");

  // Numbers.
  assert.equal(kinds("mov eax, 0FFh"), "keyword:mov|plain: |type:eax|plain:, |number:0FFh", "a NASM hex number");
  assert.equal(kinds("mov al, 1010b"), "keyword:mov|plain: |type:al|plain:, |number:1010b", "a NASM binary number");
  assert.equal(kinds("mov al, 0b1010"), "keyword:mov|plain: |type:al|plain:, |number:0b1010");
  assert.equal(kinds("mov al, 0xff"), "keyword:mov|plain: |type:al|plain:, |number:0xff");
  assert.equal(kinds("dd 3.14, 1e-3, 2.5E+2"), "preprocessor:dd|plain: |number:3.14|plain:, |number:1e-3|plain:, |number:2.5E+2");
  assert.equal(kinds("movl $42, %eax"), "keyword:movl|plain: |number:$42|plain:, |type:%eax", "an AT&T immediate");
  assert.equal(kinds("addl $-4, %esp"), "keyword:addl|plain: |number:$-4|plain:, |type:%esp");
  assert.equal(kinds("movl $0x10, 4(%rsp)"), "keyword:movl|plain: |number:$0x10|plain:, |number:4|plain:(|type:%rsp|plain:)");
  assert.equal(kinds("movl $foo, %eax"), "keyword:movl|plain: $foo, |type:%eax", "a $ before a name is plain");
  assert.equal(kinds("add $1, $2, $3"), "keyword:add|plain: |number:$1|plain:, |number:$2|plain:, |number:$3", "a $ and digits is always a number");
  assert.equal(kinds("bne 2b"), "keyword:bne|plain: |number:2b");
  assert.equal(kinds("mov r0, 0x1e+5"), "keyword:mov|plain: |type:r0|plain:, |number:0x1e|plain:+|number:5", "a hex number with an e is not an exponent");
  assert.equal(kinds("mov r0, 1.x"), "keyword:mov|plain: |type:r0|plain:, |number:1|plain:.x", "a dot without a digit after it is not a fraction");

  // Strings and characters.
  assert.equal(kinds('.ascii "a\\"b"'), 'preprocessor:.ascii|plain: |string:"a\\"b"', "an escaped quote stays inside the string");
  assert.equal(kinds('.ascii "a;b # c"'), 'preprocessor:.ascii|plain: |string:"a;b # c"', "comment signs inside a string are text");
  assert.equal(kinds('.ascii "abc\nnop'), 'preprocessor:.ascii|plain: |string:"abc // keyword:nop', "an unclosed string stops at the end of the line");
  assert.equal(kinds("db 'hello', 0"), "preprocessor:db|plain: |string:'hello'|plain:, |number:0");
  assert.equal(kinds("mov r0, #'a'"), "keyword:mov|plain: |type:r0|plain:, |string:#'a'", "an immediate character is one token");
  assert.equal(kinds("mov r0, #'a"), "keyword:mov|plain: |type:r0|plain:, |string:#'a", "GNU as allows a character with no closing quote");
  assert.equal(kinds(".byte 'a, 'b'"), "preprocessor:.byte|plain: |string:'a|plain:, |string:'b'", "an unclosed 'a does not run into the next character");
  assert.equal(kinds(".byte 'a'"), "preprocessor:.byte|plain: |string:'a'");
  assert.equal(kinds(".byte ';'"), "preprocessor:.byte|plain: |string:';'", "a ; inside a character is text");
  assert.equal(kinds(".byte '\\n'"), "preprocessor:.byte|plain: |string:'\\n'", "an escape is one character");
  assert.equal(kinds(".byte '\\n"), "preprocessor:.byte|plain: |string:'\\n");
  assert.equal(kinds(".byte '\\'', 1"), "preprocessor:.byte|plain: |string:'\\''|plain:, |number:1");
  assert.equal(kinds("db 'hello', 0"), "preprocessor:db|plain: |string:'hello'|plain:, |number:0", "a NASM string with an even number of quotes");
  assert.equal(kinds("db 'it', 0, 'a'"), "preprocessor:db|plain: |string:'it'|plain:, |number:0|plain:, |string:'a'", "two NASM strings");
  assert.equal(kinds("db '\nnop"), "preprocessor:db|plain: |string:' // keyword:nop", "a lone quote at the end of a line");
  assert.equal(kinds("db `a\\nb`"), "preprocessor:db|plain: |string:`a\\nb`", "a NASM backtick string");
  assert.equal(kinds('nop ; "not a string'), 'keyword:nop|plain: |comment:; "not a string');
  assert.equal(kinds('nop ; it\'s fine'), "keyword:nop|plain: |comment:; it's fine");

  // Other.
  assert.equal(kinds(""), "");
  assert.equal(kinds("a\n\nb"), "keyword:a //  // keyword:b");
  assert.equal(kinds("日本 r0"), "plain:日本 |type:r0", "a first word that is not a name is plain");
  assert.equal(kinds("mov r0, '😀'"), "keyword:mov|plain: |type:r0|plain:, |string:'😀'");
});

test("tokenizer: Assembly keeps every character, even in broken code", () => {
  for (const source of ["", "#", "# ", "@", ";", "/", "/*", "/* a", "//", "'", "''", "\"", "`", "$", "$$", "$-", "%", "%%", "%1", "[", "0x", "0b", "1e", "1e+", "1.", "#-", "#'", ".", "..", "a:", ":", "::", "label:\r\nnop", "\t#5\t", "mov r0, #", "mov r0, #\n", "@\n@", "😀", "mov 😀, #5", "foo@", "foo@PLT@", "x'\n'y", "\\", "#include", "#include\n#define"]) {
    const lines = tokenizeAsm(source);
    assert.equal(lines.map(joinLine).join("\n"), source, `lost text for ${JSON.stringify(source)}`);
  }
});

test("languages: other languages do not read Assembly rules and Assembly does not read theirs", () => {
  assert.equal(kindOfWord(tokenizeCpp("mov"), "mov"), "plain");
  assert.equal(kindOf(tokenizeCpp("; hello there"), "; hello there"), "plain");
  assert.equal(kindOf(tokenizeCpp("#include <x>"), "#include"), "preprocessor");
  assert.equal(kindOf(tokenizePython("# hello there"), "# hello there"), "comment");
  assert.equal(kindOf(tokenizeShell("# hello there"), "# hello there"), "comment");
  assert.equal(kindOf(tokenizeVhdl("-- hello there"), "-- hello there"), "comment");
  assert.equal(kindOf(tokenizeVerilog("// hello there"), "// hello there"), "comment");
  assert.equal(kindOfWord(tokenizeVerilog("section"), "section"), "plain");
  assert.equal(kindOfWord(tokenizeAsm("nop entity"), "entity"), "plain", "VHDL words are only plain words");
  assert.equal(kindOf(tokenizeAsm("-- hello there"), "-- hello there"), "plain", "a -- is not a comment");
  assert.ok(isSupportedSource("a.s") && isSupportedSource("A.S") && isSupportedSource("a.asm") && isSupportedSource("A.ASM"));
  assert.ok(!isSupportedSource("a.s.bak") && !isSupportedSource("a.sx") && !isSupportedSource("a.inc") && !isSupportedSource("a.a51"));
});

test("tokenizer: LaTeX fixture colours", () => {
  const source = fixture("basic.tex");
  const tex = LANGUAGES[languageForFile("paper.tex")!].tokenize(source);
  assert.equal(tex.map(joinLine).join("\n"), source, "no text lost or changed");
  assert.equal(kindOf(tex, "% A made-up LaTeX note"), "comment");
  assert.equal(kindOf(tex, "% stir well"), "comment", "a comment after text on the same line");
  assert.equal(kindOf(tex, "\\documentclass"), "keyword");
  assert.equal(kindOf(tex, "12pt"), "number", "a number with its unit");
  assert.equal(kindOf(tex, "\\usepackage"), "keyword");
  assert.equal(kindOf(tex, "\\newcommand"), "keyword");
  assert.equal(kindOf(tex, "\\loaf"), "keyword", "a command the file made up");
  assert.equal(kindOf(tex, "#1"), "plain", "a macro parameter is not a number");
  assert.equal(kindOf(tex, "\\begin"), "keyword");
  assert.equal(kindOfWord(tex, "document"), "type", "an environment name");
  assert.equal(kindOf(tex, "itemize"), "type");
  assert.equal(kindOf(tex, "\\section"), "keyword");
  assert.equal(kindOf(tex, "100"), "number");
  assert.equal(kindOf(tex, "\\%"), "keyword", "an escaped percent sign is one token, not a comment");
  assert.equal(kindOf(tex, "2.5cm"), "number");
  assert.equal(kindOf(tex, "\\$"), "keyword", "an escaped dollar sign does not open math");
  assert.equal(kindOf(tex, "\\&"), "keyword");
  assert.equal(kindOf(tex, "$x^2 + 3$"), "string", "inline math");
  assert.equal(kindOf(tex, "y = \\frac{a}{b}"), "string", "display math over several lines");
  assert.equal(kindOf(tex, "% the ratio"), "comment", "a comment inside math");
  assert.equal(kindOf(tex, "\\verb"), "keyword");
  assert.equal(kindOf(tex, "|%not a comment|"), "plain", "\\verb text is plain");
  assert.equal(kindOf(tex, "0.5"), "number");
  assert.equal(kindOf(tex, "\\textwidth"), "keyword", "the command after a number is its own token");
  assert.equal(kindOf(tex, "\\\\"), "keyword", "a line break command");
  assert.equal(kindOf(tex, "% not a comment"), "plain", "verbatim text is plain");
  assert.equal(kindOf(tex, "\\notacommand $ stays plain"), "plain", "no commands or math inside verbatim");
});

test("tokenizer: LaTeX tricky cases", () => {
  // Every token as kind:text, joined with |, and a " // " marks the start of a new line.
  const kinds = (source: string): string => tokenizeLatex(source).map((l) => l.map((t) => `${t.kind}:${t.text}`).join("|")).join(" // ");

  // Comments and escaped percent signs.
  assert.equal(kinds("a % b"), "plain:a |comment:% b");
  assert.equal(kinds("% a\nb"), "comment:% a // plain:b");
  assert.equal(kinds("50\\% off"), "number:50|keyword:\\%|plain: off", "\\% is not a comment");
  assert.equal(kinds("a\\\\% x"), "plain:a|keyword:\\\\|comment:% x", "\\\\ is a line break, so the % after it is a comment");
  assert.equal(kinds("\\\\\\% x"), "keyword:\\\\\\%|plain: x", "a line break and then an escaped percent sign");
  assert.equal(kinds("% $x$ \\verb|a|"), "comment:% $x$ \\verb|a|", "nothing inside a comment is read");
  assert.equal(kinds("% $x\n$y$"), "comment:% $x // string:$y$", "a $ in a comment does not open math");

  // Commands and control symbols.
  assert.equal(kinds("\\section*{A}"), "keyword:\\section|plain:*{A}");
  assert.equal(kinds("\\@ifnextchar["), "keyword:\\@ifnextchar|plain:[", "an @ counts as a letter");
  assert.equal(kinds("\\my@macro x"), "keyword:\\my@macro|plain: x");
  assert.equal(kinds("\\foo2"), "keyword:\\foo|number:2", "digits end a command name");
  assert.equal(kinds("\\{x\\}"), "keyword:\\{|plain:x|keyword:\\}");
  assert.equal(kinds("a\\,b\\;c\\ d"), "plain:a|keyword:\\,|plain:b|keyword:\\;|plain:c|keyword:\\ |plain:d");
  assert.equal(kinds("a\\&b"), "plain:a|keyword:\\&|plain:b");
  assert.equal(kinds("\\😀x"), "keyword:\\😀|plain:x", "a control symbol can be a character outside the basic range");
  assert.equal(kinds("a\\"), "plain:a|keyword:\\", "a backslash at the end of the file");
  assert.equal(kinds("a\\\nb"), "plain:a|keyword:\\ // plain:b", "a backslash at the end of a line");
  assert.equal(kinds("\\)"), "keyword:\\)", "a closing \\) with no opener is just a control symbol");

  // Math.
  assert.equal(kinds("a $b$ c"), "plain:a |string:$b$|plain: c");
  assert.equal(kinds("$$x$$ y"), "string:$$x$$|plain: y");
  assert.equal(kinds("\\(x\\) y"), "string:\\(x\\)|plain: y");
  assert.equal(kinds("\\[x\\] y"), "string:\\[x\\]|plain: y");
  assert.equal(kinds("\\$5 and $x$"), "keyword:\\$|number:5|plain: and |string:$x$", "\\$ in text does not open math");
  assert.equal(kinds("$a\\$b$ c"), "string:$a\\$b$|plain: c", "\\$ inside math does not close it");
  assert.equal(kinds("$a\\\\$ c"), "string:$a\\\\$|plain: c", "after a \\\\ the $ closes the math");
  assert.equal(kinds("$$a$b$$ c"), "string:$$a$b$$|plain: c", "a single $ inside $$ does not close it");
  assert.equal(kinds("$a$ $b$"), "string:$a$|plain: |string:$b$");
  assert.equal(kinds("\\( a \\$ \\) b"), "string:\\( a \\$ \\)|plain: b");
  assert.equal(kinds("\\[ a \\\\ b \\] c"), "string:\\[ a \\\\ b \\]|plain: c", "a line break inside math");
  assert.equal(kinds("$a\nb$"), "string:$a // string:b$", "math over two lines");
  assert.equal(kinds("$a % c\nb$"), "string:$a |comment:% c // string:b$", "a comment inside math ends at the line break");
  assert.equal(kinds("$a \\% c$ d"), "string:$a \\% c$|plain: d", "\\% inside math is not a comment");
  assert.equal(kinds("$a\n\nb"), "string:$a //  // plain:b", "a blank line ends math that was never closed");
  assert.equal(kinds("$a\n  \n% real"), "string:$a // plain:   // comment:% real", "a line of only spaces counts as blank");
  assert.equal(kinds("$$a\n\nb"), "string:$$a //  // plain:b");
  assert.equal(kinds("\\[a\n\nb"), "string:\\[a //  // plain:b");
  assert.equal(kinds("$a"), "string:$a", "math never closed at the end of the file");
  assert.equal(kinds("\\[a"), "string:\\[a");
  assert.equal(kinds("$"), "string:$");
  assert.equal(kinds("$é$ 😀"), "string:$é$|plain: 😀");

  // \verb.
  assert.equal(kinds("\\verb|a%b| c"), "keyword:\\verb|plain:|a%b| c", "no comment inside \\verb");
  assert.equal(kinds("\\verb+a $ \\b+ c"), "keyword:\\verb|plain:+a $ \\b+ c", "any character can be the delimiter");
  assert.equal(kinds("\\verb*|a b|"), "keyword:\\verb*|plain:|a b|", "the starred form");
  assert.equal(kinds("\\verb|a\nb|"), "keyword:\\verb|plain:|a // plain:b|", "the closing delimiter has to be on the same line");
  assert.equal(kinds("\\verb|a"), "keyword:\\verb|plain:|a", "never closed, so only the command is coloured");
  assert.equal(kinds("\\verb"), "keyword:\\verb");
  assert.equal(kinds("\\verb x"), "keyword:\\verb|plain: x", "a space is not a delimiter");
  assert.equal(kinds("\\verbatim|a|"), "keyword:\\verbatim|plain:|a|", "a different command that starts with verb");

  // Verbatim environments.
  assert.equal(
    kinds("\\begin{verbatim}\n% x\n\\foo $\n\\end{verbatim} % real"),
    "keyword:\\begin|plain:{|type:verbatim|plain:} // plain:% x // plain:\\foo $ // keyword:\\end|plain:{|type:verbatim|plain:} |comment:% real",
    "the body is plain, then the \\end is read as normal",
  );
  assert.equal(kinds("\\begin{verbatim*}a%b\\end{verbatim*}"), "keyword:\\begin|plain:{|type:verbatim*|plain:}a%b|keyword:\\end|plain:{|type:verbatim*|plain:}");
  assert.equal(
    kinds("\\begin{lstlisting}[language=C]\nint x; % c\n\\end{lstlisting}"),
    "keyword:\\begin|plain:{|type:lstlisting|plain:}[language=C] // plain:int x; % c // keyword:\\end|plain:{|type:lstlisting|plain:}",
  );
  assert.equal(kinds("\\begin{minted}{python}\n# x $\n\\end{minted}"), "keyword:\\begin|plain:{|type:minted|plain:}{python} // plain:# x $ // keyword:\\end|plain:{|type:minted|plain:}");
  assert.equal(kinds("\\begin{comment}\n\\bad $\n\\end{comment}"), "keyword:\\begin|plain:{|type:comment|plain:} // plain:\\bad $ // keyword:\\end|plain:{|type:comment|plain:}");
  assert.equal(kinds("\\begin{verbatim}\n\\end{itemize}\n\\end{verbatim}"), "keyword:\\begin|plain:{|type:verbatim|plain:} // plain:\\end{itemize} // keyword:\\end|plain:{|type:verbatim|plain:}", "a different \\end does not stop it");
  assert.equal(kinds("\\begin{verbatim}\n% x\n$"), "keyword:\\begin|plain:{|type:verbatim|plain:} // plain:% x // plain:$", "never closed, so it runs to the end of the file");
  assert.equal(kinds("\\begin {verbatim}x\\end {verbatim}"), "keyword:\\begin|plain: {|type:verbatim|plain:}x|keyword:\\end|plain: {|type:verbatim|plain:}", "spaces before the brace");
  assert.equal(kinds("\\begin{Verbatim}\n% x"), "keyword:\\begin|plain:{|type:Verbatim|plain:} // comment:% x", "names are case-sensitive, so this is not verbatim");
  assert.equal(kinds("\\end{verbatim}\n% x"), "keyword:\\end|plain:{|type:verbatim|plain:} // comment:% x", "an \\end alone starts nothing");

  // Environments.
  assert.equal(kinds("\\begin{itemize}\n% x"), "keyword:\\begin|plain:{|type:itemize|plain:} // comment:% x");
  assert.equal(kinds("\\begin{align*}"), "keyword:\\begin|plain:{|type:align*|plain:}");
  assert.equal(kinds("\\end{my-env_2}"), "keyword:\\end|plain:{|type:my-env_2|plain:}");
  assert.equal(kinds("\\begin"), "keyword:\\begin");
  assert.equal(kinds("\\begin{}"), "keyword:\\begin|plain:{}", "an empty name is not an environment");
  assert.equal(kinds("\\begin{a b}"), "keyword:\\begin|plain:{a b}", "a name with a space is not an environment");
  assert.equal(kinds("\\begin{a"), "keyword:\\begin|plain:{a");
  assert.equal(kinds("\\beginx{a}"), "keyword:\\beginx|plain:{a}", "a different command that starts with begin");
  assert.equal(kinds("\\newenvironment{box}"), "keyword:\\newenvironment|plain:{box}", "only \\begin and \\end name environments");

  // Numbers and units.
  assert.equal(kinds("12pt"), "number:12pt");
  assert.equal(kinds("2.5cm"), "number:2.5cm");
  assert.equal(kinds("0.5\\textwidth"), "number:0.5|keyword:\\textwidth", "the number and the command are separate");
  assert.equal(kinds("1.5em"), "number:1.5em");
  assert.equal(kinds(".5in"), "number:.5in");
  assert.equal(kinds("3x"), "number:3|plain:x");
  assert.equal(kinds("12points"), "number:12|plain:points", "a unit has to be a whole word");
  assert.equal(kinds("1,5"), "number:1|plain:,|number:5");
  assert.equal(kinds("2."), "number:2|plain:.");
  assert.equal(kinds("[width=0.5\\linewidth]"), "plain:[width=|number:0.5|keyword:\\linewidth|plain:]");
  assert.equal(kinds("fig1 table22"), "plain:fig1 table22", "digits inside a word are not numbers");
  assert.equal(kinds("\\vspace{12pt}"), "keyword:\\vspace|plain:{|number:12pt|plain:}");

  // Macro parameters, operators and brackets.
  assert.equal(kinds("#1 and ##2"), "plain:#1 and ##2");
  assert.equal(kinds("#"), "plain:#");
  assert.equal(kinds("\\def\\a#1#2{x}"), "keyword:\\def\\a|plain:#1#2{x}");
  assert.equal(kinds("a & b ~ c"), "plain:a & b ~ c");
  assert.equal(kinds("{[()]}"), "plain:{[()]}");

  // Other.
  assert.equal(kinds(""), "");
  assert.equal(kinds("a\n\nb"), "plain:a //  // plain:b");
  assert.equal(kinds("é ü 日本"), "plain:é ü 日本");
});

test("tokenizer: LaTeX keeps every character, even in broken code", () => {
  for (const source of ["", "\\", "\\\\", "%", "$", "$$", "$$$", "$$$$", "\\(", "\\[", "\\)", "\\]", "\\begin", "\\begin{", "\\begin{verbatim", "\\begin{verbatim}", "\\begin{verbatim}\\end", "\\begin{verbatim}\\end{verbatim", "\\end{", "\\verb", "\\verb|", "\\verb*", "\\verb||", "\\verb*|a", "#", "##", "0", ".", ".5", "1.", "1.5.", "\\😀", "😀", "$😀$", "a\r\nb", "$a\r\n\r\nb$", "\\@", "\\@@", "{", "}", "\\\n\n", "$\\", "$%", "$\\%", "\\[\\\\", "\\verb\n|"]) {
    const lines = tokenizeLatex(source);
    assert.equal(lines.map(joinLine).join("\n"), source, `lost text for ${JSON.stringify(source)}`);
  }
  // A big file with an unclosed $ every few lines is still read in one go (no slow loops).
  const big = "a $b\n\nc \\begin{verbatim}\nx\n".repeat(2000);
  assert.equal(tokenizeLatex(big).map(joinLine).join("\n"), big);
});

test("languages: other languages do not read LaTeX rules and LaTeX does not read theirs", () => {
  assert.equal(kindOf(tokenizeCpp("% hello there"), "% hello there"), "plain");
  assert.equal(kindOf(tokenizeAsm("\\section"), "\\section"), "plain");
  assert.equal(kindOf(tokenizeLatex("// hello there"), "// hello there"), "plain", "// is not a comment");
  assert.equal(kindOf(tokenizeLatex("# hello there"), "# hello there"), "plain");
  assert.equal(kindOfWord(tokenizeLatex("int return"), "return"), "plain", "C words are only plain words");
  assert.equal(kindOf(tokenizeLatex("\"a\""), "\"a\""), "plain", "a double quote does not start a string");
  assert.ok(isSupportedSource("a.tex") && isSupportedSource("a.sty") && isSupportedSource("a.cls") && isSupportedSource("A.TEX"));
  assert.ok(!isSupportedSource("a.tex.bak") && !isSupportedSource("a.text") && !isSupportedSource("a.bib") && !isSupportedSource("a.aux"));
});

test("package.json: all five menu rules match .tex, .sty and .cls and no look-alike extensions", () => {
  const manifest = JSON.parse(readFileSync(`${ROOT}/package.json`, "utf8")) as { contributes: { menus: Record<string, { when: string }[]> } };
  const rules = Object.values(manifest.contributes.menus).flat().map((item) => item.when).filter((when) => when.includes("resourceExtname"));
  assert.equal(rules.length, 5, "five menu rules use the extension list");
  for (const when of rules) {
    const regex = new RegExp(/resourceExtname =~ \/(.*)\/i/.exec(when)![1]!, "i");
    for (const ext of [".tex", ".sty", ".cls", ".TEX", ".Cls", ".cpp", ".s", ".asm", ".vhd"]) {
      assert.ok(regex.test(ext), `${ext} should match in: ${when}`);
    }
    for (const ext of [".text", ".tx", ".te", ".st", ".sty2", ".cl", ".class", ".clsx", ".texi", ".stylus", ".aux", ".bib", ".log", "tex", ".tex.bak", ".xtex"]) {
      assert.ok(!regex.test(ext), `${ext} should not match in: ${when}`);
    }
  }
});

test("tokenizer: JSON fixture colours", () => {
  const source = fixture("basic.json");
  const json = LANGUAGES[languageForFile("config.json")!].tokenize(source);
  assert.equal(json.map(joinLine).join("\n"), source, "no text lost or changed");
  assert.equal(kindOf(json, "// A made-up settings file"), "comment");
  assert.equal(kindOf(json, "\"name\""), "type", "a key");
  assert.equal(kindOf(json, "\"bread-timer\""), "string", "a value");
  assert.equal(kindOf(json, "\"oven\""), "type", "a key whose value is an object");
  assert.equal(kindOf(json, "-12.5"), "number");
  assert.equal(kindOf(json, "1.2E-3"), "number");
  assert.equal(kindOf(json, "1e10"), "number");
  assert.equal(kindOf(json, "-0"), "number");
  assert.equal(kindOf(json, "false"), "keyword");
  assert.equal(kindOf(json, "null"), "keyword");
  assert.equal(kindOf(json, "\"bake \\\"slow\\\" \\\\ crème é\""), "string", "escaped quotes and backslashes stay inside the string");
  assert.equal(kindOf(json, "/* Where the app looks"), "comment", "a block comment over two lines");
  assert.equal(kindOf(json, "one URL per line. */"), "comment");
  assert.equal(kindOf(json, "\"http://bakery.example/recipes\""), "string", "// inside a string is not a comment");
  assert.equal(kindOf(json, "\"oops"), "string", "a string with no closing quote ends at the line break");
  assert.equal(kindOf(json, "\"tags\""), "type", "the line after the broken string is read normally");
  assert.equal(joinLine(json[json.length - 2]!), "}", "and so is the closing brace");
});

test("tokenizer: JSON tricky cases", () => {
  // Every token as kind:text, joined with |, and a " // " marks the start of a new line.
  const kinds = (source: string): string => tokenizeJson(source).map((l) => l.map((t) => `${t.kind}:${t.text}`).join("|")).join(" // ");

  // Keys and values.
  assert.equal(kinds("{\"a\": 1}"), "plain:{|type:\"a\"|plain:: |number:1|plain:}");
  assert.equal(kinds("\"a\" \t : 1"), "type:\"a\"|plain: \t : |number:1", "spaces before the colon");
  assert.equal(kinds("\"a\"\n: 1"), "string:\"a\" // plain:: |number:1", "a colon on the next line is not looked for");
  assert.equal(kinds("[\"a\", \"b\"]"), "plain:[|string:\"a\"|plain:, |string:\"b\"|plain:]");
  assert.equal(kinds("\"a:b\""), "string:\"a:b\"", "a colon inside a string");
  assert.equal(kinds("\"\": 0"), "type:\"\"|plain:: |number:0", "an empty key");

  // Strings.
  assert.equal(kinds("\"a\\\"b\""), "string:\"a\\\"b\"", "an escaped quote");
  assert.equal(kinds("\"a\\\\\" 1"), "string:\"a\\\\\"|plain: |number:1", "an escaped backslash right before the closing quote");
  assert.equal(kinds("\"é\\u00e9😀\""), "string:\"é\\u00e9😀\"");
  assert.equal(kinds("\"abc\n1"), "string:\"abc // number:1", "an open string stops at the line break");
  assert.equal(kinds("\"abc\\\n1"), "string:\"abc\\ // number:1", "a backslash at the end of a line does not continue the string");
  assert.equal(kinds("\"abc: 1"), "string:\"abc: 1", "an open string is never a key");
  assert.equal(kinds("\"abc"), "string:\"abc");
  assert.equal(kinds("\""), "string:\"");

  // Numbers and words.
  assert.equal(kinds("-1"), "number:-1");
  assert.equal(kinds("0.5"), "number:0.5");
  assert.equal(kinds("1e10"), "number:1e10");
  assert.equal(kinds("1.2E-3"), "number:1.2E-3");
  assert.equal(kinds("2e+5"), "number:2e+5");
  assert.equal(kinds("-0"), "number:-0");
  assert.equal(kinds("[1,-2]"), "plain:[|number:1|plain:,|number:-2|plain:]");
  assert.equal(kinds("-"), "plain:-");
  assert.equal(kinds("- 1"), "plain:- |number:1");
  assert.equal(kinds("1."), "number:1|plain:.", "a dot with no digits after it is not part of the number");
  assert.equal(kinds(".5"), "plain:.|number:5");
  assert.equal(kinds("12ab"), "plain:12ab", "letters stuck to a number make it plain");
  assert.equal(kinds("abc123"), "plain:abc123", "digits inside a word are not a number");
  assert.equal(kinds("true,false,null"), "keyword:true|plain:,|keyword:false|plain:,|keyword:null");
  assert.equal(kinds("trueish"), "plain:trueish");
  assert.equal(kinds("True"), "plain:True", "the words are lower case only");
  assert.equal(kinds("nulls"), "plain:nulls");
  assert.equal(kinds("NaN"), "plain:NaN");

  // Comments.
  assert.equal(kinds("1 // x\n2"), "number:1|plain: |comment:// x // number:2");
  assert.equal(kinds("/* a\nb */ 1"), "comment:/* a // comment:b */|plain: |number:1", "a block comment over lines");
  assert.equal(kinds("/* a"), "comment:/* a", "a block comment with no end runs to the end of the file");
  assert.equal(kinds("/**/1"), "comment:/**/|number:1");
  assert.equal(kinds("/*/ 1"), "comment:/*/ 1", "/*/ does not close itself");
  assert.equal(kinds("\"a // b\""), "string:\"a // b\"");
  assert.equal(kinds("\"a /* b\" 1 */"), "string:\"a /* b\"|plain: |number:1|plain: */", "a /* inside a string starts nothing");
  assert.equal(kinds("// \"a\": 1"), "comment:// \"a\": 1", "nothing inside a comment is read");
  assert.equal(kinds("/ 1"), "plain:/ |number:1", "a single slash is plain");

  // Anything invalid is plain text.
  assert.equal(kinds("'a': 1"), "plain:'a': |number:1", "single quotes are not strings");
  assert.equal(kinds("{a: b}"), "plain:{a: b}");
  assert.equal(kinds("@#%"), "plain:@#%");
  assert.equal(kinds("﻿{}"), "plain:﻿{}", "a byte order mark at the start");
  assert.equal(kinds(""), "");
  assert.equal(kinds("a\n\nb"), "plain:a //  // plain:b");
});

test("tokenizer: JSON keeps every character, even in broken code", () => {
  for (const source of ["", "\"", "\"\\", "\"\\\"", "\\", "/", "//", "/*", "/**", "/*/", "*/", "-", "--1", "1e", "1e+", "1.e5", "0x1F", "{", "}", "[", "]", ":", ",", "\"a\":", "\"a\" :", "\"😀\"", "😀", "\"a\r\nb\"", "1 // x\r\n2", "\"a\\\r\nb\"", "@", "\u0000", "\"\u0000\""]) {
    const lines = tokenizeJson(source);
    assert.equal(lines.map(joinLine).join("\n"), source, `lost text for ${JSON.stringify(source)}`);
  }
  // A big file with an unclosed string on every line is still read in one go (no slow loops).
  const big = "{\"a\": \"b\n\"c\": 1,\n/* x\n".repeat(2000);
  assert.equal(tokenizeJson(big).map(joinLine).join("\n"), big);
});

test("languages: other languages do not read JSON rules and JSON does not read theirs", () => {
  assert.equal(kindOf(tokenizeCpp("\"a\": 1"), "\"a\""), "string", "other languages have no keys");
  assert.equal(kindOf(tokenizeLatex("true"), "true"), "plain");
  assert.equal(kindOf(tokenizeJson("# hello there"), "# hello there"), "plain", "# is not a comment");
  assert.equal(kindOf(tokenizeJson("% hello there"), "% hello there"), "plain");
  assert.equal(kindOfWord(tokenizeJson("int return"), "return"), "plain", "C words are only plain words");
  assert.equal(kindOfWord(tokenizeJson("null"), "null"), "keyword");
  assert.ok(isSupportedSource("a.json") && isSupportedSource("a.jsonc") && isSupportedSource("A.JSON"));
  assert.ok(!isSupportedSource("a.json5") && !isSupportedSource("a.jsonl") && !isSupportedSource("a.json.bak") && !isSupportedSource("a.geojson"));
});

test("package.json: all five menu rules match .json and .jsonc and no look-alike extensions", () => {
  const manifest = JSON.parse(readFileSync(`${ROOT}/package.json`, "utf8")) as { contributes: { menus: Record<string, { when: string }[]> } };
  const rules = Object.values(manifest.contributes.menus).flat().map((item) => item.when).filter((when) => when.includes("resourceExtname"));
  assert.equal(rules.length, 5, "five menu rules use the extension list");
  for (const when of rules) {
    const regex = new RegExp(/resourceExtname =~ \/(.*)\/i/.exec(when)![1]!, "i");
    for (const ext of [".json", ".jsonc", ".JSON", ".Jsonc", ".tex", ".cpp"]) {
      assert.ok(regex.test(ext), `${ext} should match in: ${when}`);
    }
    for (const ext of [".json5", ".jsonl", ".jso", ".jsonc2", ".geojson", ".ejson", "json", ".json.bak"]) {
      assert.ok(!regex.test(ext), `${ext} should not match in: ${when}`);
    }
  }
});

test("tokenizer: YAML fixture colours", () => {
  const source = fixture("basic.yaml");
  const yaml = LANGUAGES[languageForFile("config.yaml")!].tokenize(source);
  assert.equal(yaml.map(joinLine).join("\n"), source, "no text lost or changed");
  assert.equal(kindOf(yaml, "# A made-up settings file"), "comment");
  assert.equal(kindOf(yaml, "%YAML 1.2"), "preprocessor", "a directive");
  assert.equal(kindOf(yaml, "---"), "preprocessor", "a document marker");
  assert.equal(kindOf(yaml, "name"), "type", "a key");
  assert.equal(kindOf(yaml, "bread-timer"), "plain", "a plain value");
  assert.equal(kindOf(yaml, "false"), "keyword");
  assert.equal(kindOf(yaml, "~"), "keyword");
  assert.equal(kindOf(yaml, "Null"), "keyword");
  assert.equal(kindOf(yaml, "-12.5"), "number");
  assert.equal(kindOf(yaml, "0x1F"), "number");
  assert.equal(kindOf(yaml, "0o17"), "number");
  assert.equal(kindOf(yaml, ".inf"), "number");
  assert.equal(kindOf(yaml, "180"), "number");
  assert.equal(kindOf(yaml, "1e3"), "number");
  assert.equal(kindOf(yaml, "url"), "type");
  assert.equal(kindOf(yaml, "http://bakery.example/recipes#top"), "plain", "no comment in a url");
  assert.equal(kindOf(yaml, "a#b is not a comment"), "plain", "a # with no space before it is text");
  assert.equal(kindOf(yaml, "# but this is"), "comment");
  assert.equal(kindOf(yaml, "crème é # not a comment"), "string", "a # inside double quotes");
  assert.equal(kindOf(yaml, "it''s # not a comment"), "string", "a # inside single quotes, with an escaped quote");
  assert.equal(kindOf(yaml, "&base"), "keyword", "an anchor");
  assert.equal(kindOf(yaml, "*base"), "keyword", "an alias");
  assert.equal(kindOf(yaml, "<<"), "type", "a merge key");
  assert.equal(kindOf(yaml, "!!str"), "preprocessor", "a tag");
  assert.equal(kindOf(yaml, "\"fan speed\""), "type", "a quoted key");
  assert.equal(kindOf(yaml, "crusty"), "type", "a key inside {}");
  assert.equal(kindOfWord(yaml, "true"), "keyword", "a value inside {}");
  assert.equal(kindOfWord(yaml, "no"), "plain", "no is not a keyword");
  assert.equal(kindOf(yaml, "'another one'"), "string", "a quoted list item");
  assert.equal(kindOf(yaml, "script"), "type");
  assert.equal(kindOf(yaml, "echo \"# not a comment\""), "string", "block scalar text");
  assert.equal(kindOf(yaml, "echo yes"), "string");
  assert.equal(kindOf(yaml, "|"), "string", "the | itself");
  assert.equal(kindOf(yaml, "# still text"), "string", "a # in a >- block is not a comment");
  assert.equal(kindOf(yaml, "folded"), "type", "the key after a block scalar is read normally");
  assert.equal(kindOf(yaml, "a string"), "string", "a double quoted string over two lines");
  assert.equal(kindOf(yaml, "over two lines"), "string");
  assert.equal(kindOf(yaml, "..."), "preprocessor");
  assert.equal(kindOf(yaml, "second"), "type", "a key in the second document");
  assert.equal(kindOf(yaml, "\"oops"), "string", "a quote with no end stops at the line break");
  assert.deepEqual(yaml[yaml.length - 2]!.map((t) => `${t.kind}:${t.text}`), ["type:last", "plain:: ", "number:1"], "and the next line is read normally");
});

test("tokenizer: YAML tricky cases", () => {
  // Every token as kind:text, joined with |, and a " // " marks the start of a new line.
  const kinds = (source: string): string => tokenizeYaml(source).map((l) => l.map((t) => `${t.kind}:${t.text}`).join("|")).join(" // ");
  // The kind of the last token on the first line of "a: <value>".
  const valueKind = (value: string): string => {
    const line = tokenizeYaml(`a: ${value}`)[0]!;
    return line[line.length - 1]!.kind;
  };

  // Comments.
  assert.equal(kinds("# top"), "comment:# top");
  assert.equal(kinds("  # indented"), "plain:  |comment:# indented");
  assert.equal(kinds("a: b # c"), "type:a|plain:: b |comment:# c");
  assert.equal(kinds("a: b\t# c"), "type:a|plain:: b\t|comment:# c", "a tab before the #");
  assert.equal(kinds("a: b #"), "type:a|plain:: b |comment:#");
  assert.equal(kinds("a: b#c"), "type:a|plain:: b#c", "no space before the #");
  assert.equal(kinds("a#b: c"), "type:a#b|plain:: c");
  assert.equal(kinds("url: http://x#frag"), "type:url|plain:: http://x#frag");
  assert.equal(kinds("a: \"b\"#c"), "type:a|plain:: |string:\"b\"|plain:#c", "a # right after a closing quote is text");
  assert.equal(kinds("a: \"b\" #c"), "type:a|plain:: |string:\"b\"|plain: |comment:#c");
  assert.equal(kinds("\"a # b\""), "string:\"a # b\"");
  assert.equal(kinds("'a # b'"), "string:'a # b'");
  assert.equal(kinds("# a: 1"), "comment:# a: 1", "nothing inside a comment is read");

  // Keys.
  assert.equal(kinds("a: 1"), "type:a|plain:: |number:1");
  assert.equal(kinds("a:"), "type:a|plain::");
  assert.equal(kinds("a b c: 1"), "type:a b c|plain:: |number:1", "a key with spaces");
  assert.equal(kinds("a : 1"), "type:a|plain: : |number:1", "a space before the colon");
  assert.equal(kinds("a:\tb"), "type:a|plain::\tb", "a tab after the colon");
  assert.equal(kinds("key:value"), "plain:key:value", "no space after the colon, so no key");
  assert.equal(kinds("http://x"), "plain:http://x");
  assert.equal(kinds("a: http://x"), "type:a|plain:: http://x");
  assert.equal(kinds("time: 12:30:00"), "type:time|plain:: 12:30:00");
  assert.equal(kinds("1: x"), "type:1|plain:: x", "a key that looks like a number");
  assert.equal(kinds("true: x"), "type:true|plain:: x", "a key that looks like a keyword");
  assert.equal(kinds(": a"), "plain:: a", "an empty key");
  assert.equal(kinds("\"a\": 1"), "type:\"a\"|plain:: |number:1", "a double quoted key");
  assert.equal(kinds("'a': 1"), "type:'a'|plain:: |number:1", "a single quoted key");
  assert.equal(kinds("\"a\" : 1"), "type:\"a\"|plain: : |number:1");
  assert.equal(kinds("\"a\":1"), "string:\"a\"|plain::1", "no space after the colon outside {}");
  assert.equal(kinds("\"a\""), "string:\"a\"", "a quoted string with no colon is a value");
  assert.equal(kinds("a: \"b\": c"), "type:a|plain:: |type:\"b\"|plain:: c", "the same rule applies to every quoted string");
  assert.equal(kinds("- a: 1"), "plain:- |type:a|plain:: |number:1", "a key after a list dash");
  assert.equal(kinds("- \"q\": 1"), "plain:- |type:\"q\"|plain:: |number:1");
  assert.equal(kinds("- x"), "plain:- x");
  assert.equal(kinds("-x"), "plain:-x", "a dash with no space is part of a value");
  assert.equal(kinds("-"), "plain:-");
  assert.equal(kinds("a: b, c"), "type:a|plain:: b, c", "commas are text outside {} and []");
  assert.equal(kinds("ключ: значение 😀"), "type:ключ|plain:: значение 😀");

  // Quoted strings.
  assert.equal(kinds("'it''s'"), "string:'it''s'", "'' is an escaped quote");
  assert.equal(kinds("'a\\' b"), "string:'a\\'|plain: b", "no backslash escapes in single quotes");
  assert.equal(kinds("\"a\\\"b\""), "string:\"a\\\"b\"", "an escaped quote in double quotes");
  assert.equal(kinds("\"a\\\\\" c"), "string:\"a\\\\\"|plain: c", "an escaped backslash right before the closing quote");
  assert.equal(kinds("\"a\nb\""), "string:\"a // string:b\"", "a double quoted string over lines");
  assert.equal(kinds("'a\nb'"), "string:'a // string:b'", "a single quoted string over lines");
  assert.equal(kinds("\"a\\\nb\""), "string:\"a\\ // string:b\"", "a backslash at the end of a line");
  assert.equal(kinds("\"a\nb\": 1"), "string:\"a // string:b\"|plain:: |number:1", "a string over lines is not a key");
  assert.equal(kinds("\"é\\u00e9😀\""), "string:\"é\\u00e9😀\"");

  // Quotes that never close.
  assert.equal(kinds("\"abc\nx: 1"), "string:\"abc // type:x|plain:: |number:1", "only the first line is a string");
  assert.equal(kinds("'abc\nx: 1"), "string:'abc // type:x|plain:: |number:1");
  assert.equal(kinds("x: \"abc"), "type:x|plain:: |string:\"abc");
  assert.equal(kinds("\""), "string:\"");
  assert.equal(kinds("'"), "string:'");
  assert.equal(kinds("\"abc: 1"), "string:\"abc: 1", "an open string is never a key");
  {
    // A closing quote that is more than MAX_QUOTED_LINES lines away does not count.
    const far = `"x\n${"y\n".repeat(150)}"\nz: 1`;
    const lines = tokenizeYaml(far);
    assert.equal(lines[0]!.map((t) => `${t.kind}:${t.text}`).join("|"), "string:\"x");
    assert.equal(lines[1]!.map((t) => `${t.kind}:${t.text}`).join("|"), "plain:y");
    assert.equal(lines[lines.length - 1]!.map((t) => `${t.kind}:${t.text}`).join("|"), "type:z|plain:: |number:1");
    assert.equal(lines.map(joinLine).join("\n"), far);
  }

  // Block scalars.
  assert.equal(kinds("a: |\n  x # y\n  z\nb: 1"), "type:a|plain:: |string:| // string:  x # y // string:  z // type:b|plain:: |number:1");
  assert.equal(kinds("a: |-\n  x"), "type:a|plain:: |string:|- // string:  x", "|-");
  assert.equal(kinds("a: >+\n  x"), "type:a|plain:: |string:>+ // string:  x", ">+");
  assert.equal(kinds("a: |2\n  x"), "type:a|plain:: |string:|2 // string:  x", "|2");
  assert.equal(kinds("a: |2-\n  x"), "type:a|plain:: |string:|2- // string:  x", "|2-");
  assert.equal(kinds("a: >-2\n  x"), "type:a|plain:: |string:>-2 // string:  x", ">-2");
  assert.equal(kinds("a: >+ # c\n  x"), "type:a|plain:: |string:>+|plain: |comment:# c // string:  x", "a comment after the header");
  assert.equal(kinds("a: |--\n  x"), "type:a|plain:: |-- // plain:  x", "two modifiers of the same kind are not a header");
  assert.equal(kinds("a: |foo\n  x"), "type:a|plain:: |foo // plain:  x", "text after the | is not a header");
  assert.equal(kinds("a: | b\n  x"), "type:a|plain:: | b // plain:  x");
  assert.equal(kinds("- |\n  text\n- b"), "plain:- |string:| // string:  text // plain:- b", "a block scalar in a list");
  assert.equal(kinds("a: |\n  x\n\n  y\nb: 1"), "type:a|plain:: |string:| // string:  x //  // string:  y // type:b|plain:: |number:1", "a blank line inside");
  assert.equal(kinds("a:\n  b: |\n    x\n  c: 1"), "type:a|plain:: // plain:  |type:b|plain:: |string:| // string:    x // plain:  |type:c|plain:: |number:1", "stops when the indent is back to the key's");
  assert.equal(kinds("- k: |\n    x\n  j: 1"), "plain:- |type:k|plain:: |string:| // string:    x // plain:  |type:j|plain:: |number:1", "a key after a list dash owns the block");
  assert.equal(kinds("a:\n  b: |\n    x\n  # c"), "type:a|plain:: // plain:  |type:b|plain:: |string:| // string:    x // plain:  |comment:# c", "a less indented comment ends the block");
  assert.equal(kinds("a: |\nb: 1"), "type:a|plain:: |string:| // type:b|plain:: |number:1", "an empty block scalar");
  assert.equal(kinds("a: |"), "type:a|plain:: |string:|");
  assert.equal(kinds("a: |\n  x"), "type:a|plain:: |string:| // string:  x", "no line break at the end of the file");
  assert.equal(kinds("--- |\ntext\n---\nx"), "preprocessor:---|plain: |string:| // string:text // preprocessor:--- // plain:x", "a document marker ends a block");
  assert.equal(kindOf(tokenizeYaml("a: |\r\n  x # y\r\nb: 1"), "x # y"), "string", "Windows line breaks");
  assert.equal(kinds("a: |\n  x\n  ---\n  y"), "type:a|plain:: |string:| // string:  x // string:  --- // string:  y", "an indented --- is text");

  // Document markers, directives, anchors, aliases and tags.
  assert.equal(kinds("---"), "preprocessor:---");
  assert.equal(kinds("..."), "preprocessor:...");
  assert.equal(kinds("--- # c"), "preprocessor:---|plain: |comment:# c");
  assert.equal(kinds("--- a"), "preprocessor:---|plain: a");
  assert.equal(kinds("--- !!map"), "preprocessor:---|plain: |preprocessor:!!map");
  assert.equal(kinds("---x"), "plain:---x");
  assert.equal(kinds("----"), "plain:----");
  assert.equal(kinds("  ---"), "plain:  ---", "only at the start of a line");
  assert.equal(kinds("%YAML 1.2"), "preprocessor:%YAML 1.2");
  assert.equal(kinds("%TAG ! tag:x,2000:"), "preprocessor:%TAG ! tag:x,2000:");
  assert.equal(kinds("%YAML 1.2 # c"), "preprocessor:%YAML 1.2|plain: |comment:# c");
  assert.equal(kinds(" %YAML"), "plain: %YAML", "only at the start of a line");
  assert.equal(kinds("a: %x"), "type:a|plain:: %x");
  assert.equal(kinds("a: &x 1"), "type:a|plain:: |keyword:&x|plain: |number:1");
  assert.equal(kinds("&a key: v"), "keyword:&a|plain: |type:key|plain:: v");
  assert.equal(kinds("<<: *x"), "type:<<|plain:: |keyword:*x");
  assert.equal(kinds("- *x"), "plain:- |keyword:*x");
  assert.equal(kinds("*a : b"), "keyword:*a|plain: : b");
  assert.equal(kinds("&"), "plain:&", "no name");
  assert.equal(kinds("* a"), "plain:* a");
  assert.equal(kinds("!!str 12"), "preprocessor:!!str|plain: |number:12");
  assert.equal(kinds("!"), "preprocessor:!");
  assert.equal(kinds("!tag x"), "preprocessor:!tag|plain: x");
  assert.equal(kinds("!<tag:yaml.org,2002:str> x"), "preprocessor:!<tag:yaml.org,2002:str>|plain: x", "a tag in <>");
  assert.equal(kinds("a: !!int \"3\""), "type:a|plain:: |preprocessor:!!int|plain: |string:\"3\"");
  assert.equal(kinds("a: hi!"), "type:a|plain:: hi!", "a ! inside a word is text");
  assert.equal(kinds("a: x&y*z"), "type:a|plain:: x&y*z", "so are & and *");

  // Plain values.
  for (const word of ["true", "True", "TRUE", "false", "False", "FALSE", "null", "Null", "NULL", "~"]) {
    assert.equal(valueKind(word), "keyword", word);
  }
  for (const word of ["yes", "no", "on", "off", "Yes", "tRue", "nULL", "~x", "true story", "truex", "nil", "None"]) {
    assert.equal(valueKind(word), "plain", word);
  }
  for (const num of ["0", "12", "-3", "+4", "1.5", "-1.5", ".5", "-.5", "5.", "1e3", "1E3", "1.5e-3", "1e+3", "0x1F", "0xff", "0o17", ".inf", "-.inf", "+.inf", ".Inf", ".INF", ".nan", ".NaN", ".NAN"]) {
    assert.equal(valueKind(num), "number", num);
  }
  for (const text of ["1_000", "0b101", "1.2.3", "1e", "0x", "0xG", "0o8", "12ab", "1 2", "+", ".", "..", "..inf", ".infx", "0X1F", "1,5", "2024-01-01", "12:30", "1.5.", "--1", "- 1x"]) {
    assert.equal(valueKind(text), "plain", text);
  }

  // Flow collections.
  assert.equal(kinds("{a: 1}"), "plain:{|type:a|plain:: |number:1|plain:}");
  assert.equal(kinds("{a: 1, b: [x, y]}"), "plain:{|type:a|plain:: |number:1|plain:, |type:b|plain:: [x, y]}");
  assert.equal(kinds("[1, 2]"), "plain:[|number:1|plain:, |number:2|plain:]");
  assert.equal(kinds("[a, b]"), "plain:[a, b]");
  assert.equal(kinds("{a:1}"), "plain:{a:1}", "no space after the colon, so no key");
  assert.equal(kinds("{\"a\":1}"), "plain:{|type:\"a\"|plain::|number:1|plain:}", "a quoted key may touch its colon");
  assert.equal(kinds("{a: \"x, y\", b: 'z'}"), "plain:{|type:a|plain:: |string:\"x, y\"|plain:, |type:b|plain:: |string:'z'|plain:}");
  assert.equal(kinds("- {a: 1}"), "plain:- {|type:a|plain:: |number:1|plain:}");
  assert.equal(kinds("a: [1,\n  2]\nb: 3"), "type:a|plain:: [|number:1|plain:, // plain:  |number:2|plain:] // type:b|plain:: |number:3", "over two lines");
  assert.equal(kinds("a: [x # c\n  ]"), "type:a|plain:: [x |comment:# c // plain:  ]", "a comment inside []");
  assert.equal(kinds("]"), "plain:]", "a closer with nothing open");
  assert.equal(kinds("a: }"), "type:a|plain:: }");
  assert.equal(kinds("[a\n- b\n---\nc: |\n  x"), "plain:[a // plain:- b // preprocessor:--- // type:c|plain:: |string:| // string:  x", "a bracket left open ends at the next ---");

  // Odd input stays plain.
  assert.equal(kinds("\uFEFFa: 1"), "plain:\uFEFF|type:a|plain:: |number:1", "a byte order mark at the start");
  assert.equal(kinds("@#%"), "plain:@#%");
  assert.equal(kinds(""), "");
  assert.equal(kinds("a\n\nb"), "plain:a //  // plain:b");
});

test("tokenizer: YAML keeps every character, even in broken code", () => {
  for (const source of ["", "\"", "'", "\"\\", "'\\", "\"a\n", "'a''", "\\", "#", "- ", "-", "?", ":", ": ", "&", "*", "!", "!<", "!<a", "%", "---", "...", "--- |", "|", ">", "|-", "a: |\n", "a: |\n\n\n", "a: >2", "{", "}", "[", "]", ",", "[a, {b: ", "{a: [", "a: [b\n- c", "\"a\":", "\"a\" :", "😀", "a: 😀", "\"a\r\nb\"", "a: |\r\n  x\r\nb", "a: b\r\n", "\u0000", "a: \u0000", "\uFEFF", "\uFEFF---", "%YAML\n---\n...", "\t", "a:\t", "key: value # c\r\n"]) {
    const lines = tokenizeYaml(source);
    assert.equal(lines.map(joinLine).join("\n"), source, `lost text for ${JSON.stringify(source)}`);
  }
  // A big file with an unclosed quote and an unclosed bracket on every few lines is still read in one go (no slow loops).
  const big = "a: \"b\nc: 1\n- [d\n---\ne: |\n  f\n".repeat(2000);
  assert.equal(tokenizeYaml(big).map(joinLine).join("\n"), big);
});

test("languages: other languages do not read YAML rules and YAML does not read theirs", () => {
  assert.equal(kindOf(tokenizeCpp("a: b"), "a: b"), "plain", "other languages have no keys");
  assert.equal(kindOf(tokenizeJson("a: true"), "true"), "keyword");
  assert.equal(kindOf(tokenizeYaml("// hello there"), "// hello there"), "plain", "// is not a comment");
  assert.equal(kindOf(tokenizeYaml("/* hello there */"), "/* hello there */"), "plain", "/* is not a comment");
  assert.equal(kindOf(tokenizeYaml("% hello there"), "% hello there"), "preprocessor", "% at the start of a line is a directive");
  assert.equal(kindOfWord(tokenizeYaml("a: int return"), "return"), "plain", "C words are only plain words");
  assert.equal(kindOf(tokenizeYaml("{\"a\": 1}"), "\"a\""), "type", "JSON is mostly valid YAML");
  assert.ok(isSupportedSource("a.yml") && isSupportedSource("a.yaml") && isSupportedSource("A.YAML"));
  assert.ok(!isSupportedSource("a.yaml.bak") && !isSupportedSource("a.yml.tmpl") && !isSupportedSource("yarn.lock") && !isSupportedSource("a.toml"));
});

test("package.json: all five menu rules match .yml and .yaml and no look-alike extensions", () => {
  const manifest = JSON.parse(readFileSync(`${ROOT}/package.json`, "utf8")) as { contributes: { menus: Record<string, { when: string }[]> } };
  const rules = Object.values(manifest.contributes.menus).flat().map((item) => item.when).filter((when) => when.includes("resourceExtname"));
  assert.equal(rules.length, 5, "five menu rules use the extension list");
  for (const when of rules) {
    const regex = new RegExp(/resourceExtname =~ \/(.*)\/i/.exec(when)![1]!, "i");
    for (const ext of [".yml", ".yaml", ".YML", ".Yaml", ".json", ".cpp"]) {
      assert.ok(regex.test(ext), `${ext} should match in: ${when}`);
    }
    for (const ext of [".yamls", ".ymll", ".yaml.bak", ".yl", ".y", ".ya", "yaml", ".yml2", ".toml"]) {
      assert.ok(!regex.test(ext), `${ext} should not match in: ${when}`);
    }
  }
});

/** One line of tokens as kind:text pieces joined with |, so a test can check a whole line at once. */
const showLine = (line: TokenLine): string => line.map((t) => `${t.kind}:${t.text}`).join("|");

test("tokenizer: XML fixture colours", () => {
  const source = fixture("basic.xml");
  const xml = LANGUAGES[languageForFile("book.xml")!].tokenize(source);
  assert.equal(xml.map(joinLine).join("\n"), source, "no text lost or changed");
  // The fixture's lines, checked one by one (the numbers are line numbers, starting at 0).
  assert.equal(showLine(xml[0]!), "preprocessor:<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
  assert.equal(showLine(xml[1]!), "comment:<!-- A made-up recipe book for a pretend bakery. -->");
  assert.equal(showLine(xml[2]!), "preprocessor:<!DOCTYPE book [");
  assert.equal(showLine(xml[3]!), "plain:  |preprocessor:<!ELEMENT book (recipe+)>");
  assert.equal(showLine(xml[5]!), "plain:  |preprocessor:<!ENTITY oven \"180 degrees\">");
  assert.equal(showLine(xml[6]!), "preprocessor:]>", "the end of the DOCTYPE");
  assert.equal(showLine(xml[7]!), "preprocessor:<?xml-stylesheet type=\"text/xsl\" href=\"style.xsl\"?>");
  assert.equal(showLine(xml[8]!), "plain:<|keyword:book|plain: |type:xmlns|plain:=|string:\"http://bakery.example/book\"|plain: |type:xmlns:x|plain:=|string:\"http://bakery.example/extra\"|plain:>", "a namespace attribute");
  assert.equal(showLine(xml[9]!), "plain:  <|keyword:recipe|plain: |type:id|plain:=|string:\"bread-1\"|plain: |type:level|plain:=|string:'easy'|plain:>", "double and single quotes");
  assert.equal(showLine(xml[10]!), "plain:    <|keyword:title|plain:>Bread |number:&amp;|plain: butter</|keyword:title|plain:>");
  assert.equal(showLine(xml[12]!), "plain:    <|keyword:note|plain:>Use |number:&#160;|plain:a hot oven (|number:&#x20AC;|plain:5 flour), and |number:&oven;|plain: works too.</|keyword:note|plain:>");
  assert.equal(showLine(xml[13]!), "plain:    <|keyword:note|plain:>Is 3 < 5? Yes, and 5 > 3 too.</|keyword:note|plain:>", "a < and a > in text");
  assert.equal(showLine(xml[14]!), "plain:    |comment:<!-- A comment with a <tag> inside it, and a -- in it. -->");
  assert.equal(showLine(xml[15]!), "plain:    <|keyword:x:tip|plain: |type:when|plain:=|string:\"a > b\"|plain: |type:self|plain:=|string:\"/>\"|plain:>Keep it simple.</|keyword:x:tip|plain:>", "a > and a /> inside values");
  assert.equal(showLine(xml[16]!), "plain:    <|keyword:step", "a start tag over several lines");
  assert.equal(showLine(xml[17]!), "plain:      |type:order|plain:=|string:\"1\"");
  assert.equal(showLine(xml[18]!), "plain:      |type:text|plain:=|string:\"Mix", "a value over two lines");
  assert.equal(showLine(xml[19]!), "string:the dough\"");
  assert.equal(showLine(xml[20]!), "plain:    />");
  assert.equal(showLine(xml[21]!), "plain:    <|keyword:empty|plain:/>");
  assert.equal(showLine(xml[22]!), "plain:    <|keyword:script|plain:>|preprocessor:<![CDATA[");
  assert.equal(showLine(xml[23]!), "string:      if (a < b && c > d) { print(\"</recipe> is not a tag here\"); }", "CDATA is not read as tags");
  assert.equal(showLine(xml[24]!), "string:      // a comment --> and <a>link</a> stay plain text", "--> inside CDATA does nothing");
  assert.equal(showLine(xml[25]!), "string:    |preprocessor:]]>|plain:</|keyword:script|plain:>");
  assert.equal(showLine(xml[26]!), "plain:    <|keyword:crème|plain: |type:café|plain:=|string:\"é\"|plain:>naïve 日本語</|keyword:crème|plain:>", "non-ASCII names and text");
  assert.equal(showLine(xml[28]!), "plain:  <|keyword:broken|plain: |type:quote|plain:=|string:\"oops>", "a quote with no end stops at the line break");
  assert.equal(showLine(xml[29]!), "plain:  <|keyword:last|plain:>done</|keyword:last|plain:>", "and the next line is read normally");
  assert.equal(showLine(xml[30]!), "plain:</|keyword:book|plain:>");
});

test("tokenizer: XML tricky cases", () => {
  // Every token as kind:text, joined with |, and a " // " marks the start of a new line.
  const kinds = (source: string): string => tokenizeXml(source).map(showLine).join(" // ");

  // Tags and attributes.
  assert.equal(kinds("<a>"), "plain:<|keyword:a|plain:>");
  assert.equal(kinds("</a>"), "plain:</|keyword:a|plain:>");
  assert.equal(kinds("<a/>"), "plain:<|keyword:a|plain:/>");
  assert.equal(kinds("<a />"), "plain:<|keyword:a|plain: />");
  assert.equal(kinds("</a >"), "plain:</|keyword:a|plain: >");
  assert.equal(kinds("<ns:a x:b=\"1\"/>"), "plain:<|keyword:ns:a|plain: |type:x:b|plain:=|string:\"1\"|plain:/>", "namespaces");
  assert.equal(kinds("<a b = 'c' >"), "plain:<|keyword:a|plain: |type:b|plain: = |string:'c'|plain: >", "spaces around =");
  assert.equal(kinds("<a b>"), "plain:<|keyword:a|plain: |type:b|plain:>", "an attribute with no value");
  assert.equal(kinds("<a b=\"1\"c=\"2\">"), "plain:<|keyword:a|plain: |type:b|plain:=|string:\"1\"|type:c|plain:=|string:\"2\"|plain:>", "no space between attributes");
  assert.equal(kinds("<my-tag.v2 data-x=\"1\">"), "plain:<|keyword:my-tag.v2|plain: |type:data-x|plain:=|string:\"1\"|plain:>", "- . and digits in names");
  assert.equal(kinds("<_a>"), "plain:<|keyword:_a|plain:>");
  assert.equal(kinds("<:a>"), "plain:<|keyword::a|plain:>");
  assert.equal(kinds("<é>"), "plain:<|keyword:é|plain:>");
  assert.equal(kinds("<a b=c d=e/>"), "plain:<|keyword:a|plain: |type:b|plain:=|string:c|plain: |type:d|plain:=|string:e|plain:/>", "unquoted values are not valid XML but still coloured");
  assert.equal(kinds("<a b=>"), "plain:<|keyword:a|plain: |type:b|plain:=>");
  assert.equal(kinds("<a b="), "plain:<|keyword:a|plain: |type:b|plain:=");
  assert.equal(kinds("<a b=\"x > y\" c='/>'>"), "plain:<|keyword:a|plain: |type:b|plain:=|string:\"x > y\"|plain: |type:c|plain:=|string:'/>'|plain:>", "> and /> inside values");
  assert.equal(kinds("<a b=\"it's\" c='say \"hi\"'>"), "plain:<|keyword:a|plain: |type:b|plain:=|string:\"it's\"|plain: |type:c|plain:=|string:'say \"hi\"'|plain:>", "the other quote inside a value");
  assert.equal(kinds("<a b=\"&amp;\">"), "plain:<|keyword:a|plain: |type:b|plain:=|string:\"&amp;\"|plain:>", "references inside values stay part of the string");
  assert.equal(kinds("<a\n  b=\"1\"\n  c=\"2\">"), "plain:<|keyword:a // plain:  |type:b|plain:=|string:\"1\" // plain:  |type:c|plain:=|string:\"2\"|plain:>", "a start tag over several lines");
  assert.equal(kinds("<a b=\"x\ny\">"), "plain:<|keyword:a|plain: |type:b|plain:=|string:\"x // string:y\"|plain:>", "a value over two lines");
  assert.equal(kinds("<a\n\tb\n\t=\n\t\"1\"\n>"), "plain:<|keyword:a // plain:\t|type:b // plain:\t= // plain:\t|string:\"1\" // plain:>", "= and value on their own lines");

  // Text that is not a tag.
  assert.equal(kinds("a < b"), "plain:a < b");
  assert.equal(kinds("a > b"), "plain:a > b");
  assert.equal(kinds("<>"), "plain:<>");
  assert.equal(kinds("< a>"), "plain:< a>");
  assert.equal(kinds("<1>"), "plain:<1>");
  assert.equal(kinds("<-"), "plain:<-");
  assert.equal(kinds("</ a>"), "plain:</ a>");
  assert.equal(kinds("</"), "plain:</");
  assert.equal(kinds("<"), "plain:<");
  assert.equal(kinds("x < y <b>z</b>"), "plain:x < y <|keyword:b|plain:>z</|keyword:b|plain:>", "a lone < does not break what follows");
  assert.equal(kinds("a > b </c>"), "plain:a > b </|keyword:c|plain:>");
  assert.equal(kinds("]]> and --> in text"), "plain:]]> and --> in text");

  // Missing > and stray < inside a tag.
  assert.equal(kinds("<a <b>"), "plain:<|keyword:a|plain: <|keyword:b|plain:>");
  assert.equal(kinds("<a b=\"1\"\n<c/>"), "plain:<|keyword:a|plain: |type:b|plain:=|string:\"1\" // plain:<|keyword:c|plain:/>", "a tag with no > ends at the next <");
  assert.equal(kinds("<a"), "plain:<|keyword:a");
  assert.equal(kinds("<a b"), "plain:<|keyword:a|plain: |type:b");

  // Comments.
  assert.equal(kinds("<!-- a <b> -->x"), "comment:<!-- a <b> -->|plain:x", "a tag inside a comment");
  assert.equal(kinds("<!---->"), "comment:<!---->");
  assert.equal(kinds("<!-- a -- b -->"), "comment:<!-- a -- b -->");
  assert.equal(kinds("<!-- a\nb -->"), "comment:<!-- a // comment:b -->", "a comment over two lines");
  assert.equal(kinds("<!-- a\n<b>"), "comment:<!-- a // comment:<b>", "a comment with no end runs to the end of the file");
  assert.equal(kinds("<!-->"), "comment:<!-->", "<!--> is not an empty comment in XML");
  assert.equal(kinds("<!--"), "comment:<!--");
  assert.equal(kinds("<!-- x --><a/><!-- y -->"), "comment:<!-- x -->|plain:<|keyword:a|plain:/>|comment:<!-- y -->");

  // Processing instructions.
  assert.equal(kinds("<?xml version=\"1.0\"?>"), "preprocessor:<?xml version=\"1.0\"?>");
  assert.equal(kinds("<?a ?><b/>"), "preprocessor:<?a ?>|plain:<|keyword:b|plain:/>");
  assert.equal(kinds("<?a >?>"), "preprocessor:<?a >?>", "a > inside does not end it");
  assert.equal(kinds("<?a\nb?>"), "preprocessor:<?a // preprocessor:b?>", "over two lines");
  assert.equal(kinds("<?a\n<b/>"), "preprocessor:<?a // plain:<|keyword:b|plain:/>", "with no ?> it stops at the end of the line, not the end of the file");
  assert.equal(kinds("<?"), "preprocessor:<?");

  // Declarations.
  assert.equal(kinds("<!DOCTYPE html>"), "preprocessor:<!DOCTYPE html>");
  assert.equal(kinds("<!doctype html>"), "preprocessor:<!doctype html>");
  assert.equal(kinds("<!DOCTYPE a SYSTEM \"x>y.dtd\">"), "preprocessor:<!DOCTYPE a SYSTEM \"x>y.dtd\">", "a > inside quotes");
  assert.equal(kinds("<!DOCTYPE a [\n<!ELEMENT a (#PCDATA)>\n]>\n<a/>"), "preprocessor:<!DOCTYPE a [ // preprocessor:<!ELEMENT a (#PCDATA)> // preprocessor:]> // plain:<|keyword:a|plain:/>", "a DOCTYPE with declarations inside");
  assert.equal(kinds("<!DOCTYPE a [<!-- c --><?pi x?>]>"), "preprocessor:<!DOCTYPE a [|comment:<!-- c -->|preprocessor:<?pi x?>]>", "a comment and an instruction inside the DOCTYPE");
  assert.equal(kinds("<!DOCTYPE a [ ]  >"), "preprocessor:<!DOCTYPE a [|plain: |preprocessor:]|plain:  |preprocessor:>", "spaces before the final >");
  assert.equal(kinds("<!DOCTYPE a [<!ENTITY e \"a > ]\">]><b>"), "preprocessor:<!DOCTYPE a [<!ENTITY e \"a > ]\">]>|plain:<|keyword:b|plain:>", "a > and ] inside an entity value");
  assert.equal(kinds("<!ATTLIST a b (x|y) 'x'>"), "preprocessor:<!ATTLIST a b (x|y) 'x'>");
  assert.equal(kinds("<!ELEMENT a \"x>"), "preprocessor:<!ELEMENT a \"x>", "a quote with no end is just a character");
  assert.equal(kinds("<!ELEMENT a\n<b/>"), "preprocessor:<!ELEMENT a // plain:<|keyword:b|plain:/>", "a declaration with no > stops at the next <");
  assert.equal(kinds("<!"), "preprocessor:<!");
  assert.equal(kinds("]>"), "plain:]>", "] is plain outside a DOCTYPE");
  assert.equal(kinds("<!DOCTYPE a [ ]x <b/>"), "preprocessor:<!DOCTYPE a [|plain: ]x <|keyword:b|plain:/>", "a ] with no > after it is just text");

  // CDATA.
  assert.equal(kinds("<![CDATA[a < b --> <a>]]>x"), "preprocessor:<![CDATA[|string:a < b --> <a>|preprocessor:]]>|plain:x");
  assert.equal(kinds("<![CDATA[]]>"), "preprocessor:<![CDATA[]]>", "empty CDATA");
  assert.equal(kinds("<![CDATA[a\nb]]>"), "preprocessor:<![CDATA[|string:a // string:b|preprocessor:]]>", "over two lines");
  assert.equal(kinds("<![CDATA[a\n<b>"), "preprocessor:<![CDATA[|string:a // string:<b>", "CDATA with no end runs to the end of the file");
  assert.equal(kinds("<![CDATA["), "preprocessor:<![CDATA[");
  assert.equal(kinds("<![CDATA[ ]] > ]]>"), "preprocessor:<![CDATA[|string: ]] > |preprocessor:]]>");
  assert.equal(kinds("<a><![CDATA[x]]></a>"), "plain:<|keyword:a|plain:>|preprocessor:<![CDATA[|string:x|preprocessor:]]>|plain:</|keyword:a|plain:>");
  assert.equal(kinds("<![cdata[x]]>"), "preprocessor:<![cdata[x]]>", "CDATA must be in capitals");

  // References.
  assert.equal(kinds("&amp; &#160; &#x1F; &lt;"), "number:&amp;|plain: |number:&#160;|plain: |number:&#x1F;|plain: |number:&lt;");
  assert.equal(kinds("&my-ent.1;"), "number:&my-ent.1;");
  assert.equal(kinds("a&b"), "plain:a&b");
  assert.equal(kinds("&;"), "plain:&;");
  assert.equal(kinds("&#;"), "plain:&#;");
  assert.equal(kinds("&#x;"), "plain:&#x;");
  assert.equal(kinds("&amp"), "plain:&amp");
  assert.equal(kinds("&a b;"), "plain:&a b;");
  assert.equal(kinds("&&amp;&"), "plain:&|number:&amp;|plain:&");
  assert.equal(kinds("<!-- &amp; -->"), "comment:<!-- &amp; -->", "no references in a comment");
  assert.equal(kinds("<![CDATA[&amp;]]>"), "preprocessor:<![CDATA[|string:&amp;|preprocessor:]]>", "no references in CDATA");

  // Quotes that never close.
  assert.equal(kinds("<a b=\"oops>\n<c/>"), "plain:<|keyword:a|plain: |type:b|plain:=|string:\"oops> // plain:<|keyword:c|plain:/>", "only the first line is a string");
  assert.equal(kinds("<a b='oops>\n<c/>"), "plain:<|keyword:a|plain: |type:b|plain:=|string:'oops> // plain:<|keyword:c|plain:/>");
  assert.equal(kinds("<a b=\""), "plain:<|keyword:a|plain: |type:b|plain:=|string:\"");
  assert.equal(kinds("<a b='x\"y>\n<c d=\"1\"/>"), "plain:<|keyword:a|plain: |type:b|plain:=|string:'x\"y> // plain:<|keyword:c|plain: |type:d|plain:=|string:\"1\"|plain:/>", "a different kind of quote does not close it");
  {
    // A closing quote that is more than MAX_QUOTED_LINES lines away does not count.
    const far = `<a b="x\n${"y\n".repeat(150)}">\n<c/>`;
    const lines = tokenizeXml(far);
    assert.equal(showLine(lines[0]!), "plain:<|keyword:a|plain: |type:b|plain:=|string:\"x");
    assert.equal(showLine(lines[1]!), "plain:y");
    assert.equal(showLine(lines[lines.length - 1]!), "plain:<|keyword:c|plain:/>");
    assert.equal(lines.map(joinLine).join("\n"), far);
    // A closing quote that is close enough does count, even many lines down.
    const near = `<a b="x\n${"y\n".repeat(50)}">\n<c/>`;
    const nearLines = tokenizeXml(near);
    assert.equal(showLine(nearLines[25]!), "string:y");
    assert.equal(showLine(nearLines[nearLines.length - 2]!), "string:\"|plain:>");
    assert.equal(showLine(nearLines[nearLines.length - 1]!), "plain:<|keyword:c|plain:/>");
  }

  // Windows line breaks (the exporter converts them first, but a stray \r is only plain text).
  assert.equal(kindOf(tokenizeXml("<a>\r\n<!-- c\r\nd -->\r\n</a>"), "d -->"), "comment");
  assert.equal(kindOf(tokenizeXml("<a b=\"x\r\ny\">"), "y\""), "string", "a value over two lines");
  assert.equal(kinds("<a b=\"oops\r\n<c/>"), "plain:<|keyword:a|plain: |type:b|plain:=|string:\"oops|plain:\r // plain:<|keyword:c|plain:/>", "an unclosed quote stops before the \\r");
  assert.equal(kinds("<?a\r\n<b/>"), "preprocessor:<?a|plain:\r // plain:<|keyword:b|plain:/>");
  assert.equal(kinds("<a\r\n  b=\"1\">"), "plain:<|keyword:a|plain:\r // plain:  |type:b|plain:=|string:\"1\"|plain:>");
  {
    const crlf = fixture("basic.xml").replace(/\n/g, "\r\n");
    const lines = tokenizeXml(crlf);
    assert.equal(lines.map(joinLine).join("\n"), crlf, "Windows line breaks are kept");
    assert.equal(lines.length, fixture("basic.xml").split("\n").length, "the same number of lines");
  }

  // Other bits of text are plain.
  assert.equal(kinds("hello world 123"), "plain:hello world 123");
  assert.equal(kinds("<a>true null 12</a>"), "plain:<|keyword:a|plain:>true null 12</|keyword:a|plain:>");
  assert.equal(kinds("<a>\"not a string\" 'nor this'</a>"), "plain:<|keyword:a|plain:>\"not a string\" 'nor this'</|keyword:a|plain:>", "quotes in text");
  assert.equal(kinds("😀<a b=\"😀\">😀</a>"), "plain:😀<|keyword:a|plain: |type:b|plain:=|string:\"😀\"|plain:>😀</|keyword:a|plain:>");
});

test("tokenizer: XML keeps every character, even in broken code", () => {
  for (const source of ["", "<", ">", "</", "<>", "<a", "<a ", "<a b", "<a b=", "<a b=\"", "<a b='", "<a b=\"c", "<a/", "<a /", "</a", "<!", "<!-", "<!--", "<!---", "<!-->", "<?", "<?x", "<?x?", "<![", "<![CDATA", "<![CDATA[", "<![CDATA[]", "<![CDATA[]]", "<!DOCTYPE", "<!DOCTYPE a [", "<!DOCTYPE a [ ]", "<!DOCTYPE a [ ] ", "<!DOCTYPE a \"", "&", "&#", "&#x", "&a", "]", "]>", "]]>", "😀", "<a b=\"😀", "<😀>", "<a\r", "<a\r\n", "<a b=\"x\r\ny", "<!--\r\n", "<?a\r\n", "<a =\"1\">", "<a ==\"1\">", "<a b=\"1\"\"2\">", "<a '>", "<a \">", "<a b='1\" c=\"2'>", "<a/ b>", "<a / >", "\0<a\0>\0"]) {
    const lines = tokenizeXml(source);
    assert.equal(lines.map(joinLine).join("\n"), source, `lost text for ${JSON.stringify(source)}`);
  }
  // A big file with an unclosed quote, comment-like text and a broken tag on every few lines is still read in one go (no slow loops).
  const big = "<a b=\"c\n<d e='f>\n<!ELEMENT g \"h\n<![x\n<i\n<?j\n".repeat(2000);
  assert.equal(tokenizeXml(big).map(joinLine).join("\n"), big);
  const manyQuotes = "<a b=\"".repeat(5000);
  assert.equal(tokenizeXml(manyQuotes).map(joinLine).join("\n"), manyQuotes);
});

test("languages: other languages do not read XML rules and XML does not read theirs", () => {
  assert.equal(kindOf(tokenizeXml("// hello there"), "// hello there"), "plain", "// is not a comment");
  assert.equal(kindOf(tokenizeXml("/* hello there */"), "/* hello there */"), "plain", "/* is not a comment");
  assert.equal(kindOf(tokenizeXml("# hello there"), "# hello there"), "plain", "# is not a comment");
  assert.equal(kindOf(tokenizeXml("\"a\" 'b'"), "\"a\""), "plain", "quotes outside a tag are text");
  assert.equal(kindOfWord(tokenizeXml("int return true"), "return"), "plain", "C words are only plain words");
  assert.equal(kindOf(tokenizeXml("<script>if (a < b) {}</script>"), "if (a < b) {}"), "plain", "no JavaScript colours inside <script>");
  assert.equal(kindOf(tokenizeXml("<style>a { color: red; }</style>"), "a { color: red; }"), "plain", "no CSS colours inside <style>");
  assert.equal(kindOf(tokenizeHtml("<a b=\"1\">"), "\"1\""), "string", "HTML still colours the same way");
  assert.equal(kindOf(tokenizeCpp("<a b=\"1\">"), "\"1\""), "string");
  assert.ok(isSupportedSource("a.xml") && isSupportedSource("a.xsd") && isSupportedSource("a.xsl") && isSupportedSource("a.xslt") && isSupportedSource("A.XML"));
  assert.ok(!isSupportedSource("a.xml.bak") && !isSupportedSource("a.svg") && !isSupportedSource("a.xhtml") && !isSupportedSource("a.plist") && !isSupportedSource("a.xsdx"));
  assert.ok(!isGeneratedFile("pom.xml") && !isGeneratedFile("web.config") && !isGeneratedFile("schema.xsd"), "no XML file is skipped as generated");
});

test("package.json: all five menu rules match .xml, .xsd, .xsl and .xslt and no look-alike extensions", () => {
  const manifest = JSON.parse(readFileSync(`${ROOT}/package.json`, "utf8")) as { contributes: { menus: Record<string, { when: string }[]> } };
  const rules = Object.values(manifest.contributes.menus).flat().map((item) => item.when).filter((when) => when.includes("resourceExtname"));
  assert.equal(rules.length, 5, "five menu rules use the extension list");
  for (const when of rules) {
    const regex = new RegExp(/resourceExtname =~ \/(.*)\/i/.exec(when)![1]!, "i");
    for (const ext of [".xml", ".xsd", ".xsl", ".xslt", ".XML", ".Xsd", ".XSLT", ".yaml", ".cpp", ".html"]) {
      assert.ok(regex.test(ext), `${ext} should match in: ${when}`);
    }
    for (const ext of [".xmls", ".xmll", ".xsdl", ".xslx", ".xsltt", ".xs", ".svg", ".xhtml", ".plist", ".xml.bak", ".xml2", "xml", ".xslt2"]) {
      assert.ok(!regex.test(ext), `${ext} should not match in: ${when}`);
    }
  }
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
  for (const name of ["a.c", "a.cpp", "a.cc", "a.cxx", "a.h", "a.hpp", "a.hh", "a.hxx", "A.CPP", "A.C", "a.py", "a.pyw", "A.PY", "a.css", "A.CSS", "a.html", "a.htm", "A.HTML", "a.js", "a.mjs", "a.cjs", "A.JS", "a.ts", "a.mts", "a.cts", "A.TS", "a.jsx", "a.tsx", "A.TSX", "a.rs", "A.RS", "a.java", "A.JAVA", "a.cs", "A.CS", "a.go", "A.GO", "a.php", "A.PHP", "a.rb", "A.RB", "a.dart", "A.DART", "a.lua", "A.LUA", "a.r", "a.R", "A.R", "a.m", "A.M", "a.ino", "A.INO", "a.v", "A.V", "a.vh", "a.sv", "A.SV", "a.svh"]) {
    assert.ok(isSupportedSource(name), name);
  }
  for (const name of ["a.ts.map", "a.tsbuildinfo", "a.js.map", "js", "cpp", "c", "py", "css", "a.scss", "a.css.map", "html", "a.html.bak", "a.xhtml", "a.cpp.bak", "a.c.bak", "a.pyc", "a.rs.bk", "rs", "a.class", "a.jar", "java", "a.csproj", "a.sln", "a.dll", "cs", "a.mod", "a.sum", "go", "a.phtml", "a.php.bak", "a.inc", "php", "a.erb", "a.rbi", "rb", "a.dart.bak", "dart", "a.lua.bak", "a.luac", "lua", "a.r.bak", "a.rmd", "a.Rproj", "a.rds", "r", "a.m.bak", "a.mat", "a.mlx", "a.mm", "m", "a.ino.bak", "a.pde", "ino", "a.v.bak", "a.vhd.bak", "a.vho", "a.vcd", "a.vo", "a.sv.bak", "v", "sv","pubspec.yaml.bak", "notes.txt"]) {
    assert.ok(!isSupportedSource(name), name);
  }
  for (const name of [".git", ".vscode", "node_modules", "build", "dist", "cmake-build-debug", "Debug", "__pycache__", "venv", ".venv", "target", "out", "bin", ".gradle", "obj", "vendor", "Pods", "DerivedData", "Carthage", ".build", ".bundle", "vendor", ".dart_tool", "lua_modules", "renv", "packrat", "Renv", "slprj", "codegen", "Codegen", "obj_dir", "Obj_Dir", "xsim.dir", "incremental_db"]) {
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

test("files: folder scan skips generated lock files by exact name but keeps other json files", async () => {
  const tree: Record<string, DirEntry[]> = {
    "": [
      { name: "package.json", isFile: true, isDirectory: false },
      { name: "package-lock.json", isFile: true, isDirectory: false },
      { name: "npm-shrinkwrap.json", isFile: true, isDirectory: false },
      { name: "Package-Lock.json", isFile: true, isDirectory: false },
      { name: "package-lock.jsonc", isFile: true, isDirectory: false },
      { name: "my-package-lock.json", isFile: true, isDirectory: false },
      { name: "composer.lock", isFile: true, isDirectory: false },
      { name: "app", isFile: false, isDirectory: true },
    ],
    app: [
      { name: "package-lock.json", isFile: true, isDirectory: false },
      { name: "config.jsonc", isFile: true, isDirectory: false },
    ],
  };
  const scan = await scanFolder<string>("", async (path) => tree[path] ?? [], (path, name) => (path ? `${path}/${name}` : name));
  assert.deepEqual(scan.files.map((f) => f.relativePath).sort(), ["Package-Lock.json", "app/config.jsonc", "my-package-lock.json", "package-lock.jsonc", "package.json"]);
  assert.deepEqual(scan.skippedGeneratedFiles.sort(), ["app/package-lock.json", "npm-shrinkwrap.json", "package-lock.json"]);
  assert.deepEqual(scan.skippedHiddenFiles, []);
  assert.ok(isSupportedSource("package-lock.json"), "a lock file still exports when picked on its own");
  assert.ok(isGeneratedFile("package-lock.json") && !isGeneratedFile("package.json") && !isGeneratedFile("Package-Lock.json"));
});

test("files: folder scan skips pnpm-lock.yaml by exact name but keeps other yaml files", async () => {
  const tree: Record<string, DirEntry[]> = {
    "": [
      { name: "pnpm-lock.yaml", isFile: true, isDirectory: false },
      { name: "pnpm-lock.yml", isFile: true, isDirectory: false },
      { name: "my-pnpm-lock.yaml", isFile: true, isDirectory: false },
      { name: "PNPM-LOCK.yaml", isFile: true, isDirectory: false },
      { name: "pnpm-workspace.yaml", isFile: true, isDirectory: false },
      { name: "yarn.lock", isFile: true, isDirectory: false },
      { name: "ci.yml", isFile: true, isDirectory: false },
      { name: "app", isFile: false, isDirectory: true },
    ],
    app: [
      { name: "pnpm-lock.yaml", isFile: true, isDirectory: false },
      { name: "config.yaml", isFile: true, isDirectory: false },
    ],
  };
  const scan = await scanFolder<string>("", async (path) => tree[path] ?? [], (path, name) => (path ? `${path}/${name}` : name));
  assert.deepEqual(scan.files.map((f) => f.relativePath).sort(), ["PNPM-LOCK.yaml", "app/config.yaml", "ci.yml", "my-pnpm-lock.yaml", "pnpm-lock.yml", "pnpm-workspace.yaml"]);
  assert.deepEqual(scan.skippedGeneratedFiles.sort(), ["app/pnpm-lock.yaml", "pnpm-lock.yaml"]);
  assert.ok(isSupportedSource("pnpm-lock.yaml"), "a lock file still exports when picked on its own");
  assert.ok(isGeneratedFile("pnpm-lock.yaml") && !isGeneratedFile("pnpm-workspace.yaml") && !isGeneratedFile("PNPM-LOCK.yaml"));
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
