// Copies only the pdf.js files the viewer needs from node_modules/pdfjs-dist
// into media/pdfjs/, so the packaged extension stays small.
// Deliberately left out: the legacy build, source maps, the WebAssembly files
// (the viewer runs with useWasm: false) and quickjs-eval (PDF scripting is off).
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const dest = join(root, "media", "pdfjs");

if (!existsSync(src)) {
  console.error("pdfjs-dist is missing. Run `npm ci` first.");
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

const files = [
  "LICENSE",
  "build/pdf.min.mjs",
  "build/pdf.worker.min.mjs",
  "web/pdf_viewer.mjs",
  "web/pdf_viewer.css",
];
const folders = ["web/images", "cmaps", "standard_fonts", "iccs"];

for (const file of files) {
  cpSync(join(src, file), join(dest, file));
}
for (const folder of folders) {
  cpSync(join(src, folder), join(dest, folder), { recursive: true });
}

// From wasm/, only the plain-JavaScript image decoders and the licence files.
mkdirSync(join(dest, "wasm"), { recursive: true });
for (const name of readdirSync(join(src, "wasm"))) {
  if (name.endsWith("_nowasm_fallback.js") || name.startsWith("LICENSE")) {
    cpSync(join(src, "wasm", name), join(dest, "wasm", name));
  }
}

console.log("Copied pdf.js viewer files to media/pdfjs/");
