// Minimal type descriptions for the parts of PDFKit CodePDF uses.

declare module "pdfkit" {
  namespace PDFDocument {
    interface Margins {
      top: number;
      bottom: number;
      left: number;
      right: number;
    }

    interface DocumentOptions {
      size?: [number, number];
      margins?: Margins;
      autoFirstPage?: boolean;
      bufferPages?: boolean;
      font?: string;
      fontFamily?: string;
      compress?: boolean;
      displayTitle?: boolean;
      lang?: string;
      info?: {
        Title?: string;
        Author?: string;
        Subject?: string;
        Creator?: string;
        Producer?: string;
        CreationDate?: Date;
      };
    }

    interface PageOptions {
      size?: [number, number];
      margins?: Margins;
    }

    interface TextOptions {
      lineBreak?: boolean;
      features?: Record<string, boolean>;
      width?: number;
      align?: "left" | "center" | "right";
    }

    interface Outline {
      addItem(title: string, options?: { expanded?: boolean }): Outline;
    }
  }

  class PDFDocument {
    constructor(options?: PDFDocument.DocumentOptions);
    readonly outline: PDFDocument.Outline;
    readonly page: { readonly width: number; readonly height: number };

    addPage(options?: PDFDocument.PageOptions): this;
    registerFont(name: string, src: string | Uint8Array, family?: string): this;
    font(name: string): this;
    fontSize(size: number): this;
    fillColor(color: string): this;
    strokeColor(color: string): this;
    lineWidth(width: number): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    stroke(): this;
    text(text: string, x: number, y: number, options?: PDFDocument.TextOptions): this;
    widthOfString(text: string, options?: PDFDocument.TextOptions): number;
    bufferedPageRange(): { start: number; count: number };
    switchToPage(index: number): void;
    end(): void;

    on(event: "data", listener: (chunk: Uint8Array) => void): this;
    on(event: "end", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
  }

  export = PDFDocument;
}
