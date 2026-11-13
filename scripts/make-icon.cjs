// Draws the CodePDF icon with PDFKit (shapes only, no fonts or images) and
// saves it as a one-page PDF. Convert it to PNG with macOS's built-in tool:
//   node scripts/make-icon.cjs
//   sips -s format png workspace/icon.pdf --out media/icon.png
const fs = require("node:fs");
const path = require("node:path");
const PDFDocument = require("pdfkit");

const SIZE = 256;
const out = path.join(__dirname, "..", "workspace", "icon.pdf");
fs.mkdirSync(path.dirname(out), { recursive: true });

const doc = new PDFDocument({ size: [SIZE, SIZE], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
doc.pipe(fs.createWriteStream(out));

// Background
doc.rect(0, 0, SIZE, SIZE).fill("#1f5fbf");

// Page with a folded top-right corner
const left = 58;
const top = 34;
const right = 198;
const bottom = 222;
const fold = 40;
doc
  .moveTo(left, top)
  .lineTo(right - fold, top)
  .lineTo(right, top + fold)
  .lineTo(right, bottom)
  .lineTo(left, bottom)
  .closePath()
  .fill("#ffffff");
doc
  .moveTo(right - fold, top)
  .lineTo(right - fold, top + fold)
  .lineTo(right, top + fold)
  .closePath()
  .fill("#c9d8f0");

// "Code lines" in syntax colours
const bar = (x, y, width, color) => doc.roundedRect(x, y, width, 9, 4.5).fill(color);
bar(76, 62, 54, "#af00db");
bar(76, 82, 30, "#0000ff");
bar(112, 82, 44, "#1f1f1f");
bar(90, 102, 62, "#a31515");
bar(90, 122, 40, "#008000");

// </> symbol
doc.lineWidth(11).lineCap("round").lineJoin("round").strokeColor("#1f5fbf");
doc.moveTo(104, 158).lineTo(82, 178).lineTo(104, 198).stroke();
doc.moveTo(152, 158).lineTo(174, 178).lineTo(152, 198).stroke();
doc.moveTo(136, 154).lineTo(120, 202).stroke();

doc.end();
console.log(`Wrote ${out}`);
