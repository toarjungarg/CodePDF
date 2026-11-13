// Finds the fonts used in exported PDFs: the editor's monospace font (so the
// PDF matches what you see in VS Code), plus fill-in fonts for characters the
// main font doesn't have. Only font folders are listed and only matching font
// files are opened. Nothing is downloaded or installed.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import * as fontkit from "fontkit";

export interface CodeFont {
  /** Name the font is registered under in the PDF document. */
  label: string;
  /** Human-readable family name, e.g. "Menlo". */
  family: string;
  /** Font file path, or null for the PDF format's built-in Courier. */
  path: string | null;
  /** Face name inside a font collection file (.ttc). */
  postscriptName?: string;
  /** Whether this font has a glyph for the character. */
  covers(codePoint: number): boolean;
}

export interface FontSet {
  primary: CodeFont;
  fallbacks: CodeFont[];
}

interface FamilyQuery {
  family: string;
  /** Other spellings to match against file names, e.g. "consola" for Consolas. */
  aliases?: string[];
}

const GENERIC_FAMILIES = new Set([
  "monospace", "serif", "sans-serif", "system-ui", "ui-monospace", "ui-sans-serif", "ui-serif",
  "cursive", "fantasy", "emoji", "math", "fangsong",
]);

const FONT_EXTENSIONS = /\.(ttf|otf|ttc)$/i;
const REGULAR_STYLE = /^(regular|book|roman|normal|medium|plain)$/i;
const OTHER_STYLE = /(bold|italic|oblique|light|thin|black|heavy|semi|demi|condensed|narrow|extra|ultra)/i;

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Splits a CSS-style font list ("'Fira Code', Menlo, monospace") into real family names. */
export function parseFontFamilyList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, "").trim())
    .filter((name) => name.length > 0 && !GENERIC_FAMILIES.has(name.toLowerCase()));
}

function platformDefaults(): { code: FamilyQuery[]; fillIn: FamilyQuery[]; dirs: string[] } {
  const home = homedir();
  if (process.platform === "darwin") {
    return {
      code: [
        { family: "Menlo" },
        { family: "Monaco" },
        { family: "SF Mono", aliases: ["SFNSMono"] },
        { family: "Courier New" },
      ],
      fillIn: [{ family: "Arial Unicode MS", aliases: ["Arial Unicode"] }, { family: "Apple Symbols" }],
      dirs: ["/System/Library/Fonts", "/System/Library/Fonts/Supplemental", "/Library/Fonts", join(home, "Library", "Fonts")],
    };
  }
  if (process.platform === "win32") {
    const windir = process.env["WINDIR"] ?? "C:\\Windows";
    const local = process.env["LOCALAPPDATA"];
    return {
      code: [
        { family: "Consolas", aliases: ["consola"] },
        { family: "Cascadia Mono", aliases: ["CascadiaMono"] },
        { family: "Courier New", aliases: ["cour"] },
      ],
      fillIn: [
        { family: "Segoe UI Symbol", aliases: ["seguisym"] },
        { family: "Microsoft YaHei", aliases: ["msyh"] },
        { family: "Malgun Gothic", aliases: ["malgun"] },
        { family: "Yu Gothic", aliases: ["YuGothR"] },
      ],
      dirs: [join(windir, "Fonts"), ...(local ? [join(local, "Microsoft", "Windows", "Fonts")] : [])],
    };
  }
  return {
    code: [
      { family: "DejaVu Sans Mono" },
      { family: "Liberation Mono" },
      { family: "Noto Sans Mono" },
      { family: "Ubuntu Mono" },
    ],
    fillIn: [{ family: "Noto Sans CJK SC", aliases: ["NotoSansCJK"] }, { family: "DejaVu Sans" }],
    dirs: ["/usr/share/fonts", "/usr/local/share/fonts", join(home, ".local", "share", "fonts"), join(home, ".fonts")],
  };
}

interface FontFile {
  path: string;
  key: string;
}

let fontFileIndex: FontFile[] | null = null;

/** Lists font file names in the system font folders (names only; files aren't opened here). */
function listFontFiles(): FontFile[] {
  if (fontFileIndex) {
    return fontFileIndex;
  }
  const files: FontFile[] = [];
  const visit = (dir: string, depth: number): void => {
    if (depth > 3 || !existsSync(dir)) {
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable folder: skip it
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full, depth + 1);
      } else if (entry.isFile() && FONT_EXTENSIONS.test(entry.name)) {
        files.push({ path: full, key: normalize(entry.name.replace(FONT_EXTENSIONS, "")) });
      }
    }
  };
  for (const dir of platformDefaults().dirs) {
    visit(dir, 0);
  }
  fontFileIndex = files;
  return files;
}

function isMonospace(font: fontkit.Font): boolean {
  const widths = ["i", "M", "0", " ", "W"].map((ch) => font.glyphForCodePoint(ch.codePointAt(0) ?? 0).advanceWidth);
  return widths.every((w) => w > 0 && w === widths[0]);
}

interface FoundFace {
  path: string;
  font: fontkit.Font;
  postscriptName?: string;
}

/** Finds the regular style of a font family by matching file names, then checking inside the file. */
function findFamily(query: FamilyQuery): FoundFace | null {
  const keys = [query.family, ...(query.aliases ?? [])].map(normalize).filter((k) => k.length > 0);
  const candidates = listFontFiles()
    .filter((file) => keys.some((key) => file.key.startsWith(key)))
    .sort((a, b) => {
      // Try likely regular files first: exact name, then "...regular", then the rest.
      const score = (f: FontFile): number =>
        keys.includes(f.key) ? 0 : f.key.endsWith("regular") ? 1 : OTHER_STYLE.test(f.key) ? 3 : 2;
      return score(a) - score(b);
    })
    .slice(0, 12);

  let fallbackFace: FoundFace | null = null;
  for (const file of candidates) {
    let opened: fontkit.Font | fontkit.FontCollection;
    try {
      opened = fontkit.openSync(file.path);
    } catch {
      continue; // unreadable or unsupported font file
    }
    const isCollection = "fonts" in opened;
    const faces = "fonts" in opened ? opened.fonts : [opened];
    for (const face of faces) {
      const familyKey = normalize(face.familyName ?? "");
      if (!keys.some((key) => familyKey.startsWith(key) || key.startsWith(familyKey))) {
        continue;
      }
      const found: FoundFace = isCollection
        ? { path: file.path, font: face, postscriptName: face.postscriptName }
        : { path: file.path, font: face };
      if (REGULAR_STYLE.test(face.subfamilyName ?? "")) {
        return found;
      }
      fallbackFace ??= found;
    }
  }
  return fallbackFace;
}

const WIN_ANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d,
  0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/** The PDF format's built-in Courier: always available, Western European characters only. */
export const BUILT_IN_COURIER: CodeFont = {
  label: "Courier",
  family: "Courier",
  path: null,
  covers: (cp) => (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRAS.has(cp),
};

function toCodeFont(face: FoundFace, label: string, family: string): CodeFont {
  const cache = new Map<number, boolean>();
  const result: CodeFont = {
    label,
    family,
    path: face.path,
    covers: (cp) => {
      let has = cache.get(cp);
      if (has === undefined) {
        has = face.font.hasGlyphForCodePoint(cp);
        cache.set(cp, has);
      }
      return has;
    },
  };
  if (face.postscriptName !== undefined) {
    result.postscriptName = face.postscriptName;
  }
  return result;
}

const fontSetCache = new Map<string, FontSet>();

/**
 * Picks the code font and fill-in fonts.
 * @param editorFontFamily VS Code's "editor.fontFamily" setting, e.g. "Menlo, Monaco, 'Courier New', monospace".
 */
export function resolveFonts(editorFontFamily: string | undefined): FontSet {
  const cacheKey = editorFontFamily ?? "";
  const cached = fontSetCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const defaults = platformDefaults();
  const queries: FamilyQuery[] = [...parseFontFamilyList(editorFontFamily).map((family) => ({ family })), ...defaults.code];

  let primary: CodeFont = BUILT_IN_COURIER;
  const tried = new Set<string>();
  for (const query of queries) {
    const key = normalize(query.family);
    if (tried.has(key)) {
      continue;
    }
    tried.add(key);
    const face = findFamily(query);
    if (face && isMonospace(face.font)) {
      primary = toCodeFont(face, "code", query.family);
      break;
    }
  }

  const fallbacks: CodeFont[] = [];
  defaults.fillIn.forEach((query, index) => {
    const face = findFamily(query);
    if (face) {
      fallbacks.push(toCodeFont(face, `fill${index}`, query.family));
    }
  });

  const set = { primary, fallbacks };
  fontSetCache.set(cacheKey, set);
  return set;
}
