// End-to-end tests for the PDF exporter: each test makes a real PDF, saves it
// to workspace/test-output/ for a look by eye, and reads it back with pdf.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOptions, type ExportOptions } from "../src/export/options";
import { resolveFonts } from "../src/export/fonts";
import { ExportCancelledError, renderPdf, type SourceSection } from "../src/export/renderer";
import { columnOf, fixture, readPdf, saveOutput } from "./helpers";

const EDITOR_FONT = "Menlo, Monaco, 'Courier New', monospace";
const fonts = resolveFonts(EDITOR_FONT);
const fixedDate = new Date(2026, 10, 12);

async function exportSections(
  name: string,
  sections: SourceSection[],
  overrides: Partial<ExportOptions> = {},
): Promise<{ bytes: Uint8Array; pdf: Awaited<ReturnType<typeof readPdf>> }> {
  const options = normalizeOptions({ ...overrides });
  const bytes = await renderPdf(sections, options, fonts, { documentTitle: name, date: fixedDate });
  saveOutput(name, bytes);
  return { bytes, pdf: await readPdf(bytes) };
}

const file = (title: string, text: string, firstLineNumber = 1): SourceSection => ({ title, text, firstLineNumber });

test("1. exports a basic C++ file", async () => {
  const { bytes, pdf } = await exportSections("basic.pdf", [file("basic.cpp", fixture("basic.cpp"))]);
  assert.ok(bytes.length > 1000);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  assert.equal(pdf.numPages, 1);
  assert.equal(Math.round(pdf.pages[0]!.width), 612, "Letter width");
  assert.equal(Math.round(pdf.pages[0]!.height), 792, "Letter height");
  assert.ok(pdf.text.includes("int sumOf(const std::vector<int>& values) {"));
  assert.equal(columnOf(pdf.pages[0]!, "+="), 14, "indentation kept: '        total += value;' puts += at column 14");
  assert.ok(pdf.pages[0]!.lines[0]!.startsWith("basic.cpp"), "file name in the header");
  assert.ok(pdf.text.includes("Page 1 of 1"));
  assert.ok(pdf.text.includes("2026-11-12"), "date in the footer");
  assert.ok(pdf.pages[0]!.lines.some((l) => /^\s*1\s*#include <iostream>/.test(l)), "line numbers");
  assert.equal(pdf.title, "basic.pdf");
});

test("1b. exports a C file, and C and C++ files combined", async () => {
  const source = fixture("basic.c");
  const { pdf } = await exportSections("basic_c.pdf", [file("basic.c", source)]);
  assert.ok(pdf.pages[0]!.lines[0]!.startsWith("basic.c"), "file name in the header");
  for (const expected of [
    "#define ABS(x) _Generic((x), int: abs, double: fabs)(x)",
    "static _Bool is_cold(double celsius) {",
    "void copy(double *restrict out, const double *restrict in, size_t n) {",
    'const char *class = "Weather station"; /* a name in C */',
  ]) {
    assert.ok(pdf.text.includes(expected), `missing: ${expected}`);
  }

  const combined = await exportSections("mixed_c_cpp.pdf", [
    { ...file("basic.c", source), language: "c" },
    { ...file("basic.cpp", fixture("basic.cpp")), language: "cpp" },
  ]);
  assert.deepEqual(combined.pdf.outline, ["basic.c", "basic.cpp"], "one bookmark per file");
  assert.ok(combined.pdf.text.includes("node_t *push(node_t *head, double value) {"));
  assert.ok(combined.pdf.text.includes("int sumOf(const std::vector<int>& values) {"));
});

test("1c. exports a Python file, and Python and C++ files combined", async () => {
  const source = fixture("basic.py");
  const { pdf } = await exportSections("basic_py.pdf", [file("basic.py", source)]);
  assert.ok(pdf.pages[0]!.lines[0]!.startsWith("basic.py"), "file name in the header");
  for (const expected of [
    "This docstring spans several lines and has a # that is not a comment.",
    'PATTERN = re.compile(r"^(\\w+):\\s*(-?\\d+\\.\\d+)$") # raw string, then a comment', // the PDF reader squeezes the two spaces into one
    "@dataclass",
    'case "Waterloo" | \'Toronto\':',
    'label = f"{reading.city!r} ({where}): {reading.celsius:.1f} C"',
    "print(f\"mean is {lookup['mean']:>8.2f} over {len(readings)} reading(s)\")",
  ]) {
    assert.ok(pdf.text.includes(expected), `missing: ${expected}`);
  }

  const combined = await exportSections("mixed_py_cpp.pdf", [
    { ...file("basic.py", source), language: "python" },
    { ...file("basic.cpp", fixture("basic.cpp")), language: "cpp" },
  ]);
  assert.deepEqual(combined.pdf.outline, ["basic.py", "basic.cpp"], "one bookmark per file");
  assert.ok(combined.pdf.text.includes("def describe(reading: Reading) -> str:"));
  assert.ok(combined.pdf.text.includes("int sumOf(const std::vector<int>& values) {"));
});

test("1d. exports a CSS file, and CSS and C++ files combined", async () => {
  const source = fixture("basic.css");
  const { pdf } = await exportSections("basic_css.pdf", [file("basic.css", source)]);
  assert.ok(pdf.pages[0]!.lines[0]!.startsWith("basic.css"), "file name in the header");
  for (const expected of [
    "This comment has a { brace and a ; that are not code. */",
    "@import url(fonts/serif.css);",
    "background: #fafafa url(data:image/png;base64,iVBORw0KGgo=) no-repeat;",
    "#featured .title::before {",
    "color: var(--accent) !important;",
    "@media screen and (max-width: 600px) {",
  ]) {
    assert.ok(pdf.text.includes(expected), `missing: ${expected}`);
  }

  const combined = await exportSections("mixed_css_cpp.pdf", [
    { ...file("basic.css", source), language: "css" },
    { ...file("basic.cpp", fixture("basic.cpp")), language: "cpp" },
  ]);
  assert.deepEqual(combined.pdf.outline, ["basic.css", "basic.cpp"], "one bookmark per file");
  assert.ok(combined.pdf.text.includes("a[href^=\"https\"]:hover {"));
  assert.ok(combined.pdf.text.includes("int sumOf(const std::vector<int>& values) {"));
});

test("1e. exports an HTML file, and HTML and CSS files combined", async () => {
  const source = fixture("basic.html");
  const { pdf } = await exportSections("basic_html.pdf", [file("basic.html", source)]);
  assert.ok(pdf.pages[0]!.lines[0]!.startsWith("basic.html"), "file name in the header");
  for (const expected of [
    "<!DOCTYPE html>",
    "This comment has a <div> tag and an & that are not code. -->",
    "<title>Pancakes &amp; Syrup</title>",
    "<body class=page data-theme='light'>",
    '<h1 style="font-weight: bold; margin: 0 4px">Pancakes</h1>',
    "<p>Serves 4. Salt & pepper not needed. &copy; &#169; &#x1F95E;</p>",
    "if (count < 3 && total > 0) {",
  ]) {
    assert.ok(pdf.text.includes(expected), `missing: ${expected}`);
  }

  const combined = await exportSections("mixed_html_css.pdf", [
    { ...file("basic.html", source), language: "html" },
    { ...file("basic.css", fixture("basic.css")), language: "css" },
  ]);
  assert.deepEqual(combined.pdf.outline, ["basic.html", "basic.css"], "one bookmark per file");
  assert.ok(combined.pdf.text.includes('<recipe-card id="featured" hidden>'));
  assert.ok(combined.pdf.text.includes("a[href^=\"https\"]:hover {"));
});

test("1f. exports a JavaScript file, and HTML and JavaScript files combined", async () => {
  const source = fixture("basic.js");
  const { pdf } = await exportSections("basic_js.pdf", [file("basic.js", source)]);
  assert.ok(pdf.pages[0]!.lines[0]!.startsWith("basic.js"), "file name in the header");
  for (const expected of [
    "#!/usr/bin/env node",
    'import { readFile } from "node:fs/promises";',
    "const ratio = amount / SERVINGS / 2;",
    "const pattern = /\\d+ cups?[/a-z]*/gi;",
    "const amounts = `${card.scale(flour, 2).toFixed(1)} cups`;",
    "const label = `Serves ${SERVINGS} with ${amounts} and ${`${eggs} eggs`}`;",
    "on a new line`;",
  ]) {
    assert.ok(pdf.text.includes(expected), `missing: ${expected}`);
  }

  const combined = await exportSections("mixed_html_js.pdf", [
    { ...file("basic.html", fixture("basic.html")), language: "html" },
    { ...file("basic.js", source), language: "javascript" },
  ]);
  assert.deepEqual(combined.pdf.outline, ["basic.html", "basic.js"], "one bookmark per file");
  assert.ok(combined.pdf.text.includes("if (count < 3 && total > 0) {"));
  assert.ok(combined.pdf.text.includes("export default card;"));
});

test("1g. exports TypeScript, JSX and TSX files, alone and combined", async () => {
  const cases: Array<[string, string[]]> = [
    ["basic.ts", ["export interface Ingredient {", "type Pair<T> = [T, T];", "const half = settings.meal! / 2;"]],
    ["basic.jsx", ['<article className="card" data-open={open} {...rest}>', "Don't skip step {i + 1}: {step}", "<>"]],
    ["basic.tsx", ["const identity = <T,>(value: T): T => value;", '<Menu.Group label="Recipes">', "More &gt;"]],
  ];
  for (const [name, expectedLines] of cases) {
    const { pdf } = await exportSections(`${name.replace(".", "_")}.pdf`, [file(name, fixture(name))]);
    assert.ok(pdf.pages[0]!.lines[0]!.startsWith(name), `${name}: file name in the header`);
    for (const expected of expectedLines) {
      assert.ok(pdf.text.includes(expected), `${name} missing: ${expected}`);
    }
  }

  const combined = await exportSections("mixed_ts_react.pdf", [
    { ...file("basic.ts", fixture("basic.ts")), language: "typescript" },
    { ...file("basic.jsx", fixture("basic.jsx")), language: "javascriptreact" },
    { ...file("basic.tsx", fixture("basic.tsx")), language: "typescriptreact" },
  ]);
  assert.deepEqual(combined.pdf.outline, ["basic.ts", "basic.jsx", "basic.tsx"], "one bookmark per file");
  assert.ok(combined.pdf.text.includes("export { load, isIngredient, pair, half, first, VERSION };"));
});

test("1h. exports a Rust file, alone and combined with C++", async () => {
  const source = fixture("basic.rs");
  const { pdf } = await exportSections("basic_rs.pdf", [file("basic.rs", source)]);
  assert.ok(pdf.pages[0]!.lines[0]!.startsWith("basic.rs"), "file name in the header");
  for (const expected of [
    "pub struct Ingredient<'a> {",
    "let quote = '\\'';",
    'let raw = r#"He said "two cups" and left"#;',
    "/* Block comment /* with a nested one */",
    "'outer: for i in 1..10 {",
  ]) {
    assert.ok(pdf.text.includes(expected), `missing: ${expected}`);
  }

  const combined = await exportSections("mixed_rs_cpp.pdf", [
    { ...file("basic.rs", source), language: "rust" },
    { ...file("basic.cpp", fixture("basic.cpp")), language: "cpp" },
  ]);
  assert.deepEqual(combined.pdf.outline, ["basic.rs", "basic.cpp"], "one bookmark per file");
  assert.ok(combined.pdf.text.includes('println!("{VERSION} {MAX_ITEMS} {MASK} {half}");'));
});

test("1i. exports a Java file, alone and combined with Rust", async () => {
  const source = fixture("basic.java");
  const { pdf } = await exportSections("basic_java.pdf", [file("basic.java", source)]);
  assert.ok(pdf.pages[0]!.lines[0]!.startsWith("basic.java"), "file name in the header");
  for (const expected of [
    "public non-sealed class Cake implements Dish {",
    "char quote = '\\'';",
    'String path = "C:\\\\recipes\\\\pancakes";',
    'Mix "two cups" of flour.',
    'case Soup s when s.cups() > 4 -> "a big soup";',
  ]) {
    assert.ok(pdf.text.includes(expected), `missing: ${expected}`);
  }

  const combined = await exportSections("mixed_java_rs.pdf", [
    { ...file("basic.java", source), language: "java" },
    { ...file("basic.rs", fixture("basic.rs")), language: "rust" },
  ]);
  assert.deepEqual(combined.pdf.outline, ["basic.java", "basic.rs"], "one bookmark per file");
  assert.ok(combined.pdf.text.includes("pantry.forEach(System.out::println);"));
});

test("1j. exports a C# file, alone and combined with Java", async () => {
  const source = fixture("basic.cs");
  const { pdf } = await exportSections("basic_cs.pdf", [file("basic.cs", source)]);
  assert.ok(pdf.pages[0]!.lines[0]!.startsWith("basic.cs"), "file name in the header");
  for (const expected of [
    "public partial class Cookbook : IDish",
    "char quote = '\\'';",
    'string path = @"C:\\recipes\\pancakes";',
    'string said = @"She said ""hi""";',
    '{ "dish": "soup" }',
    'string line = $"{name,-10}: {cups:F1} cups, {{not a hole}}";',
  ]) {
    assert.ok(pdf.text.includes(expected), `missing: ${expected}`);
  }

  const combined = await exportSections("mixed_cs_java.pdf", [
    { ...file("basic.cs", source), language: "csharp" },
    { ...file("basic.java", fixture("basic.java")), language: "java" },
  ]);
  assert.deepEqual(combined.pdf.outline, ["basic.cs", "basic.java"], "one bookmark per file");
  assert.ok(combined.pdf.text.includes("pantry.forEach(System.out::println);"));
});

test("1k. exports a Go file, alone and combined with C#", async () => {
  const source = fixture("basic.go");
  const { pdf } = await exportSections("basic_go.pdf", [file("basic.go", source)]);
  assert.ok(pdf.pages[0]!.lines[0]!.startsWith("basic.go"), "file name in the header");
  for (const expected of [
    "type Shelf struct {",
    "quote := '\\''",
    "raw := `C:\\recipes\\pancakes`",
    'that spans three lines, with a "quote" and // not a comment',
    "and a backslash \\n that is not an escape",
    "mask := 0xF0 &^ 0x30",
    "v, ok := <-ch",
  ]) {
    assert.ok(pdf.text.includes(expected), `missing: ${expected}`);
  }

  const combined = await exportSections("mixed_go_cs.pdf", [
    { ...file("basic.go", source), language: "go" },
    { ...file("basic.cs", fixture("basic.cs")), language: "csharp" },
  ]);
  assert.deepEqual(combined.pdf.outline, ["basic.go", "basic.cs"], "one bookmark per file");
  assert.ok(combined.pdf.text.includes("public partial class Cookbook : IDish"));
});

test("1l. exports a PHP file, alone and combined with Go", async () => {
  const source = fixture("basic.php");
  const { pdf } = await exportSections("basic_php.pdf", [file("basic.php", source)]);
  assert.ok(pdf.pages[0]!.lines[0]!.startsWith("basic.php"), "file name in the header");
  for (const expected of [
    "<h1 class=\"title\">Pantry page: if else function \"quotes\" here</h1>",
    "#[Attribute(Attribute::TARGET_CLASS)]",
    "public function add(Item $item, int ...$more): static",
    "$$name = 'indirect';",
    "$greeting = \"Hello $name, you have {$count} items and",
    "She said \"hi\" and // this is not a comment.",
    "Nowdoc keeps $name and {$count} exactly.",
    "<p>$name</p>",
    "<?= $name ?>",
    "# This file has no closing tag at the end.",
  ]) {
    assert.ok(pdf.text.includes(expected), `missing: ${expected}`);
  }

  const combined = await exportSections("mixed_php_go.pdf", [
    { ...file("basic.php", source), language: "php" },
    { ...file("basic.go", fixture("basic.go")), language: "go" },
  ]);
  assert.deepEqual(combined.pdf.outline, ["basic.php", "basic.go"], "one bookmark per file");
  assert.ok(combined.pdf.text.includes("type Shelf struct {"));
});

test("1m. exports a SQL file, alone and combined with PHP", async () => {
  const source = fixture("basic.sql");
  const { pdf } = await exportSections("basic_sql.pdf", [file("basic.sql", source)]);
  assert.ok(pdf.pages[0]!.lines[0]!.startsWith("basic.sql"), "file name in the header");
  for (const expected of [
    "-- Made-up schema for a small bookshop. Nothing here is real data.",
    "TEXT DEFAULT 'none',",
    "values ('Mira O''Hare', '1971-03-02', 'M.O.'),",
    "('Sam -- not a comment', '1980-11-30', NULL);",
    "a.full_name AS \"Author -- Name\",",
    "b.price::numeric * 1.13 AS with_tax,",
    "CREATE FUNCTION shelf_count(shelf_id INT) RETURNS INT AS $$",
    "$$ LANGUAGE plpgsql;",
    "SELECT E'tab\\there', N'unicode', X'1F';",
    "/* This block comment is never closed, so it runs to the end of the file.",
  ]) {
    assert.ok(pdf.text.includes(expected), `missing: ${expected}`);
  }

  const combined = await exportSections("mixed_sql_php.pdf", [
    { ...file("basic.sql", source), language: "sql" },
    { ...file("basic.php", fixture("basic.php")), language: "php" },
  ]);
  assert.deepEqual(combined.pdf.outline, ["basic.sql", "basic.php"], "one bookmark per file");
  assert.ok(combined.pdf.text.includes("public function add(Item $item, int ...$more): static"));
});

test("1n. exports a Shell file, alone and combined with SQL", async () => {
  const source = fixture("basic.sh");
  const { pdf } = await exportSections("basic_sh.pdf", [file("basic.sh", source)]);
  assert.ok(pdf.pages[0]!.lines[0]!.startsWith("basic.sh"), "file name in the header");
  for (const expected of [
    "#!/bin/bash",
    "# the folder to back up",
    "echo \"args: $# last: ${#NOTES_DIR} id: $$ status: $?\"",
    "echo \\# not a comment, \\\"not a string\\\"",
    "echo 'ends with a backslash\\'",
    "stamp=\"$(echo \"run on $(date +%F)\")\"",
    "for ((i = 0; i < KEEP; i++)); do",
    "-h|--help)",
    "cat <<-'END' > summary.txt",
    "Quoted tag: $NOTES_DIR stays as it is.",
    "wc -w <<< \"$greeting\"",
    "echo \"still inside\"",
  ]) {
    assert.ok(pdf.text.includes(expected), `missing: ${expected}`);
  }

  const combined = await exportSections("mixed_sh_sql.pdf", [
    { ...file("basic.sh", source), language: "shell" },
    { ...file("basic.sql", fixture("basic.sql")), language: "sql" },
  ]);
  assert.deepEqual(combined.pdf.outline, ["basic.sh", "basic.sql"], "one bookmark per file");
  assert.ok(combined.pdf.text.includes("CREATE FUNCTION shelf_count(shelf_id INT) RETURNS INT AS $$"));
});

test("1o. exports a Kotlin file, alone and combined with Shell", async () => {
  const source = fixture("basic.kt");
  const { pdf } = await exportSections("basic_kt.pdf", [file("basic.kt", source)]);
  assert.ok(pdf.pages[0]!.lines[0]!.startsWith("basic.kt"), "file name in the header");
  for (const expected of [
    "@file:JvmName(\"Shelf\")",
    "/* A block comment /* with a nested one */ that is still a comment */",
    "data class Soup(override val name: String, val cups: Int = 2) : Dish",
    "\"Pantry $label has ${dishes.size} dishes",
    "{ \"<$it>\" }} done\"",
    "Line two with ${value * 2}",
    "val edge = \"\"\"ends with a quote\"\"\"\"",
    "if (it < 0) return@forEach",
    "outer@ for (i in 0..<3) {",
    "fun `my test with spaces`() = 1",
  ]) {
    assert.ok(pdf.text.includes(expected), `missing: ${expected}`);
  }

  const combined = await exportSections("mixed_kt_sh.pdf", [
    { ...file("basic.kt", source), language: "kotlin" },
    { ...file("basic.sh", fixture("basic.sh")), language: "shell" },
  ]);
  assert.deepEqual(combined.pdf.outline, ["basic.kt", "basic.sh"], "one bookmark per file");
  assert.ok(combined.pdf.text.includes("#!/bin/bash"));
});

test("1p. exports a Swift file, alone and combined with Kotlin", async () => {
  const source = fixture("basic.swift");
  const { pdf } = await exportSections("basic_swift.pdf", [file("basic.swift", source)]);
  assert.ok(pdf.pages[0]!.lines[0]!.startsWith("basic.swift"), "file name in the header");
  for (const expected of [
    "/* A block comment /* with a nested one */ that is still a comment */",
    "let inner = pair.1.0",
    "lazy var label: String = \"Oven number \\(trays.count)\"",
    "let math = \"Sum: \\((1 + 2) * 3) and \\(max(1, 2))\"",
    "let raw = #\"raw \\(not code) and \\#(name) and \"quotes\"\"#",
    "let raw2 = ##\"two hashes \"# still raw \\##(name)\"##",
    "private(set) var slices = 8",
    "func `class`(_ value: Int) -> Int {",
    "if #available(macOS 13, *) {",
  ]) {
    assert.ok(pdf.text.includes(expected), `missing: ${expected}`);
  }

  const combined = await exportSections("mixed_swift_kt.pdf", [
    { ...file("basic.swift", source), language: "swift" },
    { ...file("basic.kt", fixture("basic.kt")), language: "kotlin" },
  ]);
  assert.deepEqual(combined.pdf.outline, ["basic.swift", "basic.kt"], "one bookmark per file");
  assert.ok(combined.pdf.text.includes("#!/usr/bin/env swift"));
});

test("1q. exports a Ruby file, alone and combined with Swift", async () => {
  const source = fixture("basic.rb");
  const { pdf } = await exportSections("basic_ruby.pdf", [file("basic.rb", source)]);
  assert.ok(pdf.pages[0]!.lines[0]!.startsWith("basic.rb"), "file name in the header");
  for (const expected of [
    "def initialize(name, slices: 8, heat: :medium)",
    "def <=>(other)",
    "text = <<~NOTE",
    "Today's bake: #{kind}",
    "bits = 1<<4",
    "pattern = %r{^/path/(\\d+)$}x",
    "words = %w[rye wheat spelt]",
    "puts :a.to_proc.call(\"x\") if loaf.name =~ /ry+e/i",
    "count = defined?(loaf) ? loaf.slices : 0",
  ]) {
    assert.ok(pdf.text.includes(expected), `missing: ${expected}`);
  }

  const combined = await exportSections("mixed_ruby_swift.pdf", [
    { ...file("basic.rb", source), language: "ruby" },
    { ...file("basic.swift", fixture("basic.swift")), language: "swift" },
  ]);
  assert.deepEqual(combined.pdf.outline, ["basic.rb", "basic.swift"], "one bookmark per file");
  assert.ok(combined.pdf.text.includes("#!/usr/bin/env ruby"));
});

test("1r. exports a Dart file, alone and combined with Ruby", async () => {
  const source = fixture("basic.dart");
  const { pdf } = await exportSections("basic_dart.pdf", [file("basic.dart", source)]);
  assert.ok(pdf.pages[0]!.lines[0]!.startsWith("basic.dart"), "file name in the header");
  for (const expected of [
    "typedef Recipe = Map<String, List<int>>;",
    "final list = [1, 2, ...?extras?.values, ...[3, 4]];",
    "count ??= 0;",
    "var raw = r'raw $kind \\n ${nothing}';",
    "var nested = 'a ${n > 1 ? 'many ${kind.length}' : \"one\"} b';",
    "bool operator ==(Object other) => other is Loaf && other._name == _name;",
    "int n when n > 100 => 'big',",
    "Iterable<int> evens() sync* {",
  ]) {
    assert.ok(pdf.text.includes(expected), `missing: ${expected}`);
  }

  const combined = await exportSections("mixed_dart_ruby.pdf", [
    { ...file("basic.dart", source), language: "dart" },
    { ...file("basic.rb", fixture("basic.rb")), language: "ruby" },
  ]);
  assert.deepEqual(combined.pdf.outline, ["basic.dart", "basic.rb"], "one bookmark per file");
  assert.ok(combined.pdf.text.includes("#!/usr/bin/env dart"));
});

test("2. exports comments and strings exactly", async () => {
  const { pdf } = await exportSections("comments_strings.pdf", [file("comments_strings.cpp", fixture("comments_strings.cpp"))]);
  for (const expected of [
    "// Line comment at the top",
    ' * A block comment that spans',
    'const char* greeting = "Hello, \\"quoted\\" world // not a comment";',
    "const char quote = '\\'';",
    'const auto raw = R"json({"key": "value", "path": "C:\\temp"}',
    'second raw line)json";',
    "long long big = 1'000'000;",
  ]) {
    assert.ok(pdf.text.includes(expected), `missing: ${expected}`);
  }
});

test("3. exports Unicode characters, using fill-in fonts where needed", async () => {
  const { pdf } = await exportSections("unicode.pdf", [file("unicode.cpp", fixture("unicode.cpp"))]);
  for (const expected of ["café", "naïve", "π ≈ 3.14159", "x → y", "✓ done", "αβγδ", "Привет", "Ünïcödé"]) {
    assert.ok(pdf.text.includes(expected), `missing: ${expected}`);
  }
  for (const expected of ["中文注释", "日本語のコメント", "한국어"]) {
    assert.ok(pdf.text.replace(/\s/g, "").includes(expected), `missing CJK text: ${expected}`);
  }
  assert.equal(columnOf(pdf.pages[0]!, "return"), 4, "the tab before 'return' expands to 4 columns");
});

test("4. wraps very long lines without losing anything", async () => {
  const source = fixture("long_lines.cpp");
  const { pdf } = await exportSections("long_lines.pdf", [file("long_lines.cpp", source)]);
  const joined = pdf.pages[0]!.lines.join("");
  assert.ok(joined.includes("MARKER_STRING_END"), "end of the long string is printed");
  assert.ok(joined.includes("MARKER_SUM_END"), "end of the long sum is printed");
  const rows = pdf.pages[0]!.lines.filter((l) => l.trimStart().startsWith("\u21aa"));
  assert.ok(rows.length >= 3, "wrapped rows are marked with ↪");
  const noSpace = (s: string): string => s.replace(/\s/g, "");
  const longLine = noSpace(source.split("\n")[3]!);
  const printed = noSpace(pdf.pages[0]!.lines.map((l) => l.replace(/^\s*(\d+|\u21aa)/, "")).join(""));
  assert.ok(printed.includes(longLine), "every character of the long line is there, in order");
});

test("4b. with wrapping off, long lines are cut and marked instead", async () => {
  const { pdf } = await exportSections("long_lines_nowrap.pdf", [file("long_lines.cpp", fixture("long_lines.cpp"))], {
    lineWrapping: false,
  });
  assert.ok(!pdf.text.includes("MARKER_STRING_END"));
  assert.ok(pdf.text.includes("\u2192"), "cut lines end with →");
});

test("5. exports a selection with its real line numbers", async () => {
  const lines = fixture("basic.cpp").split("\n").slice(11, 15).join("\n");
  const { pdf } = await exportSections("selection.pdf", [
    { title: "basic.cpp", subtitle: "Lines 12-15", text: lines, firstLineNumber: 12 },
  ]);
  assert.ok(pdf.pages[0]!.lines[0]!.includes("Lines 12-15"));
  assert.ok(pdf.pages[0]!.lines.some((l) => /^\s*12\s*int main\(\) \{/.test(l)));
  assert.ok(pdf.pages[0]!.lines.some((l) => /^\s*15\s*return 0;/.test(l)));
  assert.ok(!pdf.pages[0]!.lines.some((l) => /^\s*16/.test(l)), "line 16 is outside the selection");
  assert.ok(!pdf.text.includes("sumOf(const"), "nothing outside the selection");
});

test("5b. a selection that starts inside a block comment prints just those lines, numbered from the file", async () => {
  const { pdf } = await exportSections("selection_in_comment.pdf", [
    {
      title: "comments_strings.cpp",
      subtitle: "Lines 6-8",
      text: fixture("comments_strings.cpp"),
      firstLineNumber: 1,
      onlyLines: { start: 5, end: 7 },
    },
  ]);
  const code = pdf.pages[0]!.lines.slice(1, -1); // without header and footer
  assert.equal(code.length, 3);
  assert.match(code[0]!, /^\s*6\s*\* A block comment that spans/);
  assert.match(code[2]!, /^\s*8\s*\*\//);
});

test("6. combines several files, each on a new page, with page numbers throughout", async () => {
  const sections = [
    file("include/util.h", "#pragma once\nint helper();\n"),
    file("src/main.cpp", fixture("basic.cpp")),
    file("src/strings.cpp", fixture("comments_strings.cpp")),
  ];
  const { pdf } = await exportSections("combined.pdf", sections);
  assert.equal(pdf.numPages, 3);
  assert.deepEqual(pdf.outline, ["include/util.h", "src/main.cpp", "src/strings.cpp"], "one bookmark per file");
  sections.forEach((section, i) => {
    const page = pdf.pages[i]!;
    assert.ok(page.lines[0]!.startsWith(section.title), `page ${i + 1} header`);
    assert.ok(page.lines[1]!.startsWith(section.title), `page ${i + 1} section heading`);
    assert.ok(page.text.includes(`Page ${i + 1} of 3`));
  });
});

test("7. settings change the output: A4 landscape, no line numbers, no header, no page numbers, no colours", async () => {
  const { pdf } = await exportSections("settings.pdf", [file("basic.cpp", fixture("basic.cpp"))], {
    paperSize: "A4",
    orientation: "landscape",
    lineNumbers: false,
    header: false,
    pageNumbers: false,
    syntaxHighlighting: false,
    fontSize: 12,
    marginInches: 1,
  });
  assert.equal(Math.round(pdf.pages[0]!.width), 842);
  assert.equal(Math.round(pdf.pages[0]!.height), 595);
  assert.ok(pdf.pages[0]!.lines[0]!.startsWith("#include <iostream>"), "no header, no line numbers");
  assert.ok(!pdf.text.includes("Page 1"));
  assert.ok(pdf.text.includes("2026-11-12"), "footer is still on");
  const bare = await exportSections("settings_bare.pdf", [file("basic.cpp", fixture("basic.cpp"))], {
    header: false,
    footer: false,
    pageNumbers: false,
  });
  assert.ok(!bare.pdf.text.includes("2026-11-12"), "footer off");
});

test("8. long files flow over many pages, fast", async () => {
  const body = Array.from({ length: 5000 }, (_, i) => `    value_${i} = compute(${i}, "text"); // line ${i + 1}`).join("\n");
  const started = Date.now();
  const { pdf } = await exportSections("long_file.pdf", [file("long_file.cpp", body)]);
  const seconds = (Date.now() - started) / 1000;
  assert.ok(pdf.numPages > 50);
  assert.ok(pdf.pages[pdf.numPages - 1]!.text.includes("// line 5000"));
  assert.ok(pdf.pages[pdf.numPages - 1]!.text.includes(`Page ${pdf.numPages} of ${pdf.numPages}`));
  assert.ok(seconds < 10, `took ${seconds}s`);
  console.log(`    5000 lines -> ${pdf.numPages} pages in ${seconds.toFixed(2)} s (including reading it back)`);
});

test("9. edge cases: empty file, Windows line endings, control characters", async () => {
  const empty = await exportSections("empty.pdf", [file("empty.cpp", "")]);
  assert.equal(empty.pdf.numPages, 1);
  const crlf = await exportSections("crlf.pdf", [file("crlf.cpp", "int a;\r\nint b;\r\n")]);
  assert.ok(crlf.pdf.text.includes("int a;") && crlf.pdf.text.includes("int b;"));
  assert.ok(!crlf.pdf.text.includes(" 3"), "no extra line from the final newline");
  const control = await exportSections("control.pdf", [file("control.cpp", "char c = '\u0000';")]);
  assert.ok(control.pdf.text.includes("\u2400"), "a NUL byte shows as ␀");
});

test("10. an export can be cancelled", async () => {
  const sections = [file("a.cpp", fixture("basic.cpp")), file("b.cpp", fixture("basic.cpp"))];
  let calls = 0;
  await assert.rejects(() =>
    renderPdf(sections, normalizeOptions(), fonts, { documentTitle: "x" }, { isCancelled: () => calls++ > 0 }),
  );
  await assert.rejects(async () => {
    try {
      await renderPdf(sections, normalizeOptions(), fonts, { documentTitle: "x" }, { isCancelled: () => true });
    } catch (error) {
      assert.ok(error instanceof ExportCancelledError);
      throw error;
    }
  });
});
