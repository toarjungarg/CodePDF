// Runs test/vscode/suite.ts inside the VS Code app already installed on this
// Mac, using a separate throwaway profile in workspace/vscode-test/ so your
// normal settings and extensions are never touched. Nothing is downloaded.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const base = join(root, "workspace", "vscode-test");
const project = join(base, "project");
const userData = join(base, "user-data");
// With --packaged, the built .vsix is installed into the test profile and
// checked, instead of running the development copy.
const packaged = process.argv.includes("--packaged");
const extensionsDir = join(base, packaged ? "extensions-packaged" : "extensions");
const fixtures = join(root, "test", "fixtures");
// VS Code's main program. (Its `code` helper script returns straight away, so
// the tests couldn't be waited for; the main program stays attached.)
const codeCli = process.env.VSCODE_BINARY ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code";

if (!existsSync(codeCli)) {
  console.error(`VS Code wasn't found at:\n  ${codeCli}\nSet VSCODE_BINARY to the path of its main program.`);
  process.exit(1);
}

// 1. A fresh test project.
rmSync(project, { recursive: true, force: true });
rmSync(join(base, "results.json"), { force: true });
rmSync(join(userData, "logs"), { recursive: true, force: true });
const put = (path, data) => {
  const full = join(project, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
};
put("main.cpp", readFileSync(join(fixtures, "basic.cpp")));
put("lab.c", readFileSync(join(fixtures, "basic.c")));
put("stats.py", readFileSync(join(fixtures, "basic.py")));
put("styles.css", readFileSync(join(fixtures, "basic.css")));
put("index.html", readFileSync(join(fixtures, "basic.html")));
put("recipe.js", readFileSync(join(fixtures, "basic.js")));
put("scale.ts", readFileSync(join(fixtures, "basic.ts")));
put("card.jsx", readFileSync(join(fixtures, "basic.jsx")));
put("list.tsx", readFileSync(join(fixtures, "basic.tsx")));
put("pantry.rs", readFileSync(join(fixtures, "basic.rs")));
put("Kitchen.java", readFileSync(join(fixtures, "basic.java")));
put("Cookbook.cs", readFileSync(join(fixtures, "basic.cs")));
put("shelf.go", readFileSync(join(fixtures, "basic.go")));
put("larder.php", readFileSync(join(fixtures, "basic.php")));
put("bookshop.sql", readFileSync(join(fixtures, "basic.sql")));
put("backup.sh", readFileSync(join(fixtures, "basic.sh")));
put("Bakery.kt", readFileSync(join(fixtures, "basic.kt")));
put("Oven.swift", readFileSync(join(fixtures, "basic.swift")));
put("loaves.rb", readFileSync(join(fixtures, "basic.rb")));
put("dough.dart", readFileSync(join(fixtures, "basic.dart")));
put("rolls.lua",readFileSync(join(fixtures, "basic.lua")));
put("Scones.R", readFileSync(join(fixtures, "basic.r")));
put("pastry.m", readFileSync(join(fixtures, "basic.m")));
put("toaster.ino", readFileSync(join(fixtures, "basic.ino")));
put("timer.sv", readFileSync(join(fixtures, "basic.sv")));
put("alu.vhd", readFileSync(join(fixtures, "basic.vhd")));
put("adder.vhdl", "-- A made-up VHDL file\nentity adder is\n  port (a, b : in bit; y : out bit);\nend entity adder;\n");
put("toast.s", readFileSync(join(fixtures, "basic.s")));
put("boot.asm", "; A made-up NASM file\nsection .text\nglobal start\nstart:\n  mov eax, 0FFh\n  ret\n");
put("Entry.S", "#include \"entry.h\"\n.text\n.globl entry\nentry:\n  mov r0, #5 @ five\n  bx lr\n");
put("bread.tex", readFileSync(join(fixtures, "basic.tex")));
put("crumbs.sty", "% A made-up LaTeX package\n\\ProvidesPackage{crumbs}\n\\newcommand{\\crumb}{\\@ifnextchar[{\\crumbA}{\\crumbB}}\n");
put("Report.cls", "% A made-up LaTeX class\n\\ProvidesClass{Report}\n\\LoadClass[12pt]{article}\n");
put("cupboard.json", readFileSync(join(fixtures, "basic.json")));
put("tsconfig.json", "// A made-up tsconfig, which VS Code opens as JSON with comments\n{\n  \"compilerOptions\": { \"strict\": true, \"target\": \"es2020\" }\n}\n");
put("stove.jsonc", "/* A made-up JSONC file */\n{ \"preheat\": 180, \"door\": null }\n");
put("cellar.yaml",readFileSync(join(fixtures, "basic.yaml")));
put("compose.yml", "# A made-up compose file\nservices:\n  web:\n    image: nginx\n    ports: [\"80:80\"]\n");
put("pnpm-lock.yaml", "lockfileVersion: '9.0'\npackages: {}\n");
put("pantry-list.xml", readFileSync(join(fixtures, "basic.xml")));
put("shape.xsd", "<?xml version=\"1.0\"?>\n<!-- A made-up schema -->\n<xs:schema xmlns:xs=\"http://www.w3.org/2001/XMLSchema\">\n  <xs:element name=\"loaf\" type=\"xs:string\"/>\n</xs:schema>\n");
put("page.xsl", "<?xml version=\"1.0\"?>\n<xsl:stylesheet version=\"1.0\" xmlns:xsl=\"http://www.w3.org/1999/XSL/Transform\">\n  <xsl:template match=\"/\"><p>Hello</p></xsl:template>\n</xsl:stylesheet>\n");
put("sheet.xslt", "<?xml version=\"1.0\"?>\n<xsl:transform version=\"1.0\" xmlns:xsl=\"http://www.w3.org/1999/XSL/Transform\">\n  <xsl:output method=\"html\"/>\n</xsl:transform>\n");
put("oven-settings.toml", readFileSync(join(fixtures, "basic.toml")));
put("Cargo.toml", "# A made-up package file\n[package]\nname = \"toaster\"\nversion = \"0.1.0\"\n");
put("package-lock.json","{\n  \"name\": \"generated\",\n  \"lockfileVersion\": 3\n}\n");
put("gates.v","// A made-up Verilog file\nmodule gates(input a, input b, output y);\n  assign y = a & b;\nendmodule\n");
for (const name of ["comments_strings.cpp", "unicode.cpp", "long_lines.cpp"]) {
  cpSync(join(fixtures, name), join(project, name));
}
put("util.h", "#pragma once\n\nint helper(int value);\n");
put("src/extra.cpp", '#include "../util.h"\n\nint helper(int value) {\n    return value * 2;\n}\n');
put("build/generated.cpp", "// build output: must be skipped\n");
put("node_modules/dep/dep.cpp", "// dependency: must be skipped\n");
put("node_modules/dep/index.js", "// dependency: must be skipped\n");
put("node_modules/dep/index.d.ts", "// dependency types: must be skipped\n");
put("dist/bundle.js", "// build output: must be skipped\n");
put(".hidden.cpp", "// hidden: must be skipped\n");
put("__pycache__/cached.py", "# cache folder: must be skipped\n");
put("venv/lib/site.py", "# virtual environment: must be skipped\n");
put("target/debug/build.rs", "// Cargo build output: must be skipped\n");
put("out/production/Old.java", "// IntelliJ build output: must be skipped\n");
put("obj/Debug/AssemblyInfo.cs", "// .NET build output: must be skipped\n");
put("vendor/dep/dep.go", "// Go dependency copy: must be skipped\n");
put("vendor/autoload.php", "<?php // Composer dependency copy: must be skipped\n");
put("Pods/Dep/Dep.swift", "// CocoaPods dependency copy: must be skipped\n");
put("DerivedData/Build/Gen.swift", "// Xcode build output: must be skipped\n");
put("Carthage/Checkouts/Dep.swift", "// Carthage dependency copy: must be skipped\n");
put("vendor/bundle/ruby/gems/dep.rb", "# Bundler dependency copy: must be skipped\n");
put(".bundle/config.rb", "# Bundler settings folder (hidden): must be skipped\n");
put(".dart_tool/gen/cache.dart", "// Dart tool cache (hidden folder): must be skipped\n");
put("lua_modules/share/lua/dep.lua", "-- LuaRocks dependency copy: must be skipped\n");
put("renv/library/dep.R", "# renv package library copy: must be skipped\n");
put("packrat/lib/dep.R", "# packrat package library copy: must be skipped\n");
put(".Rproj.user/cache.R", "# RStudio project folder (hidden): must be skipped\n");
put("slprj/sim/cache.m", "% Simulink build folder: must be skipped\n");
put("codegen/lib/gen.m", "% MATLAB Coder build folder: must be skipped\n");
put("obj_dir/Vtop.v", "// Verilator output folder: must be skipped\n");
put("xsim.dir/sim/gen.sv", "// Vivado simulator folder: must be skipped\n");
put("incremental_db/gen.v", "// Quartus cache folder: must be skipped\n");
put("notes.txt","Not source code.\n");

// 2. Test PDFs, made with CodePDF's own (compiled) engine.
const { renderPdf } = require(join(root, "out", "src", "export", "renderer.js"));
const { resolveFonts } = require(join(root, "out", "src", "export", "fonts.js"));
const { normalizeOptions } = require(join(root, "out", "src", "export", "options.js"));
const fonts = resolveFonts("Menlo, monospace");
const make = (sections, overrides = {}) =>
  renderPdf(sections, normalizeOptions(overrides), fonts, { documentTitle: "test" });
const basic = readFileSync(join(fixtures, "basic.cpp"), "utf8");
const combined = await make([
  { title: "util.h", text: "#pragma once\nint helper();\n", firstLineNumber: 1 },
  { title: "main.cpp", text: basic, firstLineNumber: 1 },
  { title: "strings.cpp", text: readFileSync(join(fixtures, "comments_strings.cpp"), "utf8"), firstLineNumber: 1 },
]);
put("pdfs/combined.pdf", combined);
put("pdfs/basic.pdf", await make([{ title: "main.cpp", text: basic, firstLineNumber: 1 }]));
const longText = Array.from({ length: 5000 }, (_, i) => `    value_${i} = compute(${i}); // line ${i + 1}`).join("\n");
put("pdfs/long_file.pdf", await make([{ title: "long_file.cpp", text: longText, firstLineNumber: 1 }]));
put(
  "pdfs/settings.pdf",
  await make([{ title: "main.cpp", text: basic, firstLineNumber: 1 }], { paperSize: "A4", orientation: "landscape" }),
);
put("pdfs/notapdf.pdf", "This is plain text pretending to be a PDF.\n");
put("pdfs/empty.pdf", "");
put("pdfs/truncated.pdf", combined.slice(0, Math.floor(combined.length * 0.6)));

// A password-protected PDF (password "secret"), made directly with PDFKit.
const PDFDocument = require("pdfkit");
const protectedPdf = await new Promise((resolve, reject) => {
  const doc = new PDFDocument({ userPassword: "secret", ownerPassword: "owner-secret" });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  doc.on("end", () => resolve(Buffer.concat(chunks)));
  doc.on("error", reject);
  doc.text("Protected test document");
  doc.end();
});
put("pdfs/protected.pdf", protectedPdf);

// 3. A separate VS Code profile with telemetry, updates and experiments off.
mkdirSync(join(userData, "User"), { recursive: true });
mkdirSync(extensionsDir, { recursive: true });
writeFileSync(
  join(userData, "User", "settings.json"),
  JSON.stringify(
    {
      "telemetry.telemetryLevel": "off",
      "update.mode": "none",
      "extensions.autoCheckUpdates": false,
      "extensions.autoUpdate": false,
      "extensions.ignoreRecommendations": true,
      "workbench.enableExperiments": false,
      "workbench.settings.enableNaturalLanguageSearch": false,
      "workbench.startupEditor": "none",
      "workbench.tips.enabled": false,
      "security.workspace.trust.enabled": false,
      "git.enabled": false,
      "npm.fetchOnlinePackageInfo": false,
    },
    null,
    2,
  ),
);

// 4. Launch VS Code with CodePDF in development mode and run the suite.
let developmentPath = root;
let testsPath = join(root, "out", "test", "vscode", "suite.js");
if (packaged) {
  // Test the .vsix for the current version, even when older ones are kept in the folder.
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const vsix = `codepdf-${version}.vsix`;
  if (!existsSync(join(root, vsix))) {
    console.error(`${vsix} wasn't found. Run \`npm run package\` first.`);
    process.exit(1);
  }
  // Install the .vsix into the throwaway profile only (never your real VS Code).
  rmSync(extensionsDir, { recursive: true, force: true });
  mkdirSync(extensionsDir, { recursive: true });
  const cli = join(dirname(dirname(codeCli)), "Resources", "app", "bin", "code");
  execFileSync(cli, [
    "--install-extension", join(root, vsix), "--force",
    `--extensions-dir=${extensionsDir}`, `--user-data-dir=${userData}`,
  ], { stdio: "inherit" });
  // VS Code only runs a test script alongside a development extension, so give
  // it an empty one; CodePDF itself comes from the installed .vsix.
  developmentPath = join(base, "empty-extension");
  mkdirSync(developmentPath, { recursive: true });
  writeFileSync(
    join(developmentPath, "package.json"),
    JSON.stringify({ name: "empty", publisher: "test", version: "0.0.1", engines: { vscode: "*" } }),
  );
  testsPath = join(root, "out", "test", "vscode", "smoke.js");
}

const args = [
  project,
  `--extensionDevelopmentPath=${developmentPath}`,
  `--extensionTestsPath=${testsPath}`,
  `--user-data-dir=${userData}`,
  `--extensions-dir=${extensionsDir}`,
  ...(packaged ? [] : ["--disable-extensions"]),
  "--disable-workspace-trust",
  "--disable-telemetry",
  "--disable-updates",
  "--skip-welcome",
  "--skip-release-notes",
  "--new-window",
];
console.log("Starting VS Code with a separate test profile...");
const child = spawn(codeCli, args, { stdio: ["ignore", "pipe", "pipe"] });
const lines = [];
const show = (chunk) => {
  for (const line of chunk.toString().split("\n")) {
    if (/^(PASS|FAIL) |passed, \d+ failed|^Error|test\(s\) failed/.test(line.trim())) {
      console.log(line.trim());
    }
    lines.push(line);
  }
};
child.stdout.on("data", show);
child.stderr.on("data", show);
const timer = setTimeout(() => {
  console.error("Timed out after 4 minutes; stopping VS Code.");
  child.kill();
}, 240_000);
child.on("exit", (code) => {
  clearTimeout(timer);
  writeFileSync(join(base, "vscode-output.log"), lines.join("\n"));
  const resultsPath = join(base, "results.json");
  if (!existsSync(resultsPath)) {
    console.error(`No results were written. VS Code's output is in ${join(base, "vscode-output.log")}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
