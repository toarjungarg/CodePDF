// Unit tests for the pieces under the PDF exporter: tokenizer, layout,
// options, file rules and font lookup. Run with `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenizeCFamily } from "../src/export/cFamilyTokenizer";
import { tokenizePython } from "../src/export/pythonTokenizer";
import { tokenizeCss } from "../src/export/cssTokenizer";
import { tokenizeHtml } from "../src/export/htmlTokenizer";
import { tokenizeJavaScript } from "../src/export/javascriptTokenizer";
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
/** Kind of the first token containing `word` as a whole word (plain neighbours get merged into one token). */
const kindOfWord = (lines: TokenLine[], word: string): TokenKind | undefined => {
  const pattern = new RegExp(`(^|[^\\w$])${word.replace(/[$]/g, "\\$")}($|[^\\w$])`);
  return lines.flat().find((token) => pattern.test(token.text))?.kind;
};

test("tokenizer: joining tokens gives back every fixture exactly", () => {
  for (const name of ["basic.cpp", "comments_strings.cpp", "unicode.cpp", "long_lines.cpp", "basic.c", "basic.py", "basic.css", "basic.html", "basic.js"]) {
    const source = fixture(name).replace(/\r\n?/g, "\n");
    for (const lines of [tokenizeCpp(source), tokenizeC(source), tokenizePython(source), tokenizeCss(source), tokenizeHtml(source), tokenizeJavaScript(source)]) {
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
  assert.equal(languageForFile("App.jsx"), undefined);
  assert.equal(languageForVscodeId("javascript"), "javascript");
  assert.equal(languageForVscodeId("typescript"), undefined);
  assert.equal(LANGUAGE_NAMES, "C, C++, Python, CSS, HTML and JavaScript");
  assert.equal(LANGUAGE_NAMES_OR, "C, C++, Python, CSS, HTML or JavaScript");
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
  for (const name of ["a.c", "a.cpp", "a.cc", "a.cxx", "a.h", "a.hpp", "a.hh", "a.hxx", "A.CPP", "A.C", "a.py", "a.pyw", "A.PY", "a.css", "A.CSS", "a.html", "a.htm", "A.HTML", "a.js", "a.mjs", "a.cjs", "A.JS"]) {
    assert.ok(isSupportedSource(name), name);
  }
  for (const name of ["a.jsx", "a.ts", "a.js.map", "js", "cpp", "c", "py", "css", "a.scss", "a.css.map", "html", "a.html.bak", "a.xhtml", "a.cpp.bak", "a.c.bak", "a.pyc", "notes.txt"]) {
    assert.ok(!isSupportedSource(name), name);
  }
  for (const name of [".git", ".vscode", "node_modules", "build", "dist", "cmake-build-debug", "Debug", "__pycache__", "venv", ".venv"]) {
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
