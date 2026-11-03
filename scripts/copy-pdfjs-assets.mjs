// Copies pdf.js runtime assets (CJK cmaps, standard fonts, wasm decoders, ICC profiles) into public/.
// quickjs-eval.* runs JavaScript embedded in PDFs, which Zion PDF never does, so it stays out.
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const src = resolve(root, "node_modules/pdfjs-dist");
const dest = resolve(root, "public/pdfjs");

// Start clean, so files dropped from this list don't linger from earlier builds.
rmSync(dest, { recursive: true, force: true });
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  const from = resolve(src, dir);
  if (existsSync(from)) cpSync(from, resolve(dest, dir), { recursive: true, filter: (file) => !basename(file).startsWith("quickjs-eval") });
}
const pdfiumLicenses = resolve(root, "public/pdfium-licenses");
mkdirSync(pdfiumLicenses, { recursive: true });
for (const name of ["LICENSE", "LICENSE.pdfium"]) cpSync(resolve(root, "node_modules/@embedpdf/pdfium", name), resolve(pdfiumLicenses, name));
const ocr=resolve(root,"public/ocr");mkdirSync(ocr,{recursive:true});
cpSync(resolve(root,"node_modules/tesseract.js/dist/worker.min.js"),resolve(ocr,"worker.min.js"));
for(const name of readdirSync(resolve(root,"node_modules/tesseract.js-core")))if(/\.(wasm|js)$/.test(name)&&name.startsWith("tesseract-core"))cpSync(resolve(root,"node_modules/tesseract.js-core",name),resolve(ocr,name));
cpSync(resolve(root,"node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"),resolve(ocr,"eng.traineddata.gz"));
for(const pkg of ["tesseract.js","tesseract.js-core"])cpSync(resolve(root,"node_modules",pkg,pkg==="tesseract.js"?"LICENSE.md":"LICENSE"),resolve(ocr,`${pkg}-LICENSE`));
