// Which languages CodePDF can export, how each is recognised (by file
// extension, or by VS Code's language id for unsaved files), and which
// tokenizer colours it. Adding a language means adding one entry here.
// No VS Code imports, so this can be tested in plain Node.

import { tokenizeCFamily } from "./cFamilyTokenizer";
import { tokenizeCSharp } from "./csharpTokenizer";
import { tokenizeCss } from "./cssTokenizer";
import { tokenizeGo } from "./goTokenizer";
import { tokenizeHtml } from "./htmlTokenizer";
import { tokenizeJava } from "./javaTokenizer";
import { tokenizeJavaScript } from "./javascriptTokenizer";
import { tokenizePhp } from "./phpTokenizer";
import { tokenizePython } from "./pythonTokenizer";
import { tokenizeRust } from "./rustTokenizer";
import { tokenizeShell } from "./shellTokenizer";
import { tokenizeSql } from "./sqlTokenizer";
import type { TokenLine } from "./tokens";

export type LanguageId = "c" | "cpp" | "python" | "css" | "html" | "javascript" | "typescript" | "javascriptreact" | "typescriptreact" | "rust" | "java" | "csharp" | "go" | "php" | "sql" | "shell";

interface Language {
  /** Shown in messages, e.g. "C++". */
  label: string;
  /** Lower-case, with the dot. */
  extensions: readonly string[];
  /** VS Code's id for the language, used for unsaved files and per-language editor settings. */
  vscodeId: string;
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
};

const LANGUAGE_IDS = Object.keys(LANGUAGES) as LanguageId[];

/** Every supported extension, e.g. [".c", ".cpp", ...]. */
export const SUPPORTED_EXTENSIONS: readonly string[] = LANGUAGE_IDS.flatMap((id) => LANGUAGES[id].extensions);

function nameList(lastJoiner: string): string {
  const labels = [...new Set(LANGUAGE_IDS.map((id) => LANGUAGES[id].label))]; // "React" only once
  return labels.length < 2 ? labels.join("") : `${labels.slice(0, -1).join(", ")} ${lastJoiner} ${labels[labels.length - 1]}`;
}

/** "C, C++, Python, CSS, HTML, JavaScript, TypeScript, React, Rust, Java, C#, Go, PHP, SQL and Shell", for messages. */
export const LANGUAGE_NAMES = nameList("and");

/** "C, C++, Python, CSS, HTML, JavaScript, TypeScript, React, Rust, Java, C#, Go, PHP, SQL or Shell", for messages like "files that aren't ...". */
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

/** The language for VS Code's language id ("c", "cpp", "python", "typescriptreact", "rust", "java", "csharp", "go", "php", "sql", "shellscript", ...), or undefined if unsupported. */
export function languageForVscodeId(vscodeId: string | undefined): LanguageId | undefined {
  return LANGUAGE_IDS.find((id) => LANGUAGES[id].vscodeId === vscodeId);
}

/** Colours source code in the given language. */
export function tokenize(source: string, language: LanguageId): TokenLine[] {
  return LANGUAGES[language].tokenize(source);
}
