import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { embeddingRights, hasFontCharacters, matchLocalFont } from "../src/editor/fonts.ts";

function font(flags) {
  const bytes = new Uint8Array(38);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, 1);
  view.setUint32(12, 0x4f532f32);
  view.setUint32(20, 28);
  view.setUint32(24, 10);
  view.setUint16(36, flags);
  return bytes;
}
assert.deepEqual(embeddingRights(font(0)), { editable: true, maySubset: true });
assert.deepEqual(embeddingRights(font(8 | 0x100)), { editable: true, maySubset: false });
for (const flags of [2, 4, 6, 0x200]) assert.equal(embeddingRights(font(flags)).editable, false);
assert.equal(embeddingRights(new Uint8Array(4)).editable, false);
const malformed = font(0);
new DataView(malformed.buffer).setUint32(20, 0xffffffff);
assert.equal(embeddingRights(malformed).editable, false);
const realFont = readFileSync(new URL("../node_modules/katex/dist/fonts/KaTeX_Main-Regular.ttf", import.meta.url));
assert.equal(hasFontCharacters(realFont, "Hello Ω"), true);
assert.equal(hasFontCharacters(realFont, "学"), false);
assert.equal(hasFontCharacters(new Uint8Array(4), "A"), false);
console.log("Font embedding rights: editable, subset restrictions, denial and malformed files passed");

const installed = [{ family:"Segoe UI", fullName:"Segoe UI", postscriptName:"SegoeUI", style:"Regular" },{family:"Arial",fullName:"Arial",postscriptName:"ArialMT",style:"Regular"}];
assert.equal(matchLocalFont(installed,"ABCDEF+SegoeUI"),installed[0]);
assert.equal(matchLocalFont(installed,"ArialMT"),installed[1]);
assert.equal(matchLocalFont(installed,"Helvetica"),installed[1]);
assert.equal(matchLocalFont(installed,"AbsentFont"),undefined);
console.log("PDF subset names, installed faces, and standard-font equivalents matched");
