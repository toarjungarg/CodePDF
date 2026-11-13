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
