// Minimal type descriptions for the parts of fontkit CodePDF uses.

declare module "fontkit" {
  export interface Font {
    readonly type: string;
    readonly postscriptName: string;
    readonly familyName: string;
    readonly subfamilyName: string;
    readonly numGlyphs: number;
    hasGlyphForCodePoint(codePoint: number): boolean;
    glyphForCodePoint(codePoint: number): { readonly id: number; readonly advanceWidth: number };
  }

  export interface FontCollection {
    readonly type: "TTC" | "DFont";
    readonly fonts: Font[];
  }

  export function openSync(path: string): Font | FontCollection;
}
