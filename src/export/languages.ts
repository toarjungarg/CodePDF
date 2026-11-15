// Which languages CodePDF can export, how each is recognised (by file
// extension, or by VS Code's language id for unsaved files), and which
// tokenizer colours it. Adding a language means adding one entry here.
// No VS Code imports, so this can be tested in plain Node.

import { tokenizeCFamily } from "./cFamilyTokenizer";
import { tokenizePython } from "./pythonTokenizer";
import type { TokenLine } from "./tokens";

export type LanguageId = "c" | "cpp" | "python";

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
};

const LANGUAGE_IDS = Object.keys(LANGUAGES) as LanguageId[];

/** Every supported extension, e.g. [".c", ".cpp", ...]. */
export const SUPPORTED_EXTENSIONS: readonly string[] = LANGUAGE_IDS.flatMap((id) => LANGUAGES[id].extensions);

function nameList(lastJoiner: string): string {
  const labels = LANGUAGE_IDS.map((id) => LANGUAGES[id].label);
  return labels.length < 2 ? labels.join("") : `${labels.slice(0, -1).join(", ")} ${lastJoiner} ${labels[labels.length - 1]}`;
}

/** "C, C++ and Python", for messages. */
export const LANGUAGE_NAMES = nameList("and");

/** "C, C++ or Python", for messages like "files that aren't C, C++ or Python". */
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

/** The language for VS Code's language id ("c", "cpp", "python"), or undefined if unsupported. */
export function languageForVscodeId(vscodeId: string | undefined): LanguageId | undefined {
  return LANGUAGE_IDS.find((id) => LANGUAGES[id].vscodeId === vscodeId);
}

/** Colours source code in the given language. */
export function tokenize(source: string, language: LanguageId): TokenLine[] {
  return LANGUAGES[language].tokenize(source);
}
