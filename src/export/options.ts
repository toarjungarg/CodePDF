// Everything that controls how an exported PDF looks, in one place.
// The VS Code settings, the commands and the renderer all use this type.

export type PaperSize = "Letter" | "A4";
export type Orientation = "portrait" | "landscape";

export interface ExportOptions {
  paperSize: PaperSize;
  orientation: Orientation;
  /** Code font size in points (1 point = 1/72 inch). */
  fontSize: number;
  /** Page margin in inches, the same on all four sides. */
  marginInches: number;
  lineNumbers: boolean;
  syntaxHighlighting: boolean;
  header: boolean;
  footer: boolean;
  pageNumbers: boolean;
  lineWrapping: boolean;
  /** How many columns a tab character jumps to (taken from the editor's tab size). */
  tabSize: number;
}

export const DEFAULT_OPTIONS: Readonly<ExportOptions> = {
  paperSize: "Letter",
  orientation: "portrait",
  fontSize: 10,
  marginInches: 0.75,
  lineNumbers: true,
  syntaxHighlighting: true,
  header: true,
  footer: true,
  pageNumbers: true,
  lineWrapping: true,
  tabSize: 4,
};

export const LIMITS = {
  fontSize: { min: 6, max: 16 },
  marginInches: { min: 0.25, max: 2 },
  tabSize: { min: 1, max: 16 },
} as const;

/** Page sizes in points, portrait. */
export const PAPER_SIZES: Readonly<Record<PaperSize, readonly [number, number]>> = {
  Letter: [612, 792],
  A4: [595.28, 841.89],
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Turns possibly incomplete or invalid settings into a complete, safe set of options.
 * Unknown values fall back to the defaults; numbers are clamped to their allowed range.
 */
export function normalizeOptions(input: Partial<Record<keyof ExportOptions, unknown>> = {}): ExportOptions {
  const d = DEFAULT_OPTIONS;
  return {
    paperSize: input.paperSize === "A4" || input.paperSize === "Letter" ? input.paperSize : d.paperSize,
    orientation:
      input.orientation === "landscape" || input.orientation === "portrait" ? input.orientation : d.orientation,
    fontSize: clamp(input.fontSize, LIMITS.fontSize.min, LIMITS.fontSize.max, d.fontSize),
    marginInches: clamp(input.marginInches, LIMITS.marginInches.min, LIMITS.marginInches.max, d.marginInches),
    lineNumbers: bool(input.lineNumbers, d.lineNumbers),
    syntaxHighlighting: bool(input.syntaxHighlighting, d.syntaxHighlighting),
    header: bool(input.header, d.header),
    footer: bool(input.footer, d.footer),
    pageNumbers: bool(input.pageNumbers, d.pageNumbers),
    lineWrapping: bool(input.lineWrapping, d.lineWrapping),
    tabSize: Math.round(clamp(input.tabSize, LIMITS.tabSize.min, LIMITS.tabSize.max, d.tabSize)),
  };
}

/** Page width and height in points for the chosen paper size and orientation. */
export function pageSize(options: ExportOptions): [number, number] {
  const [w, h] = PAPER_SIZES[options.paperSize];
  return options.orientation === "landscape" ? [h, w] : [w, h];
}
