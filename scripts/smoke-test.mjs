// End-to-end smoke test, run in CI on Windows, macOS, and Linux (and locally with `npm run smoke`):
// launches the built app in Electron, opens the sample document, and checks that pages render, text is
// selectable and highlightable, text boxes survive reopening, and the window chrome matches the platform.
// Run `npm run build` first.
import { _electron as electron } from "playwright-core";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const executablePath = require("electron"); // path to the Electron binary
const shots = path.join(root, "release", "smoke");
mkdirSync(shots, { recursive: true });

// The window stays hidden so a local run doesn't pop up over other work; ZIONPDF_SMOKE_SHOW=1 shows it.
const env = { ...process.env, ZIONPDF_TEST_USER_DATA: mkdtempSync(path.join(tmpdir(), "zionpdf-smoke-")),
  ZIONPDF_TEST_HIDDEN: process.env.ZIONPDF_SMOKE_SHOW === "1" ? "0" : "1" };
delete env.ELECTRON_RUN_AS_NODE;
// Containers often run as root, where Chromium's sandbox can't start.
const args = [root, ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])];

// The smallest .docx Word opens: one paragraph of `text`.
async function wordDocument(text) {
  const JSZip = require("jszip"); // comes with mammoth
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", `${xml}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
    + `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

const app = await electron.launch({ executablePath, args, env, timeout: 60_000 });
const failures = [];
try {
  const page = await app.firstWindow();
  const scope = page.locator(".document-panel:not([hidden])");
  page.on("pageerror", (e) => failures.push(e.stack || String(e)));
  await scope.getByRole("button", { name: "Create", exact:true }).waitFor({ timeout: 30_000 });
  assert.equal(await scope.getByRole("button",{name:/Try a sample/}).count(),0);
  const openSample=()=>app.evaluate(({BrowserWindow},data)=>BrowserWindow.getAllWindows()[0].webContents.send("zionpdf:open-file",{name:"Zion PDF sample.pdf",data:Buffer.from(data)}),Array.from(readFileSync(path.join(root,"public/sample.pdf"))));

  const platformClass = await page.evaluate(() => [...document.documentElement.classList].find((c) => c.startsWith("platform-")));
  assert.equal(platformClass, `platform-${process.platform}`);
  console.log("ok  platform:", platformClass);

  if (!process.env.ZIONPDF_SMOKE_EDITOR_ONLY) {
  await openSample();
  await scope.locator(".textLayer span:not(.markedContent)").first().waitFor({ timeout: 30_000 });
  assert.match(await scope.locator(".textLayer").first().innerText(), /A short tour of Zion PDF/);
  console.log("ok  sample rendered with a text layer");
  await scope.getByTitle(/Zoom in/).click();await scope.getByTitle(/Zoom in/).click();
  await page.evaluate(()=>{const root=document.querySelector('.document-panel:not([hidden])'),view=root.querySelector('.viewer-container'),sheet=root.querySelector('.page[data-page-number="1"]');const box=sheet.getBoundingClientRect(),parent=view.getBoundingClientRect();view.scrollTop+=box.top-parent.top+box.height*.35;});
  await page.waitForFunction(()=>{const root=document.querySelector('.document-panel:not([hidden])'),view=root.querySelector('.viewer-container'),sheet=root.querySelector('.page[data-page-number="1"] .canvasWrapper'),frame=root.querySelector('.thumb[data-page="1"] .thumb-frame'),marker=frame?.querySelector('.thumb-visible-area');if(!sheet||!frame||!marker)return false;const s=sheet.getBoundingClientRect(),v=view.getBoundingClientRect(),f=frame.getBoundingClientRect(),m=marker.getBoundingClientRect();const top=Math.max(0,(v.top+view.clientTop-s.top)/s.height),height=Math.max(0,(Math.min(s.bottom,v.top+view.clientTop+view.clientHeight)-Math.max(s.top,v.top+view.clientTop))/s.height);return height>0&&height<.95&&Math.abs((m.top-f.top)/f.height-top)<.025&&Math.abs(m.height/f.height-height)<.025;},null,{timeout:30000});
  await page.evaluate(()=>{const root=document.querySelector('.document-panel:not([hidden])'),view=root.querySelector('.viewer-container'),sheet=root.querySelector('.page[data-page-number="1"]');const box=sheet.getBoundingClientRect(),parent=view.getBoundingClientRect();view.scrollTop+=box.bottom-parent.top-view.clientHeight/2;});
  await page.waitForFunction(()=>{const root=document.querySelector('.document-panel:not([hidden])');return !!root.querySelector('.thumb[data-page="1"] .thumb-visible-area')&&!!root.querySelector('.thumb[data-page="2"] .thumb-visible-area');},null,{timeout:30000});
  await page.evaluate(()=>{document.querySelector('.document-panel:not([hidden]) .viewer-container').scrollTop=0;});
  await scope.getByRole("button",{name:"Page 1",exact:true}).click();
  await scope.getByTitle(/Zoom out/).click();await scope.getByTitle(/Zoom out/).click();
  console.log("ok  page thumbnails show the visible page regions while scrolling");
  await scope.getByRole("button",{name:"Page 2",exact:true}).click();
  await scope.locator('.page[data-page-number="2"] .textLayer span').first().waitFor({timeout:30000});
  await page.evaluate(()=>{const root=document.querySelector('.document-panel:not([hidden])'),view=root.querySelector('.viewer-container'),sheet=root.querySelector('.page[data-page-number="2"]');view.scrollTop+=sheet.getBoundingClientRect().top-view.getBoundingClientRect().top+sheet.clientHeight*.28;});
  const savedPosition=await page.evaluate(()=>{const root=document.querySelector('.document-panel:not([hidden])');return (root.querySelector('.viewer-container').getBoundingClientRect().top-root.querySelector('.page[data-page-number="2"]').getBoundingClientRect().top)/root.querySelector('.page[data-page-number="2"]').getBoundingClientRect().height;});
  await scope.getByTitle("Back to library").click();
  await scope.locator('.welcome.has-recents .recent-card').first().waitFor();
  assert.equal(await scope.locator('.welcome .hero').count(),0,"The recent library should not keep the introductory heading");
  assert.ok((await scope.locator('.welcome .dropzone').boundingBox()).height<60,"Open controls should be compact above recent documents");
  const libraryControl=await scope.locator('.welcome .dropzone').boundingBox(),libraryBar=await scope.locator('.topbar').boundingBox();
  assert.ok(libraryControl.y>=libraryBar.y+libraryBar.height,"Library controls should appear below both header rows");
  await page.screenshot({path:path.join(shots,`library-${process.platform}.png`)});
  await scope.locator('.recent-card').filter({hasText:"Zion PDF sample"}).click();
  await page.waitForFunction(expected=>{const root=document.querySelector('.document-panel:not([hidden])'),view=root.querySelector('.viewer-container'),sheet=root.querySelector('.page[data-page-number="2"]');if(!sheet||!sheet.clientHeight)return false;return Math.abs((view.getBoundingClientRect().top-sheet.getBoundingClientRect().top)/sheet.getBoundingClientRect().height-expected)<.025;},savedPosition,{timeout:30000});
  await scope.getByRole("button",{name:"Page 1",exact:true}).click();
  console.log("ok  compact library and recent-document reading position restored");
  const tabRow=await page.locator('.document-tabs').boundingBox(), toolRow=await scope.getByRole('toolbar',{name:'Tools',exact:true}).boundingBox();
  assert.ok(tabRow && toolRow && toolRow.y>=tabRow.y+tabRow.height-1,'Document controls should be on the second row');


  // Opening another document (here from the file manager) asks first when there's unsaved work, a placed signature,
  // and keeps it if the reader says no.
  const photo = await page.evaluate(() => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 600, height: 200 });
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 600, 200);
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(40, 150);
    g.bezierCurveTo(150, 10, 250, 190, 350, 60);
    g.lineTo(560, 120);
    g.stroke();
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await scope.getByTitle("Add a signature").click();
  await scope.locator('input[aria-label="Upload signature photo"]').setInputFiles({ name: "signature.png", mimeType: "image/png", buffer: Buffer.from(photo, "base64") });
  await scope.getByRole("button", { name: /Use this signature/ }).click();
  await scope.locator('select[aria-label="Signature placement"]').selectOption("manual");
  await scope.locator('[aria-label^="Place signature on page"]').click();
  await scope.getByRole("button", { name: /Approve and add signature/ }).click();
  await page.locator(".document-tab.on .dirty-dot").waitFor();

  // Printing saves nothing, so the signature stays marked as unsaved. The print frame is stubbed for the check, so no
  // system print dialog opens.
  await page.evaluate(() => {
    const frame = HTMLIFrameElement.prototype;
    const stub = { printed: 0, src: Object.getOwnPropertyDescriptor(frame, "src"), contentWindow: Object.getOwnPropertyDescriptor(frame, "contentWindow") };
    window.zionpdfPrintStub = stub;
    Object.defineProperty(frame, "src", { configurable: true, set(url) { this.dataset.src = url; } });
    Object.defineProperty(frame, "contentWindow", { configurable: true, get: () => ({ focus() {}, print() { stub.printed++; } }) });
  });
  await page.keyboard.press("ControlOrMeta+p");
  await page.waitForFunction(() => window.zionpdfPrintStub.printed === 1, null, { timeout: 15_000 });
  await page.evaluate(() => {
    Object.defineProperty(HTMLIFrameElement.prototype, "src", window.zionpdfPrintStub.src);
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", window.zionpdfPrintStub.contentWindow);
  });
  assert.ok(await page.locator(".document-tab.on .dirty-dot").isVisible(), "printing cleared the unsaved marker");
  console.log("ok  printing keeps unsaved work marked as unsaved");

  const sample = await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch("sample.pdf")).arrayBuffer())));
  const openFromFileManager = () => app.evaluate(({ BrowserWindow }, data) =>
    BrowserWindow.getAllWindows()[0].webContents.send("zionpdf:open-file", { name: "Another.pdf", data: Buffer.from(data) }), sample);
  await openFromFileManager();
  await page.waitForFunction(() => document.title.startsWith("Another.pdf"), null, {timeout:30000});
  await page.getByRole("tab", {name:"Zion PDF sample",exact:true}).click();
  assert.equal(await scope.locator(".stampEditor").count(),1);
  page.once("dialog",dialog=>void dialog.dismiss());
  await page.getByRole("button",{name:"Close Zion PDF sample.pdf",exact:true}).click();
  assert.equal(await page.getByRole("tab",{name:"Zion PDF sample",exact:true}).count(),1,'Canceling close should retain the unsaved tab');
  page.once("dialog",dialog=>void dialog.accept());
  await page.getByRole("button",{name:"Close Zion PDF sample.pdf",exact:true}).click();
  await page.getByRole("button",{name:"New tab",exact:true}).click();
  await scope.getByRole("button",{name:"Create",exact:true}).waitFor();
  await page.keyboard.press("ControlOrMeta+w");

  await page.getByRole("tab", {name:"Another",exact:true}).click();
  await scope.locator(".textLayer span:not(.markedContent)").first().waitFor({timeout:30000});
  console.log("ok  opening another document keeps unsaved work in its tab");

  // Select a sentence and highlight it in one click.
  await page.evaluate(() => {
    const span = [...document.querySelector('.document-panel:not([hidden])').querySelectorAll(".textLayer span:not(.markedContent)")].find((s) => s.textContent.includes("A short tour"));
    const range = document.createRange();
    range.selectNodeContents(span);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await scope.locator(".selection-popover").waitFor();

  // Copy puts the selection on the system clipboard (whose contents are put back afterwards). Clipboard writes
  // need a focused window, which a CI desktop doesn't always give the app. Only CI runs it: on someone's own
  // computer it would briefly replace what they've copied (and anything but plain text wouldn't come back).
  if (!process.env.CI) {
    console.log("--  clipboard check skipped: it only runs in CI, to leave your clipboard alone");
  } else if (await page.evaluate(() => document.hasFocus())) {
    const clipboardBefore = await app.evaluate(({ clipboard }) => clipboard.readText());
    await scope.locator(".selection-popover").getByRole("button", { name: "Copy" }).click();
    await scope.locator('.selection-popover button[title="Copied"]').waitFor({ timeout: 5_000 });
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboardBefore);
    assert.ok(/A short tour of Folio/.test(copied), "Copy didn't reach the clipboard");
    console.log("ok  selection copied to the clipboard");
  } else {
    console.log("--  clipboard check skipped: the window isn't focused");
  }

  await scope.getByRole("button", { name: "Highlight yellow" }).click();
  await page.waitForFunction(() => document.querySelector('.document-panel:not([hidden])').querySelectorAll(".highlightEditor").length === 1, null, { timeout: 15_000 });
  console.log("ok  highlight created");

  // A saved copy includes every saved mark, also on pages that haven't been drawn since the document was reopened.
  const lastPage = await scope.locator(".page").count();
  // A page's text can be selected before pdf.js has built its highlight layer: it first waits for the page's links
  // and form fields from its worker, which can take a while on a busy computer. Hold that reply back so this
  // highlight always lands in the gap.
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage;
    window.zionpdfPostMessage = post;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message?.action !== "GetAnnotations") return post.call(this, message, ...rest);
      setTimeout(() => post.call(this, message, ...rest), 2500);
    };
  });
  await page.evaluate((n) => document.querySelector('.document-panel:not([hidden])').querySelector(`.page[data-page-number="${n}"]`).scrollIntoView(), lastPage);
  await scope.locator(`.page[data-page-number="${lastPage}"] .textLayer span:not(.markedContent)`).first().evaluate((span) => {
    const range = document.createRange();
    range.selectNodeContents(span);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await scope.locator(".selection-popover").waitFor();
  await scope.getByRole("button", { name: "Highlight yellow" }).click();
  await page.waitForFunction(() => document.querySelector('.document-panel:not([hidden])').querySelectorAll(".highlightEditor").length === 2, null, { timeout: 15_000 });
  await page.evaluate(() => { Worker.prototype.postMessage = window.zionpdfPostMessage; });
  await page.evaluate(() => document.querySelector('.document-panel:not([hidden])').querySelector('.page[data-page-number="1"]').scrollIntoView());
  await page.waitForTimeout(800);
  await scope.getByTitle("Back to library").click();
  await openSample();
  await scope.locator(".textLayer span:not(.markedContent)").first().waitFor({ timeout: 30_000 });
  const copy = path.join(env.ZIONPDF_TEST_USER_DATA, "copy.pdf");
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog=async()=>({canceled:false,filePath:file}); },copy);
  await page.keyboard.press("ControlOrMeta+Shift+s");
  await scope.getByText("PDF copy saved",{exact:true}).waitFor();
  assert.ok(existsSync(copy));
  assert.equal(readFileSync(copy, "latin1").match(/\/Subtype\s*\/Highlight\b/g)?.length, 2);
  console.log("ok  saved copy includes marks on pages not drawn yet");

  // The More menu opens and closes.
  await scope.getByRole("button", { name: "More" }).click();
  await scope.getByRole("menuitem", { name: /About Zion PDF/ }).waitFor();
  await page.keyboard.press("Escape");

  // Settings links to the bundled changelog, and closing it returns to Settings.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Comma" : "Control+Comma");
  assert.equal(await scope.getByLabel("Signature suggestions").inputValue(), "on-demand");
  await scope.getByLabel("Signature suggestions").selectOption("off");
  assert.equal(await page.evaluate(() => localStorage.getItem("zionpdf:signature-suggestions")), "off");
  await scope.getByLabel("Signature suggestions").selectOption("on-demand");
  await scope.getByRole("switch", { name: "Show Draw in quick access" }).click();
  await scope.getByRole("button", { name: "Move Sign up" }).click();
  const preference = await page.evaluate(() => JSON.parse(localStorage.getItem("zionpdf:quick-access:v1")));
  assert.equal(preference.find(item => item.id === "ink").visible, false);
  assert.ok(preference.findIndex(item => item.id === "sign") < preference.findIndex(item => item.id === "freetext"));
  await scope.getByRole("button", { name: "View changelog" }).click();
  await scope.getByRole("dialog", { name: "What's new" }).locator("h3").first().waitFor();
  await page.keyboard.press("Escape");
  await scope.getByRole("dialog", { name: "Settings" }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await scope.locator('button[title^="Draw ("]').count(), 0);
  await scope.getByRole("button", { name: "More", exact: true }).click();
  await scope.getByRole("menuitem", { name: /Draw/ }).click();
  await scope.getByRole("button", { name: "Done", exact: true }).click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Comma" : "Control+Comma");
  await scope.getByRole("button", { name: "Restore defaults" }).click();
  await page.keyboard.press("Escape");
  assert.equal(await scope.locator('button[title^="Draw ("]').count(), 1);
  assert.equal(await scope.locator(".signature-suggestion").count(), 0);
  console.log("ok  quick access preferences and hidden tools");
  console.log("ok  changelog opens from Settings");

  // A text box is saved automatically and comes back, text and all, when the document is opened again.
  await scope.locator('button[title^="Text ("]').click();
  // Clicked in the middle of the page's visible part: a fixed spot near the top lands under the toolbar's color
  // picker in a small window, as on CI runners.
  await scope.locator('.page[data-page-number="1"] .annotationEditorLayer').click();
  // Filled in one go: pdf.js moves the caret while it focuses a new box, which can scramble key-by-key typing.
  await scope.locator('.freeTextEditor .internal[contenteditable="true"]').fill("Saved text box");
  await scope.getByRole("button", { name: "Done", exact: true }).click();
  await page.waitForTimeout(1000);
  await scope.getByTitle("Back to library").click();
  await openSample();
  await scope.locator(".freeTextEditor", { hasText: "Saved text box" }).waitFor({ timeout: 15_000 });
  console.log("ok  text box restored after reopening");

  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(shots, `smoke-${process.platform}.png`) });

  // A Word document opens converted to PDF (by Word, LibreOffice, or Zion PDF itself, whichever the computer has),
  // and the PDF is saved next to it. Opening the document again reuses that PDF.
  const folder = mkdtempSync(path.join(tmpdir(), "zionpdf-word-"));
  const docx = path.join(folder, "Quarterly report.docx");
  writeFileSync(docx, await wordDocument("Quarterly report from Word"));
  const openWordDocument = async () => {
    await scope.getByTitle("Back to library").click();
    const chooser = page.waitForEvent("filechooser");
    await scope.getByRole("button", { name: /Open a PDF/ }).click();
    await (await chooser).setFiles(docx);
    // Stops at a conversion error too, and shows what each converter said.
    const settled = await page.waitForFunction(() => document.title.startsWith("Quarterly report.pdf")
      || document.querySelector('.document-panel:not([hidden])').querySelector(".toast.error")?.textContent, null, { timeout: 150_000 }).catch((error) => error);
    if (settled instanceof Error || !(await page.title()).startsWith("Quarterly report.pdf")) {
      const log = path.join(env.ZIONPDF_TEST_USER_DATA, "convert.log");
      console.log(await scope.locator(".toast").textContent().catch(() => "(no message)"));
      console.log(existsSync(log) ? readFileSync(log, "utf8") : "(no convert.log)");
      throw settled instanceof Error ? settled : new Error("the Word document didn't convert");
    }
    await scope.locator(".textLayer span:not(.markedContent)").first().waitFor({ timeout: 30_000 });
    assert.match(await scope.locator(".textLayer").first().innerText(), /Quarterly report from Word/);
  };
  await openWordDocument();
  assert.ok(existsSync(path.join(folder, "Quarterly report.pdf")), "the converted PDF wasn't saved next to the document");
  await openWordDocument();
  assert.deepEqual(readdirSync(folder).sort(), ["Quarterly report.docx", "Quarterly report.pdf"]);
  console.log("ok  Word document converted to PDF, saved next to it, and reused");
  }

  // Exercise the bundled PDFium worker, actual content replacement, and the saved PDF in the viewer.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.session.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: /^https?:/i.test(details.url) });
    });
  });
  const stream = "160 30 80 40 re S 200 50 m 220 50 l S BT /F1 16 Tf 40 100 Td (B) Tj (e) Tj (f) Tj (o) Tj (r) Tj (e) Tj ET";
  const stream2 = "BT /F1 16 Tf 40 100 Td (Second) Tj ET q 30 0 0 30 180 100 cm /Im1 Do Q";
  const pdfObjects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [9 0 R 10 0 R] >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /CropBox [20 30 280 180] /Rotate 90 /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 8 0 R >> >> /Contents 7 0 R >>",
    `<< /Length ${stream2.length} >>\nstream\n${stream2}\nendstream`,
    "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 7 >>\nstream\nFF0000>\nendstream",
    "<< /Type /Annot /Subtype /Text /Rect [10 10 30 30] /Contents (Keep this note) >>",
    "<< /Type /Annot /Subtype /Link /Rect [120 10 170 30] /A << /S /URI /URI (https://example.com/) >> >>"];
  let fixture = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, object] of pdfObjects.entries()) { offsets.push(fixture.length); fixture += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = fixture.length;
  fixture += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) fixture += `${String(offset).padStart(10, "0")} 00000 n \n`;
  fixture += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await app.evaluate(({ BrowserWindow }, data) => BrowserWindow.getAllWindows()[0].webContents.send("zionpdf:open-file", { name: "edit-test.pdf", data: Buffer.from(data) }), Array.from(Buffer.from(fixture)));
  await page.waitForFunction(() => document.title.startsWith("edit-test.pdf"));
  await scope.getByRole("button", { name: "More", exact: true }).click();
  await scope.getByRole("menuitem", { name: "Edit PDF", exact: true }).click();
  const editor = scope.getByRole("toolbar", { name: "PDF editor" });
  await scope.locator('.inline-pdf-target[title="Before"]').waitFor({ timeout: 30_000 });
  const drawingPaths=scope.locator('.inline-graphic-target');
  assert.equal(await drawingPaths.count(),2,"Both drawing pieces should be detected");
  const point=async (item,x,y)=>item.evaluate((el,xy)=>{const p=new DOMPoint(xy[0],xy[1]).matrixTransform(el.getScreenCTM());return {x:p.x,y:p.y};},[x,y]);
  const edgePoint=await point(drawingPaths.nth(0),180,30),handPoint=await point(drawingPaths.nth(1),210,50);
  await page.mouse.click(edgePoint.x,edgePoint.y);await page.keyboard.down("Shift");await page.mouse.click(handPoint.x,handPoint.y);await page.keyboard.up("Shift");
  await editor.getByText("2 selected",{exact:true}).waitFor();
  await page.mouse.move(handPoint.x,handPoint.y);await page.mouse.down();await page.mouse.move(handPoint.x+20,handPoint.y+12,{steps:4});await page.mouse.up();
  await page.waitForFunction(()=>{const path=document.querySelector('.document-panel:not([hidden]) .inline-graphic-target');return path && path.getBBox().x>170;},null,{timeout:30000});
  await editor.getByRole("button",{name:"Undo",exact:true}).click();
  await page.waitForFunction(()=>{const path=document.querySelector('.document-panel:not([hidden]) .inline-graphic-target');return path && Math.abs(path.getBBox().x-160)<.2;},null,{timeout:30000});
  assert.equal(await scope.getByRole("button",{name:"Rotate page 1",exact:true}).count(),1);
  assert.equal(await scope.getByRole("button",{name:"Rotate page 2",exact:true}).count(),0,"Only the selected page should show actions");
  const panelBounds = await editor.boundingBox();
  const stageBounds = await scope.locator('main.stage').boundingBox();
  assert.ok(panelBounds && stageBounds && panelBounds.x >= stageBounds.x + stageBounds.width - 1, "Editor controls should be beside the page");
  await scope.getByTitle("Next page").click();
  await scope.locator('.inline-pdf-target[title="Second"]').waitFor();
  await scope.getByRole("button",{name:"Rotate page 2",exact:true}).waitFor();
  assert.equal(await scope.getByRole("button",{name:"Rotate page 1",exact:true}).count(),0);
  await scope.getByTitle("Previous page").click();
  await scope.locator('.inline-pdf-target[title="Before"]').click();
  assert.equal(await scope.getByLabel("Edit PDF text on page").evaluate(input => !!input.closest('.inline-pdf-overlay-root') && !input.closest('.inline-editor-panel')), true);
  assert.ok(Number(await editor.getByLabel("Font size").inputValue()) > 0, "Font size should be detected when text is selected");
  await scope.locator('.pdf-text-caret').waitFor({timeout:30000});
  const textInput=scope.getByLabel("Edit PDF text on page");
  await textInput.press("Home");
  const startCaret=await scope.locator('.pdf-text-caret').boundingBox();
  await textInput.press("ArrowRight");
  await page.waitForFunction(x=>document.querySelector('.document-panel:not([hidden]) .pdf-text-caret')?.getBoundingClientRect().left>x+2,startCaret.x);
  const afterB=await scope.locator('.pdf-text-caret').boundingBox();
  await page.mouse.click(afterB.x+1,afterB.y+afterB.height/2);
  assert.equal(await textInput.evaluate(el=>el.selectionStart),1,"Clicking the glyph boundary should select its character offset");
  await textInput.press("Backspace");
  assert.equal(await textInput.inputValue(),"efore","Backspace should remove the character immediately before the visible caret");
  await textInput.fill("Before");

  await scope.getByLabel("Edit PDF text on page").fill("Hi");
  await editor.locator(".inline-editor-title").click();
  await scope.locator('.inline-pdf-target[title="Hi"]').waitFor();
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await scope.locator('.inline-pdf-target[title="Before"]').click();
  await scope.getByLabel("Edit PDF text on page").fill("Hi");
  await editor.getByRole("combobox",{name:"Text font"}).click();
  const fontOptions=editor.getByRole("listbox",{name:"Text font options"});
  const localFontCount=await fontOptions.getByRole("option").count();
  console.log(localFontCount > 1 ? `ok  discovered ${localFontCount} font families` : "--  device-font discovery unavailable in this environment");
  await page.screenshot({path:path.join(shots,`font-menu-${process.platform}.png`)});
  const arial=fontOptions.getByRole("option",{name:"Arial",exact:true});
  const hasArial=await arial.count();
  if (hasArial) {
    assert.match(await arial.getAttribute("style"),/Arial/i);
    await arial.click();
    await editor.getByRole("button",{name:"Bold",exact:true}).click();
    assert.equal(await editor.getByRole("button",{name:"Bold",exact:true}).getAttribute("aria-pressed"),"true");
    await editor.getByRole("combobox",{name:"Font style"}).click();
    const italicOption=editor.getByRole("option",{name:/^Bold Italic$/i});
    if(await italicOption.count()){const style=await italicOption.evaluate(el=>({weight:getComputedStyle(el).fontWeight,style:getComputedStyle(el).fontStyle}));assert.equal(style.weight,"700");assert.equal(style.style,"italic");}
    await page.keyboard.press("Escape");
    await editor.getByRole("button",{name:"Bold",exact:true}).click();
    assert.match(await editor.getByRole("combobox",{name:"Font style"}).innerText(),/Regular|Normal|Book/i);
    await editor.getByRole("button",{name:"Bold",exact:true}).click();
    await editor.locator(".inline-editor-title").click();
    await scope.locator('.inline-pdf-target[title="Hi"]').waitFor({ timeout: 30_000 });
    await editor.getByRole("button", { name: "Undo", exact: true }).click();
    await scope.locator('.inline-pdf-target[title="Before"]').click();
    await scope.getByLabel("Edit PDF text on page").fill("Hi");
    console.log("ok  edited with an installed Arial font");
  }
  else await editor.getByRole("combobox",{name:"Text font"}).click();
  await editor.getByLabel("Choose a font file").setInputFiles(path.join(root,"node_modules/katex/dist/fonts/KaTeX_Main-Regular.ttf"));
  await editor.getByLabel("Font size").fill("12");
  await editor.getByLabel("Text color", { exact: true }).fill("#d02030");
  await page.screenshot({ path: path.join(shots, `edit-text-${process.platform}.png`) });
  const outputDirectory = mkdtempSync(path.join(tmpdir(), "zionpdf-edited-"));
  const outputFile = path.join(outputDirectory, "edited.pdf");
  writeFileSync(outputFile, "previous file");
  await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
  await editor.locator(".inline-editor-title").click();
  await page.waitForFunction(() => [...document.querySelector('.document-panel:not([hidden])').querySelectorAll('button')].some(b => b.getAttribute('aria-label') === 'Undo' && !b.disabled), null, { timeout: 30_000 });
  await app.evaluate(({ BrowserWindow }, data) => BrowserWindow.getAllWindows()[0].webContents.send("zionpdf:open-file", { name: "other.pdf", data: Buffer.from(data) }), Array.from(Buffer.from(fixture)));
  await page.waitForFunction(() => document.title.startsWith("other.pdf"));
  await page.getByRole("tab",{name:"edit-test",exact:true}).click();
  assert.ok((await page.title()).startsWith("edit-test.pdf"), "switching tabs lost the editor session");
  await page.keyboard.press("ControlOrMeta+z");
  await scope.locator('.inline-pdf-target[title="Before"]').waitFor();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await scope.locator('.inline-pdf-target[title="Hi"]').waitFor();
  await scope.getByTitle("Next page").click();
  await scope.locator('.inline-pdf-target[title="Second"]').click();
  await scope.getByLabel("Edit PDF text on page").fill("Sec");
  await editor.locator(".inline-editor-title").click();
  await scope.locator('.inline-pdf-target[title="Sec"]').waitFor();

  const imageTarget = scope.locator('.inline-image-target').first();
  await imageTarget.waitFor();
  const imageBox = await imageTarget.boundingBox();
  await page.mouse.move(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(imageBox.x + imageBox.width / 2 + 20, imageBox.y + imageBox.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(x => { const item = document.querySelector('.document-panel:not([hidden])').querySelector('.inline-image-target'); return item && item.getBoundingClientRect().x > x + 10; }, imageBox.x, { timeout: 30_000 });
  await imageTarget.click();
  await editor.getByLabel("Replace image").setInputFiles(path.join(root, "scripts", "fixtures", "red.jpg"));
  await page.waitForFunction(()=>!document.querySelector('.document-panel:not([hidden]) .inline-editor-panel [role="status"]'));
  await imageTarget.click();
  await editor.getByRole("button", { name: "Duplicate", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.document-panel:not([hidden])').querySelectorAll('.inline-image-target').length === 2, null, { timeout: 30_000 });
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.document-panel:not([hidden])').querySelectorAll('.inline-image-target').length === 1, null, { timeout: 30_000 });
  await imageTarget.click();
  await editor.getByRole("button", { name: "Rotate", exact: true }).click();
  await page.waitForFunction(()=>!document.querySelector('.document-panel:not([hidden]) .inline-editor-panel [role="status"]'));
  await imageTarget.click();
  const handle = scope.getByLabel("Resize image se", { exact: true });
  const handleBox = await handle.boundingBox();
  await page.mouse.move(handleBox.x+handleBox.width/2,handleBox.y+handleBox.height/2);
  await page.mouse.down(); await page.mouse.move(handleBox.x+handleBox.width/2+14,handleBox.y+handleBox.height/2+14,{steps:4}); await page.mouse.up();
  await page.waitForFunction(()=>!document.querySelector('.document-panel:not([hidden]) .inline-editor-panel [role="status"]'));
  await imageTarget.click();
  await scope.getByRole("button", { name: "Delete selected image" }).click();
  await page.waitForFunction(() => !document.querySelector('.document-panel:not([hidden])').querySelector('.inline-image-target') && !document.querySelector('.document-panel:not([hidden])').querySelector('.inline-editor-panel [role="status"]'), null, { timeout: 30_000 });
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await imageTarget.waitFor();
  await editor.getByRole("button", { name: "Redo", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.document-panel:not([hidden])').querySelector('.inline-image-target') && !document.querySelector('.document-panel:not([hidden])').querySelector('.inline-editor-panel [role="status"]'), null, { timeout: 30_000 });
  await editor.getByRole("button", { name: "Save copy" }).click();
  await editor.getByRole("button", { name: "Save copy" }).waitFor();
  assert.ok(await editor.isVisible(), "canceling Save As closed the editing session");
  assert.equal(readFileSync(outputFile, "utf8"), "previous file");
  await app.evaluate(({ dialog }, directory) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: directory }); }, outputDirectory);
  await editor.getByRole("button", { name: "Save copy" }).click();
  await editor.getByRole("alert").waitFor({ timeout: 30_000 });
  assert.ok(existsSync(outputDirectory), "a failed save damaged the existing destination");
  assert.deepEqual(readdirSync(outputDirectory), ["edited.pdf"], "a failed save left temporary files behind");
  assert.equal(readFileSync(outputFile, "utf8"), "previous file", "a failed save changed the existing file");
  await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, outputFile);
  await editor.getByRole("button", { name: "Save copy" }).click();
  await editor.waitFor({ state: "hidden", timeout: 30_000 });
  assert.ok(existsSync(outputFile), "the edited copy was not written");
  const editedBytes = Array.from(readFileSync(outputFile));
  const changedOutsideText = await page.evaluate(async ({ before, after }) => {
    const render = async data => {
      const task = globalThis.pdfjsLib.getDocument({ data: new Uint8Array(data) });
      const doc = await task.promise, pdfPage = await doc.getPage(1), viewport = pdfPage.getViewport({ scale: 1 });
      const canvas = document.createElement("canvas"); canvas.width = viewport.width; canvas.height = viewport.height;
      await pdfPage.render({ canvas, viewport }).promise;
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      const annotations = await pdfPage.getAnnotations();
      const notePreserved = annotations.some(item => item.contentsObj?.str === "Keep this note");
      const linkPreserved = annotations.some(item => item.url === "https://example.com/");
      await task.destroy();
      return { pixels, width: canvas.width, height: canvas.height, notePreserved, linkPreserved };
    };
    const original = await render(before), modified = await render(after);
    let differences = 0;
    for (let y = 0; y < original.height; y++) for (let x = 0; x < original.width; x++) {
      if (x >= 30 && x <= 110 && y >= 65 && y <= 115) continue;
      const i = (y * original.width + x) * 4;
      if (original.pixels[i] !== modified.pixels[i] || original.pixels[i + 1] !== modified.pixels[i + 1]
        || original.pixels[i + 2] !== modified.pixels[i + 2] || original.pixels[i + 3] !== modified.pixels[i + 3]) differences++;
    }
    return { differences, notePreserved: modified.notePreserved, linkPreserved: modified.linkPreserved };
  }, { before: Array.from(Buffer.from(fixture)), after: editedBytes });
  assert.equal(changedOutsideText.differences, 0, "content outside the edited text region changed");
  assert.ok(changedOutsideText.notePreserved, "an existing PDF annotation was lost");
  assert.ok(changedOutsideText.linkPreserved, "an existing PDF link was lost");
  await app.evaluate(({ BrowserWindow }, data) => BrowserWindow.getAllWindows()[0].webContents.send("zionpdf:open-file", { name: "edited.pdf", data: Buffer.from(data) }), editedBytes);
  await page.waitForFunction(() => document.title.startsWith("edited.pdf"));
  await page.waitForFunction(() => document.querySelector('.document-panel:not([hidden])').querySelector(".textLayer")?.textContent?.includes("Hi"));
  await scope.getByTitle("Next page").click();
  await page.waitForFunction(() => document.querySelector('.document-panel:not([hidden])').querySelector('.page[data-page-number="2"] .textLayer')?.textContent?.includes("Sec"));
  const secondPageText = await scope.locator('.page[data-page-number="2"] .textLayer').innerText();
  assert.doesNotMatch(secondPageText, /Second/);
  await scope.getByTitle("Edit PDF", { exact: true }).click();
  const reopenedEditor = scope.getByRole("toolbar", { name: "PDF editor" });
  await scope.locator('.inline-pdf-target').first().waitFor();
  assert.equal(await scope.locator('.inline-image-target').count(), 0, "deleted image returned after reopening");
  await reopenedEditor.getByRole("button", { name: "Done" }).click();
  const sampleBytes = Array.from(readFileSync(path.join(root, "scripts", "fixtures", "editing-sample.pdf")));
  await app.evaluate(({ BrowserWindow }, data) => BrowserWindow.getAllWindows()[0].webContents.send("zionpdf:open-file", { name: "inline-sample.pdf", data: Buffer.from(data) }), sampleBytes);
  await page.waitForFunction(() => document.title.startsWith("inline-sample.pdf"));
  await scope.getByTitle("Edit PDF", { exact: true }).click();
  const sampleEditor = scope.getByRole("toolbar", { name: "PDF editor" });
  await sampleEditor.getByLabel("Text selection size").selectOption("word");
  const tagged = scope.locator('.inline-pdf-target[title="short "]').first();
  await tagged.waitFor({ timeout: 30_000 });
  const initialBounds = await tagged.boundingBox();
  await scope.getByTitle(/Zoom in/).click();
  await page.waitForFunction(({ width }) => { const item = document.querySelector('.document-panel:not([hidden])').querySelector('.inline-pdf-target[title="short "]'); return item && item.getBoundingClientRect().width > width * 1.04; }, { width: initialBounds.width }, { timeout: 30_000 });
  await tagged.click();
  await scope.getByLabel("Edit PDF text on page").waitFor();
  await page.screenshot({ path: path.join(shots, `inline-sample-${process.platform}.png`) });
  await sampleEditor.getByRole("button", { name: "Cancel text" }).click();
  await sampleEditor.getByLabel("Text selection size").selectOption("line");
  await scope.locator('.inline-pdf-target[title^="A short tour of Folio"]').first().click();
  const lineInput = scope.getByLabel("Edit PDF text on page");
  const originalLine = await lineInput.inputValue();
  await scope.locator('.pdf-text-caret').waitFor({timeout:30000});
  await lineInput.press("Home");for(let i=0;i<5;i++)await lineInput.press("Shift+ArrowRight");
  await sampleEditor.getByRole("combobox",{name:"Text font"}).click();
  await sampleEditor.getByLabel("Search text font").fill("Arial");
  await sampleEditor.getByRole("option",{name:"Arial",exact:true}).click();
  await sampleEditor.getByRole("button",{name:"Bold",exact:true}).click();
  assert.equal(await sampleEditor.getByRole("button",{name:"Bold",exact:true}).getAttribute("aria-pressed"),"true");
  await sampleEditor.getByLabel("Font size",{exact:true}).fill("18");
  await sampleEditor.getByLabel("Text color",{exact:true}).fill("#ff0000");
  assert.ok(await scope.locator('.pdf-text-selection').count()>0,"Selection should remain visible when the formatting panel has focus");
  assert.equal(await lineInput.evaluate(el=>el.selectionEnd-el.selectionStart),5);
  await lineInput.fill(originalLine.replace("short", "brief"));
  await sampleEditor.locator(".inline-editor-title").click();
  await scope.locator('.inline-pdf-target[title^="A brief tour of Folio"]').first().waitFor({ timeout: 30_000 });
  await sampleEditor.getByRole("button", { name: "Undo", exact: true }).click();
  await scope.locator('.inline-pdf-target[title^="A short tour of Folio"]').first().waitFor({ timeout: 30_000 });
  console.log("ok  editor text/image interaction checks");
  const beforeRotate = await scope.locator('.page[data-page-number="1"]').boundingBox();
  await scope.getByRole("button", {name:"Rotate page 1", exact:true}).click();
  await page.waitForFunction(() => { const box = document.querySelector('.document-panel:not([hidden])').querySelector('.page[data-page-number="1"]')?.getBoundingClientRect(); return box && box.width > box.height; }, null, {timeout:30000});
  await scope.locator('.inline-pdf-target[title^="A short tour of Folio"]').first().click();
  await scope.locator('.pdf-text-caret').waitFor({timeout:30000});
  const rotatedCaret=await scope.locator('.pdf-text-caret').boundingBox();
  assert.ok(rotatedCaret.width>rotatedCaret.height,"The caret should rotate with the PDF page");
  await sampleEditor.getByRole("button",{name:"Cancel text"}).click();
  await sampleEditor.getByRole("button", {name:"Undo",exact:true}).click();
  await page.waitForFunction(() => { const box = document.querySelector('.document-panel:not([hidden])').querySelector('.page[data-page-number="1"]')?.getBoundingClientRect(); return box && box.width < box.height; }, null, {timeout:30000});
  console.log("ok  page rotation and undo");
  await scope.locator('.thumb-cell').first().dragTo(scope.locator('.thumb-cell').nth(1));
  await page.waitForFunction(() => document.querySelector('.document-panel:not([hidden])').querySelector('.page[data-page-number="2"] .textLayer')?.textContent?.includes('A short tour'),null,{timeout:30000});
  await sampleEditor.getByRole("button", {name:"Undo",exact:true}).click();
  console.log("ok  page drag reorder and undo");
  await scope.getByRole("button",{name:"Page 1",exact:true}).click();
  await scope.getByRole("button", {name:"Flip page 1",exact:true}).click();
  await sampleEditor.getByRole("button", {name:"Undo",exact:true}).waitFor({state:"visible"});
  await scope.locator('.inline-pdf-target').first().waitFor();
  await sampleEditor.getByRole("button", {name:"Undo",exact:true}).click();
  page.once("dialog", dialog => void dialog.accept());
  await scope.getByRole("button",{name:"Page 4",exact:true}).click();
  await scope.getByRole("button", {name:"Delete page 4",exact:true}).click();
  await scope.getByText("of 3",{exact:true}).waitFor({timeout:30000});
  await sampleEditor.getByRole("button", {name:"Undo",exact:true}).click();
  await scope.getByText("of 4",{exact:true}).waitFor({timeout:30000});
  await page.screenshot({path:path.join(shots,`editor-pages-${process.platform}.png`)});
  await sampleEditor.getByRole("button",{name:"Add text",exact:true}).click();
  await scope.getByRole("button",{name:"Place new content on page",exact:true}).click({position:{x:100,y:100}});
  await scope.locator('.inline-pdf-target[title="New text"]').waitFor({timeout:30000});
  await scope.locator('.inline-pdf-target[title="New text"]').click();
  await scope.locator('.inline-text-preview').waitFor({timeout:30000});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.document-panel:not([hidden]) .inline-pdf-input')).fontFamily.includes('ZionPdfText_'),null,{timeout:30000});
  const typingInput=scope.getByLabel("Edit PDF text on page");
  await typingInput.focus();await typingInput.press("End");await typingInput.pressSequentially("X");
  assert.equal(await typingInput.inputValue(),"New textX");
  await sampleEditor.getByRole("button",{name:"Undo",exact:true}).click();
  assert.equal(await typingInput.inputValue(),"New text","Undo should restore the text being typed");
  await sampleEditor.getByRole("button",{name:"Redo",exact:true}).click();
  assert.equal(await typingInput.inputValue(),"New textX","Redo should restore the typed character");
  await sampleEditor.getByRole("button",{name:"Undo",exact:true}).click();
  const textFontSize=Number(await sampleEditor.getByLabel("Font size").inputValue());
  const cellBefore=await scope.locator('.inline-text-cell').boundingBox();
  assert.equal(await scope.getByRole("button",{name:"Move text cell",exact:true}).count(),0,"Move controls should be hidden while typing");
  await scope.getByRole("button",{name:"Select text cell top border",exact:true}).click();
  const scrollBeforeMove=await scope.locator('.viewer-container').evaluate(el=>el.scrollTop);
  const moveHandle=await scope.getByRole("button",{name:"Move text cell",exact:true}).boundingBox();
  await page.mouse.move(moveHandle.x+moveHandle.width/2,moveHandle.y+moveHandle.height/2);await page.mouse.down();
  await page.mouse.move(moveHandle.x+moveHandle.width/2+40,moveHandle.y+moveHandle.height/2+25,{steps:5});await page.mouse.up();
  await page.waitForFunction(left=>document.querySelector('.document-panel:not([hidden]) .inline-text-cell')?.getBoundingClientRect().left>left+25,cellBefore.x,{timeout:30000});
  await page.waitForTimeout(2000);
  assert.ok(Math.abs((await scope.locator('.viewer-container').evaluate(el=>el.scrollTop))-scrollBeforeMove)<3,"Moving a text cell should not jump the page");
  await scope.getByLabel("Edit PDF text on page").fill("New text New text New text");
  assert.equal(await scope.getByRole("button",{name:"Move text cell",exact:true}).count(),0,"Typing should hide the move controls");
  // The native preview can extend the cell's height after typing. Measure drag coordinates after it settles.
  await page.waitForFunction(()=>!document.querySelector('.document-panel:not([hidden]) [data-live-text]'));
  await scope.getByRole("button",{name:"Select text cell top border",exact:true}).click();
  const cellMoved=await scope.locator('.inline-text-cell').boundingBox(),edge=await scope.getByRole("button",{name:"Resize text cell e",exact:true}).boundingBox();
  await page.mouse.move(edge.x+edge.width/2,edge.y+edge.height/2);await page.mouse.down();await page.mouse.move(edge.x+edge.width/2+90,edge.y+edge.height/2,{steps:5});await page.mouse.up();
  await scope.getByLabel("Edit PDF text on page").waitFor({timeout:30000});
  assert.ok((await scope.locator('.inline-text-cell').boundingBox()).width>cellMoved.width+50);
  assert.equal(Number(await sampleEditor.getByLabel("Font size").inputValue()),textFontSize,"Resizing should preserve font size");
  await sampleEditor.getByRole("button",{name:"Send to back",exact:true}).click();
  await scope.getByLabel("Edit PDF text on page").waitFor({timeout:30000});
  assert.equal(await scope.getByLabel("Edit PDF text on page").inputValue(),"New text New text New text","Ordering should retain the text selection");
  await page.screenshot({path:path.join(shots,`text-cell-${process.platform}.png`)});
  for(let i=0;i<3;i++)await sampleEditor.getByRole("button",{name:"Undo",exact:true}).click();

  await sampleEditor.getByRole("button",{name:"Undo",exact:true}).click();
  await scope.locator('.inline-pdf-target[title="New text"]').waitFor({state:"hidden"});
  const imagesBefore=await scope.locator('.inline-image-target').count();
  await app.evaluate(({dialog}, file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path.join(root,"scripts","fixtures","red.jpg"));
  await sampleEditor.getByRole("button",{name:"Add image",exact:true}).click();
  await scope.getByRole("button",{name:"Place new content on page",exact:true}).click({position:{x:130,y:130}});
  await page.waitForFunction(count=>document.querySelector('.document-panel:not([hidden])').querySelectorAll('.inline-image-target').length===count+1,imagesBefore,{timeout:30000});
  await sampleEditor.getByRole("button",{name:"Undo",exact:true}).click();
  await page.waitForFunction(count=>document.querySelector('.document-panel:not([hidden])').querySelectorAll('.inline-image-target').length===count,imagesBefore,{timeout:30000});

  await sampleEditor.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button",{name:"Close inline-sample.pdf",exact:true}).click();
  assert.equal(await page.getByRole("tab",{name:"inline-sample",exact:true}).count(),0);
  console.log("ok  inline text and image edits, device font, undo/redo, and saved-copy reopening");

  assert.deepEqual(failures, []);
  console.log(`PASS (${process.platform})`);
} catch (error) {
  const failedPage = await app.firstWindow();
  await failedPage.screenshot({path:path.join(shots,`failure-${process.platform}.png`)}).catch(() => {});
  console.error("Editor alerts:", await failedPage.getByRole("alert").allTextContents().catch(() => []));
  console.error("Smoke test failed:", error);
  throw error;
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
  await app.close();
}
