// Local feasibility probe: inspect text objects without altering the original document.
import { readFile } from "node:fs/promises";
import { init } from "@embedpdf/pdfium";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import assert from "node:assert/strict";
import { insertContent, reorderObjects, editPage, inspectParagraphs, inspectTextGroups, inspectTextObjects, replaceTextObject, inspectImageObjects, inspectNestedContent, editImageObject, inspectGraphicObjects, moveGraphicObjects } from "../src/editor/pdfium.ts";
import { embeddingRights } from "../src/editor/fonts.ts";

const wasmBinary = await readFile(new URL("../node_modules/@embedpdf/pdfium/dist/pdfium.wasm", import.meta.url));
const bytes = await readFile(new URL("./fixtures/editing-sample.pdf", import.meta.url));
const api = await init({ wasmBinary });
api.PDFiumExt_Init();
const module = api.pdfium;
const sampleGroups = inspectTextGroups(api, bytes, 0);
console.log(`PDFium grouped the sample into ${sampleGroups.length} text items, including ${sampleGroups.filter(item => item.members.length > 1).length} multi-object words`);
if (process.env.ZIONPDF_PROBE_DETAIL) console.log("sample lines", inspectTextGroups(api, bytes, 0, true).slice(0, 6).map(item => item.text));
const input = module.wasmExports.malloc(bytes.length);
module.HEAPU8.set(bytes, input);
const doc = api.FPDF_LoadMemDocument64(input, bytes.length, "");
if (!doc) throw new Error("Could not open sample PDF");
try {
  const page = api.FPDF_LoadPage(doc, 0);
  const textPage = api.FPDFText_LoadPage(page);
  try {
    const count = api.FPDFPage_CountObjects(page);
    if (process.env.ZIONPDF_PROBE_DETAIL) {
      const temp = module.wasmExports.malloc(64);
      for (let i = 0; i < Math.min(count, 25); i++) {
        const object = api.FPDFPage_GetObject(page, i);
        if (api.FPDFPageObj_GetType(object) !== 1) continue;
        const n = api.FPDFTextObj_GetText(object, textPage, temp, 20);
        const t = n <= 20 ? module.UTF16ToString(temp) : "long";
        api.FPDFPageObj_GetMatrix(object, temp); api.FPDFTextObj_GetFontSize(object, temp + 24);
        const mark = api.FPDFPageObj_GetMark(object, 0);
        console.log(i, t, api.FPDFTextObj_GetFont(object), Array.from({ length: 6 }, (_, j) => +module.getValue(temp + j * 4, "float").toFixed(2)), module.getValue(temp + 24, "float"), api.FPDFPageObj_CountMarks(object), api.FPDFPageObj_GetMarkedContentID(object), mark ? api.FPDFPageObjMark_CountParams(mark) : 0);
      }
      module.wasmExports.free(temp);
    }
    let textObjects = 0;
    for (let i = 0; i < count; i++) {
      const object = api.FPDFPage_GetObject(page, i);
      if (api.FPDFPageObj_GetType(object) !== 1) continue;
      const length = api.FPDFTextObj_GetText(object, textPage, 0, 0);
      if (length > 2) textObjects++;
    }
    if (!textObjects) throw new Error("No editable text objects found");
    console.log(`PDFium loaded the sample: ${count} page objects, ${textObjects} text objects`);
  } finally {
    api.FPDFText_ClosePage(textPage);
    api.FPDF_ClosePage(page);
  }
} finally {
  api.FPDF_CloseDocument(doc);
  module.wasmExports.free(input);
}

// A minimal PDF with a complete standard font makes the replacement and round trip reproducible.
function makePdf(stream) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [6 0 R] >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  "<< /Type /Annot /Subtype /Text /Rect [10 10 30 30] /Contents (Keep this note) >>"];
  let file = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) { offsets.push(file.length); file += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = file.length;
  file += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) file += `${String(offset).padStart(10, "0")} 00000 n \n`;
  file += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(file, "ascii");
}
const fixture = makePdf("BT /F1 16 Tf 40 100 Td (Before) Tj ET");
const layoutFixture=makePdf("BT /F1 12 Tf 40 160 Td (First paragraph line) Tj ET 260 10 5 5 re S BT /F1 12 Tf 40 144 Td (Second paragraph line) Tj ET BT /F1 12 Tf 220 144 Td (Other column) Tj ET BT /F1 12 Tf 40 100 Td (New paragraph) Tj ET");
const layoutBlocks=inspectParagraphs(api,layoutFixture,0);
assert.ok(layoutBlocks.some(item=>item.text.trimEnd()==="First paragraph line\nSecond paragraph line"),"Interleaved drawing objects should not split a paragraph");
assert.ok(layoutBlocks.some(item=>item.text.trimEnd()==="Other column"),"A neighboring column should remain separate");
assert.ok(layoutBlocks.some(item=>item.text.trimEnd()==="New paragraph"),"A paragraph gap should keep separate sections");
const ruledFixture=makePdf("BT /F1 12 Tf 40 160 Td (First row) Tj ET 35 155 m 180 155 l S BT /F1 12 Tf 40 144 Td (Second row) Tj ET");
assert.equal(inspectParagraphs(api,ruledFixture,0).length,2,"A table rule should separate rows");
console.log("Paragraphs follow geometry without crossing columns, section gaps or table rules");
const drawingFixture=makePdf("20 20 80 80 re S 60 60 m 60 90 l S 60 60 m 80 60 l S BT /F1 16 Tf 150 100 Td (Before) Tj ET");
const parts=inspectGraphicObjects(api,drawingFixture,0);
assert.equal(parts.length,3,"Clock face and two hands should be selectable paths");
assert.ok(parts.every(part=>part.path),"Path geometry should be available for hit testing");
const movedParts=moveGraphicObjects(api,drawingFixture,0,parts,[],15,12),afterParts=inspectGraphicObjects(api,movedParts,0);
assert.equal(afterParts.length,3);
for(let i=0;i<parts.length;i++)for(let j=0;j<4;j++)assert.ok(Math.abs(afterParts[i].bounds[j]-parts[i].bounds[j]-(j%2?12:15))<.1,"All drawing pieces should move together");
assert.equal(inspectTextObjects(api,movedParts,0)[0].text,"Before","Moving drawings must not move or replace neighboring text");
assert.throws(()=>moveGraphicObjects(api,movedParts,0,parts,[],1,1),/changed/);
const clockWithImage=insertContent(api,drawingFixture,0,[70,70],await readFile(new URL("./fixtures/red.jpg",import.meta.url)));
const clockImage=inspectImageObjects(api,clockWithImage,0)[0],clockParts=inspectGraphicObjects(api,clockWithImage,0);
const movedClock=moveGraphicObjects(api,clockWithImage,0,clockParts,[clockImage],10,6),movedClockImage=inspectImageObjects(api,movedClock,0)[0],movedClockParts=inspectGraphicObjects(api,movedClock,0);
assert.ok(Math.abs(movedClockImage.bounds[0]-clockImage.bounds[0]-10)<.1);
assert.ok(movedClockParts.every((item,i)=>Math.abs(item.bounds[0]-clockParts[i].bounds[0]-10)<.1));
console.log("Vector paths are inspected, grouped, moved, and checked for stale selections");
const [object] = inspectTextObjects(api, fixture, 0);
assert.equal(object.text, "Before");
assert.throws(() => replaceTextObject(api, fixture, 0, object, "Different"), /font may not contain/);
assert.throws(() => replaceTextObject(api, fixture, 0, { ...object, text: "stale" }, "ale"), /changed/);
assert.throws(() => replaceTextObject(api, fixture, 0, object, "f".repeat(200)), /doesn't fit/);
const longer = replaceTextObject(api, fixture, 0, object, "BeforeBefore");
assert.equal(inspectTextObjects(api, longer, 0)[0].text, "BeforeBefore");
const resizedOriginalFont = replaceTextObject(api, fixture, 0, object, "Before", undefined, { fontSize: 12 });
assert.equal(inspectTextObjects(api, resizedOriginalFont, 0)[0].text, "Before");
const collision = makePdf("BT /F1 16 Tf 40 100 Td (Before) Tj 70 0 Td (Stop) Tj ET");
const firstObject = inspectTextObjects(api, collision, 0)[0];
const sameFontEdit = replaceTextObject(api, collision, 0, firstObject, "Soft");
assert.equal(inspectTextObjects(api, sameFontEdit, 0)[0].text.trim(), "Soft");
assert.throws(() => replaceTextObject(api, collision, 0, firstObject, "f".repeat(25)), /doesn't fit/);
const edited = replaceTextObject(api, fixture, 0, object, "for");
const check = getDocument({ data: edited, useSystemFonts: true });
const checkedPdf = await check.promise;
const checkedText = (await (await checkedPdf.getPage(1)).getTextContent()).items.map(item => item.str || "").join("");
const checkedAnnotations = await (await checkedPdf.getPage(1)).getAnnotations();
await check.destroy();
assert.equal(checkedText, "for");
assert.ok(checkedAnnotations.some(annotation => annotation.contentsObj?.str === "Keep this note"), "existing annotations must survive");
assert.equal(inspectTextObjects(api, fixture, 0)[0].text, "Before", "the input must remain unchanged");
const fontBytes = await readFile(new URL("../node_modules/katex/dist/fonts/KaTeX_Main-Regular.ttf", import.meta.url));
assert.equal(embeddingRights(fontBytes).editable, true);
const fontEdited = replaceTextObject(api, fixture, 0, object, "Hi", fontBytes, { fontSize: 12, color: "#d02030" });
const fontCheck = getDocument({ data: fontEdited.slice(), useSystemFonts: true });
const fontPdf = await fontCheck.promise;
const fontText = (await (await fontPdf.getPage(1)).getTextContent()).items.map(item => item.str || "").join("");
assert.equal(fontText, "Hi");
assert.ok((await (await fontPdf.getPage(1)).getAnnotations()).length > 0);
await fontCheck.destroy();
const stylePtr = module.wasmExports.malloc(fontEdited.length);
module.HEAPU8.set(fontEdited, stylePtr);
const styleDoc = api.FPDF_LoadMemDocument64(stylePtr, fontEdited.length, "");
const stylePage = api.FPDF_LoadPage(styleDoc, 0);
const styleObject = api.FPDFPage_GetObject(stylePage, 0);
const metrics = module.wasmExports.malloc(20);
assert.ok(api.FPDFTextObj_GetFontSize(styleObject, metrics));
assert.equal(module.getValue(metrics, "float"), 12);
assert.ok(api.FPDFPageObj_GetFillColor(styleObject, metrics + 4, metrics + 8, metrics + 12, metrics + 16));
assert.deepEqual([4, 8, 12, 16].map(offset => module.getValue(metrics + offset, "i32")), [208, 32, 48, 255]);
module.wasmExports.free(metrics); api.FPDF_ClosePage(stylePage); api.FPDF_CloseDocument(styleDoc); module.wasmExports.free(stylePtr);
const greek = replaceTextObject(api, fixture, 0, object, "Ω", fontBytes);
const greekCheck = getDocument({ data: greek, useSystemFonts: true });
const greekPdf = await greekCheck.promise;
assert.equal((await (await greekPdf.getPage(1)).getTextContent()).items.map(item => item.str || "").join(""), "Ω");
await greekCheck.destroy();
console.log("Device-font replacement saved searchable new characters and preserved the annotation");
const fragmented = makePdf("BT /F1 16 Tf 40 100 Td (B) Tj (e) Tj (f) Tj (o) Tj (r) Tj (e) Tj ET");
const words = inspectTextGroups(api, fragmented, 0);
assert.equal(words.length, 1, "adjacent glyphs should form a single word");
assert.equal(words[0].text, "Before");
assert.equal(words[0].members.length, 6);
const groupedEdit = replaceTextObject(api, fragmented, 0, words[0], "Hi", fontBytes);
const groupedLoad = getDocument({ data: groupedEdit, useSystemFonts: true });
const groupedPdf = await groupedLoad.promise;
assert.equal((await (await groupedPdf.getPage(1)).getTextContent()).items.map(item => item.str || "").join(""), "Hi");
await groupedLoad.destroy();
const deleted = replaceTextObject(api, fragmented, 0, words[0], "");
const deleteLoad = getDocument({ data: deleted, useSystemFonts: true });
const deletePdf = await deleteLoad.promise;
assert.equal((await (await deletePdf.getPage(1)).getTextContent()).items.map(item => item.str || "").join(""), "");
assert.ok((await (await deletePdf.getPage(1)).getAnnotations()).length > 0);
await deleteLoad.destroy();
console.log("Fragmented glyphs grouped and replaced as one searchable word");
const lineFixture = makePdf("BT /F1 16 Tf 40 100 Td (Hello) Tj ( ) Tj (world) Tj ET");
const lineItems = inspectTextGroups(api, lineFixture, 0, true);
assert.equal(lineItems.length, 1, "compatible text objects should form a line");
assert.equal(lineItems[0].text.trim(), "Hello world");
const lineEdited = replaceTextObject(api, lineFixture, 0, lineItems[0], "Hello word");
const lineLoad = getDocument({ data: lineEdited, useSystemFonts: true });
const lineDoc = await lineLoad.promise;
assert.equal((await (await lineDoc.getPage(1)).getTextContent()).items.map(item => item.str || "").join("").trim(), "Hello word");
await lineLoad.destroy();
console.log("Compatible text objects grouped and edited as a line");
const taggedWord = sampleGroups.find(item => item.text.trim() === "short" && item.members.length > 1);
assert.ok(taggedWord, "the tagged sample's fragmented word should be grouped");
const originalFontEdit = replaceTextObject(api, bytes, 0, taggedWord, "tour");
assert.ok(inspectTextObjects(api, originalFontEdit, 0).some(item => item.text.trim() === "tour"));
const resizedTagged = replaceTextObject(api, bytes, 0, taggedWord, taggedWord.text, undefined, { fontSize: 12 });
assert.ok(inspectTextObjects(api, resizedTagged, 0).some(item => item.text.trim() === taggedWord.text.trim()));
assert.throws(() => replaceTextObject(api, bytes, 0, taggedWord, ""), /Deleting tagged text/);
const sampleOriginalLoad = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
const sampleOriginal = await sampleOriginalLoad.promise;
const beforeStructure = await (await sampleOriginal.getPage(1)).getStructTree();
const taggedLine = inspectTextGroups(api, bytes, 0, true).find(item => item.text.includes("A short tour of Folio"));
assert.ok(taggedLine && taggedLine.members.length > 1);
const changedLine = replaceTextObject(api, bytes, 0, taggedLine, taggedLine.text.replace("short", "brief"));
const lineSampleLoad = getDocument({ data: changedLine, useSystemFonts: true });
const lineSample = await lineSampleLoad.promise;
assert.match((await (await lineSample.getPage(1)).getTextContent()).items.map(item => item.str || "").join(""), /A brief tour of Folio/);
assert.deepEqual(await (await lineSample.getPage(1)).getStructTree(), beforeStructure);
await lineSampleLoad.destroy();
const editedSample = replaceTextObject(api, bytes, 0, taggedWord, "Hi", fontBytes);
const sampleEditLoad = getDocument({ data: editedSample, useSystemFonts: true });
const sampleEdited = await sampleEditLoad.promise;
const afterStructure = await (await sampleEdited.getPage(1)).getStructTree();
assert.deepEqual(afterStructure, beforeStructure, "the tagged page's structure tree must survive");
await sampleOriginalLoad.destroy();
await sampleEditLoad.destroy();
console.log("Tagged sample word edited while preserving the page structure tree");
const imageStream = "q 30 0 0 30 40 50 cm /Im1 Do Q";
const imageObjects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R /Annots [8 0 R] >>",
  `<< /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream`,
  "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 7 >>\nstream\nFF0000>\nendstream",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 7 0 R >>",
  `<< /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream`,
  "<< /Type /Annot /Subtype /Text /Rect [10 10 30 30] /Contents (Keep this note) >>"];
let imageFile = "%PDF-1.4\n";
const imageOffsets = [0];
for (const [i, value] of imageObjects.entries()) { imageOffsets.push(imageFile.length); imageFile += `${i + 1} 0 obj\n${value}\nendobj\n`; }
const imageXref = imageFile.length;
imageFile += `xref\n0 ${imageOffsets.length}\n0000000000 65535 f \n`;
for (const offset of imageOffsets.slice(1)) imageFile += `${String(offset).padStart(10, "0")} 00000 n \n`;
imageFile += `trailer\n<< /Size ${imageOffsets.length} /Root 1 0 R >>\nstartxref\n${imageXref}\n%%EOF\n`;
const imagePdf = Buffer.from(imageFile, "ascii");
const [imageObject] = inspectImageObjects(api, imagePdf, 0);
assert.ok(imageObject, "expected an image placement");
const replacementImage = await readFile(new URL("../build/icon.png", import.meta.url));
const replacedImage = editImageObject(api, imagePdf, 0, imageObject, { kind: "replace", bytes: replacementImage });
const [replacementObject] = inspectImageObjects(api, replacedImage, 0);
assert.deepEqual(replacementObject.pixelSize, [replacementImage.readUInt32BE(16), replacementImage.readUInt32BE(20)]);
assert.deepEqual(inspectImageObjects(api, replacedImage, 1), inspectImageObjects(api, imagePdf, 1), "replacing one shared image must not change its other use");
assert.throws(() => editImageObject(api, imagePdf, 0, imageObject, { kind: "replace", bytes: new Uint8Array([1, 2, 3]) }), /PNG or JPEG/);
const jpegBytes = await readFile(new URL("./fixtures/red.jpg", import.meta.url));
const jpegPdf = editImageObject(api, imagePdf, 0, imageObject, { kind: "replace", bytes: jpegBytes });
const [jpegObject] = inspectImageObjects(api, jpegPdf, 0);
const duplicatedImage = editImageObject(api, jpegPdf, 0, jpegObject, { kind: "duplicate" });
assert.equal(inspectImageObjects(api, duplicatedImage, 0).length, 2);
assert.deepEqual(inspectImageObjects(api, duplicatedImage, 1), inspectImageObjects(api, imagePdf, 1));
assert.throws(() => editImageObject(api, imagePdf, 0, imageObject, { kind: "duplicate" }), /JPEG/);
const movedImage = editImageObject(api, imagePdf, 0, imageObject, { kind: "move", dx: 15, dy: -10 });
assert.deepEqual(inspectImageObjects(api, movedImage, 1), inspectImageObjects(api, imagePdf, 1), "shared placement on another page must remain unchanged");
assert.throws(() => editImageObject(api, movedImage, 0, imageObject, { kind: "delete" }), /changed/);
for (const operation of ["rotate-right", "flip-horizontal", "smaller", "larger"]) {
  const transformed = editImageObject(api, imagePdf, 0, imageObject, { kind: "transform", operation });
  const [changed] = inspectImageObjects(api, transformed, 0);
  assert.ok(Math.abs((changed.bounds[0] + changed.bounds[2]) / 2 - (imageObject.bounds[0] + imageObject.bounds[2]) / 2) < 0.02);
  assert.ok(Math.abs((changed.bounds[1] + changed.bounds[3]) / 2 - (imageObject.bounds[1] + imageObject.bounds[3]) / 2) < 0.02);
  assert.deepEqual(inspectImageObjects(api, transformed, 1), inspectImageObjects(api, imagePdf, 1));
}
const removedImage = editImageObject(api, imagePdf, 0, imageObject, { kind: "delete" });
assert.equal(inspectImageObjects(api, removedImage, 0).length, 0);
assert.equal(inspectImageObjects(api, removedImage, 1).length, 1);
const imageCheck = getDocument({ data: removedImage, useSystemFonts: true });
const imageCheckedPdf = await imageCheck.promise;
assert.equal(imageCheckedPdf.numPages, 2);
assert.ok((await (await imageCheckedPdf.getPage(1)).getAnnotations()).length > 0);
await imageCheck.destroy();
const nestedObjects = [...imageObjects];
const nestedStream = "q 30 0 0 30 40 50 cm /Fm1 Do Q", formStream = "/Im1 Do";
nestedObjects[2] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /XObject << /Fm1 9 0 R >> >> /Contents 4 0 R >>";
nestedObjects[3] = `<< /Length ${nestedStream.length} >>\nstream\n${nestedStream}\nendstream`;
nestedObjects.push(`<< /Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources << /XObject << /Im1 5 0 R >> >> /Length ${formStream.length} >>\nstream\n${formStream}\nendstream`);
let nestedFile = "%PDF-1.4\n";
const nestedOffsets = [0];
for (const [i, value] of nestedObjects.entries()) { nestedOffsets.push(nestedFile.length); nestedFile += `${i + 1} 0 obj\n${value}\nendobj\n`; }
const nestedXref = nestedFile.length;
nestedFile += `xref\n0 ${nestedOffsets.length}\n0000000000 65535 f \n`;
for (const offset of nestedOffsets.slice(1)) nestedFile += `${String(offset).padStart(10, "0")} 00000 n \n`;
nestedFile += `trailer\n<< /Size ${nestedOffsets.length} /Root 1 0 R >>\nstartxref\n${nestedXref}\n%%EOF\n`;
const nestedPdf = Buffer.from(nestedFile, "ascii");
assert.equal(inspectImageObjects(api, nestedPdf, 0).length, 0);
assert.equal(inspectNestedContent(api, nestedPdf, 0).images, 1);
console.log("Image placement moved or deleted without changing its shared use or annotations");
console.log("PDFium adapter validated replacement, rejected unsupported and stale edits, and preserved the original bytes");
const fixturePtr = module.wasmExports.malloc(fixture.length);
module.HEAPU8.set(fixture, fixturePtr);
const editable = api.FPDF_LoadMemDocument64(fixturePtr, fixture.length, "");
if (!editable) throw new Error("Could not open fixture");
try {
  const page = api.FPDF_LoadPage(editable, 0);
  try {
    const object = api.FPDFPage_GetObject(page, 0);
    if (api.FPDFPageObj_GetType(object) !== 1) throw new Error("Expected a text object");
    const textPtr = module.wasmExports.malloc(12);
    try {
      module.stringToUTF16("After", textPtr, 12);
      if (!api.FPDFText_SetText(object, textPtr) || !api.FPDFPage_GenerateContent(page)) throw new Error("Text replacement failed");
    } finally { module.wasmExports.free(textPtr); }
  } finally { api.FPDF_ClosePage(page); }
  const writer = api.PDFiumExt_OpenFileWriter();
  try {
    if (!api.PDFiumExt_SaveAsCopy(editable, writer)) throw new Error("Saving failed");
    const size = api.PDFiumExt_GetFileWriterSize(writer);
    const ptr = module.wasmExports.malloc(size);
    let output;
    try {
      if (api.PDFiumExt_GetFileWriterData(writer, ptr, size) !== size) throw new Error("Could not read output");
      output = module.HEAPU8.slice(ptr, ptr + size);
    } finally { module.wasmExports.free(ptr); }
    const loading = getDocument({ data: output, useSystemFonts: true });
    const reopened = await loading.promise;
    const content = await (await reopened.getPage(1)).getTextContent();
    const actual = content.items.map(item => item.str || "").join("");
    await loading.destroy();
    if (actual !== "After") throw new Error(`Unexpected reopened text: ${JSON.stringify(actual)}`);
    console.log("PDFium replaced real text; PDF.js reopened the saved copy and extracted After");
  } finally { api.PDFiumExt_CloseFileWriter(writer); }
} finally {
  api.FPDF_CloseDocument(editable);
  module.wasmExports.free(fixturePtr);
}

const paragraphFixture = makePdf("BT /F1 16 Tf 40 120 Td (Hello world) Tj 0 -20 Td (Hello world) Tj ET");
const paragraphs = inspectParagraphs(api,paragraphFixture,0);
assert.equal(paragraphs.length,1);
assert.equal(paragraphs[0].lines.length,2);
const paragraphEdited = replaceTextObject(api,paragraphFixture,0,paragraphs[0],"Hello word\nHello word");
assert.match(inspectTextObjects(api,paragraphEdited,0).map(item => item.text).join(" "), /Hello word Hello word/);
const resized = editImageObject(api,imagePdf,0,imageObject,{kind:"resize",bounds:[imageObject.bounds[0],imageObject.bounds[1],imageObject.bounds[2]+10,imageObject.bounds[3]+15]});
assert.ok(Math.abs(inspectImageObjects(api,resized,0)[0].bounds[2]-imageObject.bounds[2]-10) < .1);
const rotated = editPage(api,bytes,0,"rotate");
let task = getDocument({ data: rotated }); let checked = await task.promise;
assert.equal((await checked.getPage(1)).rotate,90); await task.destroy();
const reordered = editPage(api,bytes,0,"reorder",1);
task = getDocument({ data: reordered.slice() }); checked = await task.promise;
const moved = (await (await checked.getPage(2)).getTextContent()).items.map(item => item.str||"").join(" ");
assert.match(moved,/A short tour/); await task.destroy();
const deletedPage = editPage(api,reordered,0,"delete");
task = getDocument({ data: deletedPage }); checked = await task.promise; assert.equal(checked.numPages,3); await task.destroy();
const flipped = editPage(api,bytes,0,"flip");
task = getDocument({ data: flipped }); checked = await task.promise; await (await checked.getPage(1)).getOperatorList(); await task.destroy();
console.log("Paragraphs, image resizing, and page rotate/reorder/delete/flip verified through PDF.js");

const formattedText=replaceTextObject(api,fixture,0,object,"Hi",fontBytes,{fontSize:18,color:"#123456",horizontalScale:110,tracking:.2,underline:true,link:"https://example.org/"});
const formattedTask=getDocument({data:formattedText.slice(),useSystemFonts:true}),formattedDoc=await formattedTask.promise;
const formattedPage=await formattedDoc.getPage(1);
assert.match((await formattedPage.getTextContent()).items.map(item=>item.str || "").join(""),/Hi/);
assert.ok((await formattedPage.getAnnotations()).some(item=>item.url==="https://example.org/"));
await formattedTask.destroy();
const underlined=replaceTextObject(api,fixture,0,object,"Hi",fontBytes,{underline:true});
const underlineTask=getDocument({data:underlined}),underlineDoc=await underlineTask.promise;
assert.ok((await (await underlineDoc.getPage(1)).getAnnotations()).some(item=>item.subtype==="Underline"));await underlineTask.destroy();
const inserted=insertContent(api,fixture,0,[40,40],undefined,fontBytes);
assert.ok(inspectTextObjects(api,inserted,0).some(item=>item.text.trimEnd()==="New text"));
const insertedImage=insertContent(api,fixture,0,[40,150],jpegBytes);
assert.equal(inspectImageObjects(api,insertedImage,0).length,1);
const arranged=reorderObjects(api,insertedImage,0,[inspectImageObjects(api,insertedImage,0)[0].index],"back");
assert.equal(inspectImageObjects(api,arranged,0)[0].index,0);
console.log("Font size growth, tracking, scale, underline, links, content insertion and object order verified");

const {inspectEditableText,textCellBounds,moveTextCell,writeTextCell,textCellFont,renderTextPreview,textCaretPositions}=await import("../src/editor/textCells.ts");
const initialCell=inspectEditableText(api,fixture,0,"paragraph")[0],initialBox=textCellBounds(initialCell);
const originalFont=textCellFont(api,fixture,0,initialCell);
const movedCell=moveTextCell(api,fixture,0,initialCell,[initialBox[0]+30,initialBox[1]-20,initialBox[2]+30,initialBox[3]-20]);
let cell=inspectEditableText(api,movedCell.bytes,0).find(item=>item.cell?.id===movedCell.cellId);
assert.ok(cell);assert.equal(cell.text,initialCell.text);assert.ok(Math.abs(cell.bounds[0]-initialCell.bounds[0]-30)<.1);
assert.deepEqual(textCellFont(api,movedCell.bytes,0,cell),originalFont,"Moving text must retain its PDF font program");
const resizedCell=writeTextCell(api,movedCell.bytes,0,cell,"Before Before Before",[40,50,85,130]);
cell=inspectEditableText(api,resizedCell.bytes,0).find(item=>item.cell?.id===resizedCell.cellId);
assert.ok(cell && cell.members.length>=3,"Narrowing a cell should wrap its text");assert.equal(cell.fontSize,initialCell.fontSize);
assert.equal(cell.text,"Before Before Before");assert.equal(cell.cell.bounds[2],85);
const overlapping=writeTextCell(api,fixture,0,initialCell,"Before Before",[40,80,230,120]);
cell=inspectEditableText(api,overlapping.bytes,0).find(item=>item.cell?.id===overlapping.cellId);assert.ok(cell);
const emptied=writeTextCell(api,overlapping.bytes,0,cell,"");
cell=inspectEditableText(api,emptied.bytes,0).find(item=>item.cell?.id===emptied.cellId);assert.ok(cell);assert.equal(cell.text,"");
const refilled=writeTextCell(api,emptied.bytes,0,cell,"Before");
cell=inspectEditableText(api,refilled.bytes,0).find(item=>item.cell?.id===refilled.cellId);assert.equal(cell.text,"Before");
const ordered=reorderObjects(api,refilled.bytes,0,cell.members.map(item=>item.index),"back");
assert.ok(inspectEditableText(api,ordered,0).some(item=>item.cell?.id===cell.cell.id),"Cell identity should survive object reordering");
const preview=renderTextPreview(api,ordered,0,200,150,0);assert.equal(preview.length,200*150*4);assert.ok(preview.some((v,i)=>i%4<3&&v<200));
const freeTask=getDocument({data:ordered.slice(),useSystemFonts:true}),freeDoc=await freeTask.promise;
assert.match((await (await freeDoc.getPage(1)).getTextContent()).items.map(item=>item.str || "").join(""),/Before/);
await freeTask.destroy();
console.log("Free text cells retain original fonts, wrap on resize, allow overlap, survive order/reopen, and render native previews");

const overlappedDoc=insertContent(api,jpegPdf,0,[imageObject.bounds[0],imageObject.bounds[3]],undefined,fontBytes);
const addedText=inspectEditableText(api,overlappedDoc,0).find(item=>item.text.trimEnd()==="New text");assert.ok(addedText);
const overlapBox=[imageObject.bounds[0]+1,imageObject.bounds[1]+1,imageObject.bounds[2]-1,imageObject.bounds[3]-1];
const textOnImage=writeTextCell(api,overlappedDoc,0,addedText,"N",overlapBox);
const overlapCell=inspectEditableText(api,textOnImage.bytes,0).find(item=>item.cell?.id===textOnImage.cellId);
const behind=reorderObjects(api,textOnImage.bytes,0,overlapCell.members.map(item=>item.index),"back");
const frontPixels=renderTextPreview(api,textOnImage.bytes,0,300,200,0),backPixels=renderTextPreview(api,behind,0,300,200,0);
const dark=pixels=>Array.from({length:pixels.length/4},(_,i)=>i*4).filter(i=>pixels[i]<60&&pixels[i+1]<60&&pixels[i+2]<60).length;
assert.ok(dark(frontPixels)>dark(backPixels),"Sending overlapping text behind the image must change its visible order");
console.log("Overlapping text renders above or below an image according to its saved object order");

const strokeFixture=makePdf("0 0 1 RG BT /F1 16 Tf 1 Tr 40 100 Td (Before) Tj ET");
const strokeText=inspectEditableText(api,strokeFixture,0)[0];assert.equal(strokeText.fontSize,16);assert.equal(strokeText.color,"#0000ff");
const paintedCell=writeTextCell(api,strokeFixture,0,strokeText,"Before",undefined,undefined,{color:"#ff0000"});
const paintedPixels=renderTextPreview(api,paintedCell.bytes,0,300,200,0);
assert.ok(Array.from({length:paintedPixels.length/4},(_,i)=>i*4).some(i=>paintedPixels[i]>150&&paintedPixels[i+1]<100&&paintedPixels[i+2]<100));
const rotatedFixture=makePdf("BT /F1 16 Tf 0 1 -1 0 140 40 Tm (Before) Tj ET");
const rotatedText=inspectEditableText(api,rotatedFixture,0)[0],rotatedBox=textCellBounds(rotatedText);
const movedRotated=moveTextCell(api,rotatedFixture,0,rotatedText,[rotatedBox[0]+10,rotatedBox[1]+15,rotatedBox[2]+10,rotatedBox[3]+15]);
assert.ok(inspectEditableText(api,movedRotated.bytes,0).some(item=>item.cell?.id===movedRotated.cellId));
console.log("Stroke font appearance and movement of rotated text retained");

const annotatedCell=writeTextCell(api,fixture,0,initialCell,"Before",undefined,undefined,{underline:true});
const withSecond=insertContent(api,annotatedCell.bytes,0,[150,40],undefined,fontBytes);
const second=inspectEditableText(api,withSecond,0).find(item=>item.text.trimEnd()==="New text");
const firstBox=textCellBounds(inspectEditableText(api,withSecond,0).find(item=>item.cell?.id===annotatedCell.cellId));
const secondBox=textCellBounds(second),crossingBox=[firstBox[0],firstBox[3]-(secondBox[3]-secondBox[1]),firstBox[0]+secondBox[2]-secondBox[0],firstBox[3]];
const crossed=moveTextCell(api,withSecond,0,second,crossingBox);
const crossedCell=inspectEditableText(api,crossed.bytes,0).find(item=>item.cell?.id===crossed.cellId);
const awayBox=textCellBounds(crossedCell).map((v,i)=>v+(i%2===0?30:20));
const uncrossed=moveTextCell(api,crossed.bytes,0,crossedCell,awayBox);
const underlineRects=async data=>{const task=getDocument({data:data.slice(),useSystemFonts:true}),doc=await task.promise;try{return (await (await doc.getPage(1)).getAnnotations()).filter(a=>a.subtype==="Underline").map(a=>a.rect);}finally{await task.destroy();}};
assert.deepEqual(await underlineRects(crossed.bytes),await underlineRects(uncrossed.bytes),"Moving across another cell must not move that cell's underline");
console.log("Overlapping cells keep their own decorations without moving a neighbor's annotations");

const caretPositions=textCaretPositions(api,fixture,0,initialCell,initialCell.text);
assert.ok(caretPositions);assert.equal(caretPositions.length,initialCell.text.length+1);
assert.ok(caretPositions.at(-1)[0]>caretPositions[0][0]+20,"Caret positions should follow the PDF glyphs");
const changedPositions=textCaretPositions(api,refilled.bytes,0,cell,cell.text);
assert.ok(changedPositions && changedPositions.length===cell.text.length+1);
const trailingPositions=textCaretPositions(api,refilled.bytes,0,cell,cell.text+"  ");
assert.ok(trailingPositions && trailingPositions.at(-1)[0]>changedPositions.at(-1)[0],"Caret should advance across trailing spaces");
console.log("Caret positions follow the PDF glyphs before and after a text edit");

const boldFont=await readFile(new URL("../node_modules/katex/dist/fonts/KaTeX_Main-Bold.ttf",import.meta.url));
const rich=writeTextCell(api,fixture,0,initialCell,"Before",undefined,undefined,{runs:[{start:1,end:4,fontBytes:boldFont,fontName:"KaTeX_Main-Bold",fontSize:20,color:"#ff0000",underline:true}]});
const richCell=inspectEditableText(api,rich.bytes,0).find(item=>item.cell?.id===rich.cellId);
assert.equal(richCell.text,"Before");assert.equal(richCell.cell.format.runs.length,1);
const richMembers=richCell.members;
assert.equal(richMembers[0].fontSize,16);assert.equal(richMembers[1].fontSize,20);assert.equal(richMembers[4].fontSize,16);
assert.equal(richMembers[1].color,"#ff0000");assert.notEqual(richMembers[0].color,"#ff0000");
const richAgain=writeTextCell(api,rich.bytes,0,richCell,"Before!",undefined,undefined,richCell.cell.format,fontBytes);
const again=inspectEditableText(api,richAgain.bytes,0).find(item=>item.cell?.id===richAgain.cellId);
assert.equal(again.text,"Before!");assert.equal(again.members[1].fontSize,20);assert.equal(again.members[4].fontSize,16);
console.log("Selected character fonts, sizes, colors and underline survive saving and later text edits");

const {PDFDocument,PDFName,PDFNumber,PDFArray,PDFDict,PDFNull}=await import("pdf-lib");
const {removeImageTag}=await import("../src/editor/imageTags.ts");
const taggedImageDoc=await PDFDocument.load(imagePdf),taggedImagePage=taggedImageDoc.getPage(0),ctx=taggedImageDoc.context;
const root=ctx.obj({Type:"StructTreeRoot"}),rootRef=ctx.register(root);
const figure=ctx.register(ctx.obj({Type:"StructElem",S:"Figure",P:rootRef,Pg:taggedImagePage.ref,K:0,Alt:ctx.obj("Picture")}));
const neighbor=ctx.register(ctx.obj({Type:"StructElem",S:"P",P:rootRef,Pg:taggedImagePage.ref,K:1}));
root.set(PDFName.of("K"),ctx.obj([figure,neighbor]));root.set(PDFName.of("ParentTree"),ctx.register(ctx.obj({Nums:[0,[figure,neighbor]]})));taggedImagePage.node.set(PDFName.of("StructParents"),PDFNumber.of(0));taggedImageDoc.catalog.set(PDFName.of("StructTreeRoot"),rootRef);
taggedImagePage.node.normalize();taggedImagePage.node.wrapContentStreams(ctx.register(ctx.stream("/Figure <</MCID 0>> BDC\n")),ctx.register(ctx.stream("\nEMC")));
const taggedImageBytes=await taggedImageDoc.save({useObjectStreams:false}),taggedImage=inspectImageObjects(api,taggedImageBytes,0)[0];assert.equal(taggedImage.markedContentId,0);
const deletedTagged=await removeImageTag(editImageObject(api,taggedImageBytes,0,taggedImage,{kind:"delete",removeTagged:true}),0,0);
assert.equal(inspectImageObjects(api,deletedTagged,0).length,0);assert.equal(inspectImageObjects(api,deletedTagged,1).length,1);
const checkedTags=await PDFDocument.load(deletedTagged),checkedRoot=checkedTags.catalog.lookup(PDFName.of("StructTreeRoot"),PDFDict);
assert.equal(checkedRoot.lookup(PDFName.of("K"),PDFArray).size(),1,"Neighboring structure entries must survive deleting a tagged image");
assert.equal(checkedRoot.lookup(PDFName.of("ParentTree"),PDFDict).lookup(PDFName.of("Nums"),PDFArray).lookup(1,PDFArray).get(0),PDFNull);
const {renderOcrTarget,convertOcrTarget}=await import("../src/editor/ocrPdf.ts");
const raster=renderOcrTarget(api,imagePdf,0,{image:imageObject});assert.ok(raster.width>50 && raster.height>50);assert.ok(raster.pixels.some((value,i)=>i%4===0&&value>100));
const onlyText=await convertOcrTarget(api,imagePdf,0,{image:imageObject},[{text:"Detected text",confidence:99,box:[.1,.1,.9,.5],paragraph:0}],undefined,fontBytes);
assert.equal(inspectImageObjects(api,onlyText,0).length,0);assert.equal(inspectImageObjects(api,onlyText,1).length,1);assert.equal(inspectEditableText(api,onlyText,0)[0].text,"Detected text");
console.log("Tagged image deletion updates only its structure entry; OCR converts images into editable text");

const groupedDoc=await PDFDocument.create(),groupedPage=groupedDoc.addPage([500,300]),[embedded]=await groupedDoc.embedPdf(imagePdf,[0]);groupedPage.drawPage(embedded,{x:20,y:40,width:180,height:120});groupedPage.drawPage(embedded,{x:250,y:40,width:180,height:120});
const groupedBytes=await groupedDoc.save({useObjectStreams:false}),groups=inspectGraphicObjects(api,groupedBytes,0).filter(item=>item.type===5);assert.equal(groups.length,2);assert.equal(inspectNestedContent(api,groupedBytes,0).images,2);
const groupRaster=renderOcrTarget(api,groupedBytes,0,{graphic:groups[0]});assert.ok(groupRaster.width>30);
const convertedGroup=await convertOcrTarget(api,groupedBytes,0,{graphic:groups[0]},[{text:"Group text",confidence:99,box:[.1,.1,.8,.3],paragraph:0}],undefined,fontBytes);
assert.equal(inspectNestedContent(api,convertedGroup,0).images,1,"Converting one group should not alter its other shared placement");assert.equal(inspectEditableText(api,convertedGroup,0)[0].text,"Group text");
console.log("Grouped-content OCR preserves the other placement of a shared form");

const {wordAppearance,removeRecognizedInk,inkRemovalOverlay,recognitionBox}=await import("../src/editor/ocrAppearance.ts");
assert.deepEqual(recognitionBox({text:"TITLE",bbox:{x0:10,y0:2,x1:100,y1:62},symbols:[..."TITLE"].map((text,i)=>({text,bbox:{x0:10+i*18,y0:i===2?2:20,x1:28+i*18,y1:i===2?62:40}}))}),{x0:10,y0:20,x1:100,y1:40},"Stray attached ornaments must not inflate a capital heading's size");
const width=120,height=80,pixels=new Uint8ClampedArray(width*height*4).fill(255);
for(let y=15;y<35;y++)for(let x=15;x<25;x++){const p=(y*width+x)*4;pixels[p]=10;pixels[p+1]=118;pixels[p+2]=53;}
for(let y=45;y<70;y++)for(let x=75;x<105;x++){const p=(y*width+x)*4;pixels[p]=30;pixels[p+1]=80;pixels[p+2]=170;}
const frame={width,height,pixels},box=[.1,.1,.4,.5],appearance=wordAppearance(frame,box);assert.equal(appearance.color,"#0a7635");const cleaned=removeRecognizedInk(frame,[box]);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=(y*width+x)*4;if(x<15||x>=25||y<15||y>=35)assert.deepEqual(cleaned.pixels.slice(p,p+4),pixels.slice(p,p+4));}assert.equal(cleaned.pixels[(20*width+20)*4],255);
// First/last glyph strokes can fall outside an OCR box; they are not a full-width drawing rule.
const strokes=new Uint8ClampedArray(width*height*4).fill(255);for(let y=14;y<36;y++)for(let x=0;x<66;x++)if((x>=8&&x<51&&(x<15||x>42))||y===25){const at=(y*width+x)*4;strokes[at]=10;strokes[at+1]=118;strokes[at+2]=53;}
const strokeClean=removeRecognizedInk({width,height,pixels:strokes},[box]);assert.equal(strokeClean.pixels[(20*width+14)*4],255,"Letter strokes at both box edges must be erased");assert.equal(strokeClean.pixels[(25*width+25)*4],10,"A continuous drawing rule must remain unchanged");
const isolated=new Uint8ClampedArray(width*height*4).fill(255);for(let y=15;y<35;y++)for(let x=15;x<20;x++){const at=(y*width+x)*4;isolated[at]=10;isolated[at+1]=118;isolated[at+2]=53;}assert.equal(removeRecognizedInk({width,height,pixels:isolated},[[15/width,15/height,20/width,35/height]]).pixels[(25*width+17)*4],255,"A full-height letter I must not be mistaken for a drawing rule");
const maskFixture=await PDFDocument.create(),maskPage=maskFixture.addPage([120,80]);maskPage.drawRectangle({x:15,y:50,width:20,height:20,color:(await import("pdf-lib")).rgb(.05,.5,.2)});maskPage.drawRectangle({x:75,y:10,width:25,height:20,color:(await import("pdf-lib")).rgb(.1,.2,.8)});const maskBytes=await maskFixture.save(),maskSource=renderOcrTarget(api,maskBytes,0,{page:true});const overlay=inkRemovalOverlay(maskSource,[[15/120,10/80,35/120,30/80]]);assert.deepEqual([...overlay.pixels.slice(0,4)],[255,255,255,0],"Transparent pixels need background RGB to prevent dark interpolation fringes");
const maskPdf=await convertOcrTarget(api,maskBytes,0,{page:true,keepImage:true},[],overlay),maskResult=renderOcrTarget(api,maskPdf,0,{page:true});const pixelAt=(frame,x,y)=>frame.pixels.slice((Math.floor(y*frame.height)*frame.width+Math.floor(x*frame.width))*4,(Math.floor(y*frame.height)*frame.width+Math.floor(x*frame.width))*4+4);assert.deepEqual(pixelAt(maskResult,.2,.25),new Uint8ClampedArray([255,255,255,255]));assert.deepEqual(pixelAt(maskResult,.7,.75),pixelAt(maskSource,.7,.75),"Artwork outside recognized ink must render unchanged");
const {parseOcrPages}=await import("../src/editor/ocrPages.ts");assert.deepEqual(parseOcrPages("1, 3-5, 3",6),[1,3,4,5]);assert.throws(()=>parseOcrPages("0,9",6));
const colored=await convertOcrTarget(api,imagePdf,0,{page:true},[{text:"Colored text",confidence:99,box:[.1,.1,.7,.3],paragraph:0,color:"#005533"}],undefined,fontBytes);
const coloredCell=inspectEditableText(api,colored,0)[0];assert.equal(coloredCell.color,"#005533");for(const [i,value] of [30,140,210,180].entries())assert.ok(Math.abs(coloredCell.bounds[i]-value)<.15,"Recognized glyph bounds should retain the source text size and position");assert.equal(inspectImageObjects(api,colored,1).length,1);
const convertedTaggedPage=await convertOcrTarget(api,taggedImageBytes,0,{page:true},[{text:"Tagged page OCR",confidence:99,box:[.1,.1,.7,.3],paragraph:0}],undefined,fontBytes);const convertedTaggedDoc=await PDFDocument.load(convertedTaggedPage);assert.equal(convertedTaggedDoc.getPageCount(),2);assert.equal(inspectImageObjects(api,convertedTaggedPage,1).length,1);
console.log("Page OCR retains measured color and glyph geometry; non-text pixels, other pages and range validation verified");
const {previewTextCell,renderObjectLayers}=await import("../src/editor/textCells.ts");
const fast=previewTextCell(api,fixture,0,initialCell,"Preview",undefined,fontBytes,{fontSize:20},undefined,640,480,0),storedPreview=writeTextCell(api,fixture,0,initialCell,"Preview",undefined,fontBytes,{fontSize:20});
assert.deepEqual(fast.pixels,renderTextPreview(api,storedPreview.bytes,0,640,480,0),"In-memory previews must match saved text pixels");assert.ok(fast.foreground.some((value,i)=>i%4===3&&value>0));
const layers=renderObjectLayers(api,fixture,0,(initialCell.members || [initialCell]).map(item=>item.index),640,480,0);assert.ok(layers.foreground.some((value,i)=>i%4===3&&value>0));assert.ok(layers.foreground.some((value,i)=>i%4===3&&value===0));assert.equal(layers.background.length,640*480*4);
console.log("In-memory text previews match saved PDF pixels; object layers retain transparent native artwork for live drags");

