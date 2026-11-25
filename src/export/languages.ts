// Which languages CodePDF can export, how each is recognised (by file
// extension, or by VS Code's language id for unsaved files), and which
// tokenizer colours it. Adding a language means adding one entry here.
// No VS Code imports, so this can be tested in plain Node.

import { tokenizeAsm } from "./asmTokenizer";
import { tokenizeCFamily } from "./cFamilyTokenizer";
import { tokenizeCSharp } from "./csharpTokenizer";
import { tokenizeCss } from "./cssTokenizer";
import { tokenizeDart } from "./dartTokenizer";
import { tokenizeGo } from "./goTokenizer";
import { tokenizeHtml } from "./htmlTokenizer";
import { tokenizeJava } from "./javaTokenizer";
import { tokenizeJavaScript } from "./javascriptTokenizer";
import { tokenizeKotlin } from "./kotlinTokenizer";
import { tokenizeLatex } from "./latexTokenizer";
import { tokenizeLua } from "./luaTokenizer";
import { tokenizeMatlab } from "./matlabTokenizer";
import { tokenizePhp } from "./phpTokenizer";
import { tokenizePython } from "./pythonTokenizer";
import { tokenizeR } from "./rTokenizer";
import { tokenizeRuby } from "./rubyTokenizer";
import { tokenizeRust } from "./rustTokenizer";
import { tokenizeShell } from "./shellTokenizer";
import { tokenizeSql } from "./sqlTokenizer";
import { tokenizeSwift } from "./swiftTokenizer";
import { tokenizeVerilog } from "./verilogTokenizer";
import { tokenizeVhdl } from "./vhdlTokenizer";
import type { TokenLine } from "./tokens";

export type LanguageId = "c" | "cpp" | "python" | "css" | "html" | "javascript" | "typescript" | "javascriptreact" | "typescriptreact" | "rust" | "java" | "csharp" | "go" | "php" | "sql" | "shell" | "kotlin" | "swift" | "ruby" | "dart" | "lua" | "r" | "matlab" | "arduino" | "verilog" | "systemverilog" | "vhdl" | "asm" | "latex";

interface Language {
  /** Shown in messages, e.g. "C++". */
  label: string;
  /** Lower-case, with the dot. */
  extensions: readonly string[];
  /** VS Code's id for the language, used for unsaved files and per-language editor settings. */
  vscodeId: string;
  /** Other VS Code ids that mean the same language (LaTeX files can show up as "latex" or "tex"). */
  otherVscodeIds?: readonly string[];
  tokenize(source: string): TokenLine[];
}

// .h is used by both C and C++. It's treated as C++ (a superset of C), so C
// headers still colour correctly; only C code using a C++ keyword such as
// `new` as a name would show that word as a keyword.
export const LANGUAGES: Record<LanguageId, Language> = {
  c: {
    label: "C",
    extensions: [".c"],
    vscodeId: "c",
    tokenize: (source) => tokenizeCFamily(source, "c"),
  },
  cpp: {
    label: "C++",
    extensions: [".cpp", ".cc", ".cxx", ".h", ".hpp", ".hh", ".hxx"],
    vscodeId: "cpp",
    tokenize: (source) => tokenizeCFamily(source, "cpp"),
  },
  python: {
    label: "Python",
    extensions: [".py", ".pyw"],
    vscodeId: "python",
    tokenize: tokenizePython,
  },
  css: {
    label: "CSS",
    extensions: [".css"],
    vscodeId: "css",
    tokenize: tokenizeCss,
  },
  html: {
    label: "HTML",
    extensions: [".html", ".htm"],
    vscodeId: "html",
    tokenize: tokenizeHtml,
  },
  javascript: {
    label: "JavaScript",
    extensions: [".js", ".mjs", ".cjs"],
    vscodeId: "javascript",
    tokenize: (source) => tokenizeJavaScript(source),
  },
  typescript: {
    label: "TypeScript",
    extensions: [".ts", ".mts", ".cts"],
    vscodeId: "typescript",
    tokenize: (source) => tokenizeJavaScript(source, { typescript: true }),
  },
  // React files: JSX in JavaScript (.jsx) or TypeScript (.tsx). Both are "React" in messages.
  javascriptreact: {
    label: "React",
    extensions: [".jsx"],
    vscodeId: "javascriptreact",
    tokenize: (source) => tokenizeJavaScript(source, { jsx: true }),
  },
  typescriptreact: {
    label: "React",
    extensions: [".tsx"],
    vscodeId: "typescriptreact",
    tokenize: (source) => tokenizeJavaScript(source, { typescript: true, jsx: true }),
  },
  rust: {
    label: "Rust",
    extensions: [".rs"],
    vscodeId: "rust",
    tokenize: tokenizeRust,
  },
  java: {
    label: "Java",
    extensions: [".java"],
    vscodeId: "java",
    tokenize: tokenizeJava,
  },
  csharp: {
    label: "C#",
    extensions: [".cs"],
    vscodeId: "csharp",
    tokenize: tokenizeCSharp,
  },
  go: {
    label: "Go",
    extensions: [".go"],
    vscodeId: "go",
    tokenize: tokenizeGo,
  },
  php: {
    label: "PHP",
    extensions: [".php"],
    vscodeId: "php",
    tokenize: tokenizePhp,
  },
  sql: {
    label: "SQL",
    extensions: [".sql"],
    vscodeId: "sql",
    tokenize: tokenizeSql,
  },
  // Bash and plain sh are coloured the same way. VS Code calls both "shellscript".
  shell: {
    label: "Shell",
    extensions: [".sh", ".bash"],
    vscodeId: "shellscript",
    tokenize: tokenizeShell,
  },
  // .kts files are Kotlin scripts (like Gradle build files) and are coloured the same way.
  kotlin: {
    label: "Kotlin",
    extensions: [".kt", ".kts"],
    vscodeId: "kotlin",
    tokenize: tokenizeKotlin,
  },
  swift: {
    label: "Swift",
    extensions: [".swift"],
    vscodeId: "swift",
    tokenize: tokenizeSwift,
  },
  ruby: {
    label: "Ruby",
    extensions: [".rb"],
    vscodeId: "ruby",
    tokenize: tokenizeRuby,
  },
  dart: {
    label: "Dart",
    extensions: [".dart"],
    vscodeId: "dart",
    tokenize: tokenizeDart,
  },
  lua: {
    label: "Lua",
    extensions: [".lua"],
    vscodeId: "lua",
    tokenize: tokenizeLua,
  },
  r: {
    label: "R",
    extensions: [".r"],
    vscodeId: "r",
    tokenize: tokenizeR,
  },
  // Every .m file is read as MATLAB. CodePDF has no Objective-C support, so there is no clash.
  matlab: {
    label: "MATLAB",
    extensions: [".m"],
    vscodeId: "matlab",
    tokenize: tokenizeMatlab,
  },
  // An Arduino sketch is C++ with a few extra names, so it uses the C++ tokenizer.
  // It has its own entry so messages say "Arduino" and the Arduino extension's
  // language id ("arduino") is recognised. A plain .ino file works without that extension.
  arduino: {
    label: "Arduino",
    extensions: [".ino"],
    vscodeId: "arduino",
    tokenize: (source) => tokenizeCFamily(source, "cpp"),
  },
  // Verilog and SystemVerilog share one tokenizer (SystemVerilog is Verilog plus more words).
  // They are two entries so messages and the VS Code language ids ("verilog", "systemverilog")
  // match what people have installed. Every .v file is read as Verilog, so Coq and V files are not supported.
  verilog: {
    label: "Verilog",
    extensions: [".v", ".vh"],
    vscodeId: "verilog",
    tokenize: tokenizeVerilog,
  },
  systemverilog: {
    label: "SystemVerilog",
    extensions: [".sv", ".svh"],
    vscodeId: "systemverilog",
    tokenize: tokenizeVerilog,
  },
  // VHDL is not case-sensitive, so it has its own tokenizer, not the Verilog one.
  vhdl: {
    label: "VHDL",
    extensions: [".vhd", ".vhdl"],
    vscodeId: "vhdl",
    tokenize: tokenizeVhdl,
  },
  // Assembly differs a lot between chips, so one general tokenizer reads them all. VS Code has no
  // built-in assembly id, so "asm" is only used for unsaved files. Saved files go by extension
  // (.S with a capital letter is the same, since extensions are compared in lower case).
  asm: {
    label: "Assembly",
    extensions: [".s", ".asm"],
    vscodeId: "asm",
    tokenize: tokenizeAsm,
  },
  // VS Code's built-in grammar gives .tex the id "latex" but .sty and .cls the id "tex", so both ids
  // are accepted. That way unsaved files and per-language editor settings work for all three extensions.
  latex: {
    label: "LaTeX",
    extensions: [".tex", ".sty", ".cls"],
    vscodeId: "latex",
    otherVscodeIds: ["tex"],
    tokenize: tokenizeLatex,
  },
};

const LANGUAGE_IDS = Object.keys(LANGUAGES) as LanguageId[];

/** Every supported extension, e.g. [".c", ".cpp", ...]. */
export const SUPPORTED_EXTENSIONS: readonly string[] = LANGUAGE_IDS.flatMap((id) => LANGUAGES[id].extensions);

function nameList(lastJoiner: string): string {
  const labels = [...new Set(LANGUAGE_IDS.map((id) => LANGUAGES[id].label))]; // "React" only once
  return labels.length < 2 ? labels.join("") : `${labels.slice(0, -1).join(", ")} ${lastJoiner} ${labels[labels.length - 1]}`;
}

/** "C, C++, Python, CSS, HTML, JavaScript, TypeScript, React, Rust, Java, C#, Go, PHP, SQL, Shell, Kotlin, Swift, Ruby, Dart, Lua, R, MATLAB, Arduino, Verilog, SystemVerilog, VHDL, Assembly and LaTeX", for messages. */
export const LANGUAGE_NAMES = nameList("and");

/** "C, C++, Python, CSS, HTML, JavaScript, TypeScript, React, Rust, Java, C#, Go, PHP, SQL, Shell, Kotlin, Swift, Ruby, Dart, Lua, R, MATLAB, Arduino, Verilog, SystemVerilog, VHDL, Assembly or LaTeX", for messages like "files that aren't ...". */
export const LANGUAGE_NAMES_OR = nameList("or");

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot).toLowerCase() : "";
}

/** The language of a file, from its extension ("main.c" is C), or undefined if unsupported. */
export function languageForFile(fileName: string): LanguageId | undefined {
  const ext = extensionOf(fileName);
  return LANGUAGE_IDS.find((id) => LANGUAGES[id].extensions.includes(ext));
}

/** The language for VS Code's language id ("c", "cpp", "python", "typescriptreact", "rust", "java", "csharp", "go", "php", "sql", "shellscript", "kotlin", "swift", "ruby", "dart", "lua", "r", "matlab", "arduino", "verilog", "systemverilog", "vhdl", "asm", "latex", "tex", ...), or undefined if unsupported. */
export function languageForVscodeId(vscodeId: string | undefined): LanguageId | undefined {
  return LANGUAGE_IDS.find((id) => LANGUAGES[id].vscodeId === vscodeId || (LANGUAGES[id].otherVscodeIds ?? []).includes(vscodeId ?? ""));
}

/** Colours source code in the given language. */
export function tokenize(source: string, language: LanguageId): TokenLine[] {
  return LANGUAGES[language].tokenize(source);
}
