import { groupParagraphLines } from "./paragraphs.ts";
import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { embeddingRights, hasFontCharacters, validFontSize } from "./fonts.ts";

/** A conservative first adapter. Object indices are only valid for the exact input revision. */
export interface PdfTextObject {
  index: number;
  text: string;
  bounds: [number, number, number, number];
  members?: PdfTextObject[];
  granularity?: "line" | "paragraph";
  lines?: PdfTextObject[];
  fontName?: string;
  fontSize?: number;
  fontScale?: number;
  fontScaleX?: number;
  color?: string;
  underline?: boolean;
  cell?: { id: string; bounds: [number,number,number,number]; format?: TextFormatting; cap?: number };
}
export interface TextFormatting {
  runs?:TextStyleRun[];
  fontSize?: number; color?: string; alignment?: "left" | "center" | "right" | "justify";
  lineHeight?: number; paragraphSpacing?: number; horizontalScale?: number; tracking?: number; underline?: boolean; link?: string;
  region?: [number, number, number, number]; offsetY?: number;
}
export interface TextStyleRun { start:number;end:number;fontName?:string;fontSize?:number;color?:string;underline?:boolean;fontBytes?:Uint8Array }
export interface PdfImageObject { index: number; bounds: [number, number, number, number]; matrix: number[]; pixelSize?: [number, number]; unsupported?: string; markedContentId?:number }
export interface PdfGraphicObject { index:number; type:2|5; bounds:[number,number,number,number]; path?:string; fill?:boolean; unsupported?:string }
export type ImageTransform = "rotate-right" | "flip-horizontal" | "smaller" | "larger";

/** Layer and artifact marks without an MCID do not point into an accessibility structure tree. */
export function nonStructuralMarks(api:WrappedPdfiumModule,object:number):boolean {
  if(api.FPDFPageObj_GetMarkedContentID(object)>=0)return false;
  const ptr=api.pdfium.wasmExports.malloc(1028);try{for(let i=0;i<api.FPDFPageObj_CountMarks(object);i++){const mark=api.FPDFPageObj_GetMark(object,i);if(!api.FPDFPageObjMark_GetName(mark,ptr,1024,ptr+1024)||api.pdfium.getValue(ptr+1024,"i32")>1024||!["OC","Artifact"].includes(api.pdfium.UTF16ToString(ptr)))return false;}return true;}finally{api.pdfium.wasmExports.free(ptr);}
}

const heap = (api: WrappedPdfiumModule) => (api.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;

function withDocument<T>(api: WrappedPdfiumModule, bytes: Uint8Array, run: (doc: number) => T, options:{readOnly?:boolean;password?:string}={}): T {
  const memory = api.pdfium;
  const input = memory.wasmExports.malloc(bytes.byteLength);
  if (!input) throw new Error("Not enough memory to open the PDF.");
  let doc = 0;
  try {
    heap(api).set(bytes, input);
    doc = api.FPDF_LoadMemDocument64(input, bytes.byteLength, options.password || "");
    if (!doc) throw new Error("This document could not be opened for editing.");
    if (!options.readOnly && api.EPDF_IsEncrypted(doc)) throw new Error("Editing encrypted documents is not supported yet.");
    if (!options.readOnly && api.FPDF_GetSignatureCount(doc) > 0) throw new Error("Editing digitally signed documents is not supported.");
    return run(doc);
  } finally {
    if (doc) api.FPDF_CloseDocument(doc);
    memory.wasmExports.free(input);
  }
}

function objectText(api: WrappedPdfiumModule, object: number, textPage: number): string {
  const size = api.FPDFTextObj_GetText(object, textPage, 0, 0);
  if (size <= 2) return "";
  const ptr = api.pdfium.wasmExports.malloc(size);
  if (!ptr) throw new Error("Not enough memory to read text.");
  try {
    if (!api.FPDFTextObj_GetText(object, textPage, ptr, size)) throw new Error("Couldn't read PDF text.");
    return api.pdfium.UTF16ToString(ptr);
  } finally { api.pdfium.wasmExports.free(ptr); }
}

function objectBounds(api: WrappedPdfiumModule, object: number): PdfTextObject["bounds"] {
  const ptr = api.pdfium.wasmExports.malloc(16);
  if (!ptr) throw new Error("Not enough memory to read text bounds.");
  try {
    if (!api.FPDFPageObj_GetBounds(object, ptr, ptr + 4, ptr + 8, ptr + 12)) throw new Error("Couldn't read text position.");
    return [0, 4, 8, 12].map(offset => api.pdfium.getValue(ptr + offset, "float")) as PdfTextObject["bounds"];
  } finally { api.pdfium.wasmExports.free(ptr); }
}

function requireSimpleTransform(api: WrappedPdfiumModule, object: number) {
  const ptr = api.pdfium.wasmExports.malloc(24);
  if (!ptr) throw new Error("Not enough memory to read text position.");
  try {
    if (!api.FPDFPageObj_GetMatrix(object, ptr)) throw new Error("Couldn't read text position.");
    const [a, b, c, d] = [0, 4, 8, 12].map(offset => api.pdfium.getValue(ptr + offset, "float"));
    if (a <= 0 || d <= 0 || Math.abs(b) > 0.0001 || Math.abs(c) > 0.0001)
      throw new Error("Editing rotated or transformed text is not supported yet.");
  } finally { api.pdfium.wasmExports.free(ptr); }
}

/** Preserve simple tagged-PDF MCID marks; other marked content may contain semantics we cannot rewrite safely. */
function simpleMark(api: WrappedPdfiumModule, object: number): { name: string; id: number } | null | undefined {
  const count = api.FPDFPageObj_CountMarks(object);
  if (count === 0) return null;
  if(nonStructuralMarks(api,object))return null;
  if (count !== 1) return undefined;
  const mark = api.FPDFPageObj_GetMark(object, 0), id = api.FPDFPageObj_GetMarkedContentID(object);
  if (!mark || id < 0 || api.FPDFPageObjMark_CountParams(mark) !== 1) return undefined;
  const ptr = api.pdfium.wasmExports.malloc(1032);
  if (!ptr) return undefined;
  try {
    if (!api.FPDFPageObjMark_GetName(mark, ptr, 512, ptr + 1024)
      || api.pdfium.getValue(ptr + 1024, "i32") > 512
      || !api.FPDFPageObjMark_GetParamKey(mark, 0, ptr + 512, 512, ptr + 1028)
      || api.pdfium.getValue(ptr + 1028, "i32") > 512) return undefined;
    const name = api.pdfium.UTF16ToString(ptr), key = api.pdfium.UTF16ToString(ptr + 512);
    if (!name || key !== "MCID") return undefined;
    return { name, id };
  } finally { api.pdfium.wasmExports.free(ptr); }
}

function withPage<T>(api: WrappedPdfiumModule, doc: number, pageIndex: number, run: (page: number, textPage: number, releaseText: () => void) => T): T {
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= api.FPDF_GetPageCount(doc)) throw new Error("Invalid page.");
  const page = api.FPDF_LoadPage(doc, pageIndex);
  if (!page) throw new Error("Couldn't open the page.");
  const textPage = api.FPDFText_LoadPage(page);
  if (!textPage) { api.FPDF_ClosePage(page); throw new Error("Couldn't read page text."); }
  let textOpen = true;
  const releaseText = () => { if (textOpen) { api.FPDFText_ClosePage(textPage); textOpen = false; } };
  try { return run(page, textPage, releaseText); }
  finally { releaseText(); api.FPDF_ClosePage(page); }
}

function availableRight(api: WrappedPdfiumModule, page: number, expected: PdfTextObject): number {
  const ptr = api.pdfium.wasmExports.malloc(16);
  if (!ptr) return expected.bounds[2];
  let right = expected.bounds[2];
  try {
    if (api.FPDFPage_GetCropBox(page, ptr, ptr + 4, ptr + 8, ptr + 12)
      || api.FPDFPage_GetMediaBox(page, ptr, ptr + 4, ptr + 8, ptr + 12)) {
      const edge = api.pdfium.getValue(ptr + 8, "float");
      if (Number.isFinite(edge) && edge >= right) right = edge;
    }
    const selected = new Set((expected.members ?? [expected]).map(item => item.index));
    const [left, bottom, originalRight, top] = expected.bounds;
    for (let index = 0, count = api.FPDFPage_CountObjects(page); index < count; index++) {
      if (selected.has(index)) continue;
      const object = api.FPDFPage_GetObject(page, index);
      if (!object || !api.FPDFPageObj_GetBounds(object, ptr, ptr + 4, ptr + 8, ptr + 12)) continue;
      const [x1, y1, x2, y2] = [0, 4, 8, 12].map(offset => api.pdfium.getValue(ptr + offset, "float"));
      if ([x1, y1, x2, y2].every(Number.isFinite) && x2 > originalRight && x2 > left
        && y1 < top && y2 > bottom && x2 > x1 && y2 > y1) {
        if (x1 >= originalRight - 0.5) right = Math.min(right, Math.max(originalRight, x1 - 1));
        else if (x1 > left || y1 > bottom || y2 < top) right = Math.min(right, originalRight);
      }
    }
    return right;
  } finally { api.pdfium.wasmExports.free(ptr); }
}

export function inspectImageObjects(api: WrappedPdfiumModule, bytes: Uint8Array, pageIndex: number): PdfImageObject[] {
  return withDocument(api, bytes, doc => withPage(api, doc, pageIndex, page => {
    const result: PdfImageObject[] = [];
    const ptr = api.pdfium.wasmExports.malloc(24);
    if (!ptr) throw new Error("Not enough memory to inspect images.");
    try {
      for (let index = 0, count = api.FPDFPage_CountObjects(page); index < count; index++) {
        const object = api.FPDFPage_GetObject(page, index);
        if (api.FPDFPageObj_GetType(object) !== 3 || !api.FPDFPageObj_GetMatrix(object, ptr)) continue;
        let overlay=false;const name=api.pdfium.wasmExports.malloc(516);try{for(let i=0;i<api.FPDFPageObj_CountMarks(object);i++)if(api.FPDFPageObjMark_GetName(api.FPDFPageObj_GetMark(object,i),name,512,name+512)&&api.pdfium.getValue(name+512,"i32")<=512&&api.pdfium.UTF16ToString(name)==="ZionPdfOcrOverlay")overlay=true;}finally{api.pdfium.wasmExports.free(name);}if(overlay)continue;
        const matrix = [0, 4, 8, 12, 16, 20].map(offset => api.pdfium.getValue(ptr + offset, "float"));
        const pixelSize = api.FPDFImageObj_GetImagePixelSize(object, ptr, ptr + 4)
          ? [api.pdfium.getValue(ptr, "i32"), api.pdfium.getValue(ptr + 4, "i32")] as [number, number] : undefined;
        const mark=simpleMark(api,object);
        result.push({ index, bounds: objectBounds(api, object), matrix, ...(pixelSize ? { pixelSize } : {}),...(mark?{markedContentId:mark.id}:{}) });
      }
      return result;
    } finally { api.pdfium.wasmExports.free(ptr); }
  }));
}

/** Top-level vector paths and form placements remain independent PDF objects. */
export function inspectGraphicObjects(api:WrappedPdfiumModule,bytes:Uint8Array,pageIndex:number):PdfGraphicObject[] {
  return withDocument(api,bytes,doc=>withPage(api,doc,pageIndex,page=>{
    const result:PdfGraphicObject[]=[],p=api.pdfium.wasmExports.malloc(40);if(!p)throw new Error("Not enough memory to inspect drawings.");
    try {for(let index=0,count=api.FPDFPage_CountObjects(page);index<count;index++){
      const object=api.FPDFPage_GetObject(page,index),type=api.FPDFPageObj_GetType(object);if(type!==2&&type!==5)continue;
      const bounds=objectBounds(api,object);if(!bounds.every(Number.isFinite))continue;
      let path:string|undefined,fill=false;
      if(type===2&&api.FPDFPageObj_GetMatrix(object,p)){
        const m=[0,4,8,12,16,20].map(offset=>api.pdfium.getValue(p+offset,"float"));
        const points:{type:number;x:number;y:number;close:boolean}[]=[];const count=api.FPDFPath_CountSegments(object);
        if(count<0||count>10000)continue;
        for(let j=0;j<count;j++){const segment=api.FPDFPath_GetPathSegment(object,j);if(!segment||!api.FPDFPathSegment_GetPoint(segment,p+24,p+28))continue;const x=api.pdfium.getValue(p+24,"float"),y=api.pdfium.getValue(p+28,"float");points.push({type:api.FPDFPathSegment_GetType(segment),x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5],close:api.FPDFPathSegment_GetClose(segment)});}
        const commands:string[]=[];
        for(let j=0;j<points.length;j++){const q=points[j];if(q.type===2)commands.push(`M ${q.x} ${q.y}`);else if(q.type===0)commands.push(`L ${q.x} ${q.y}`);else if(q.type===1&&points[j+1]?.type===1&&points[j+2]?.type===1){const a=points[++j],b=points[++j];commands.push(`C ${q.x} ${q.y} ${a.x} ${a.y} ${b.x} ${b.y}`);if(b.close)commands.push("Z");continue;}if(q.close)commands.push("Z");}
        path=commands.join(" ");if(api.FPDFPath_GetDrawMode(object,p+24,p+28))fill=api.pdfium.getValue(p+24,"i32")!==0;
      }
      result.push({index,type,bounds,...(path?{path}:{}),...(fill?{fill}:{})});
    }return result;}finally{api.pdfium.wasmExports.free(p);}
  }));
}

/** Move only the placements explicitly selected by the user, in one PDF revision. */
export function moveGraphicObjects(api:WrappedPdfiumModule,bytes:Uint8Array,pageIndex:number,graphics:PdfGraphicObject[],images:PdfImageObject[],dx:number,dy:number):Uint8Array {
  if(!graphics.length&&!images.length)throw new Error("Select a drawing or image.");
  if(![dx,dy].every(Number.isFinite)||Math.abs(dx)>10000||Math.abs(dy)>10000)throw new Error("That position is not valid.");
  const now=inspectGraphicObjects(api,bytes,pageIndex),pictures=inspectImageObjects(api,bytes,pageIndex);
  if(graphics.some(item=>JSON.stringify(now.find(found=>found.index===item.index))!==JSON.stringify(item))||images.some(item=>JSON.stringify(pictures.find(found=>found.index===item.index))!==JSON.stringify(item)))throw new Error("The document changed. Select the objects again.");
  return withDocument(api,bytes,doc=>{withPage(api,doc,pageIndex,(page,_text,release)=>{const handles=[...graphics,...images].map(item=>api.FPDFPage_GetObject(page,item.index));if(handles.some(handle=>!handle))throw new Error("An object is no longer available.");release();for(const object of handles){api.FPDFPageObj_Transform(object,1,0,0,1,dx,dy);api.FPDFPageObj_TransformClipPath(object,1,0,0,1,dx,dy);}if(!api.FPDFPage_GenerateContent(page))throw new Error("Couldn't move the selected objects.");});return saveDocument(api,doc);});
}

/** Count text and images inside Form XObjects, which this editor cannot safely rewrite yet. */
export function inspectNestedContent(api: WrappedPdfiumModule, bytes: Uint8Array, pageIndex: number): { text: number; images: number } {
  return withDocument(api, bytes, doc => withPage(api, doc, pageIndex, page => {
    const result = { text: 0, images: 0 };
    let budget = 10000;
    const visit = (form: number, depth: number) => {
      if (depth > 8 || budget <= 0) return;
      const count = Math.max(0, api.FPDFFormObj_CountObjects(form));
      for (let index = 0; index < count && budget-- > 0; index++) {
        const item = api.FPDFFormObj_GetObject(form, index), type = api.FPDFPageObj_GetType(item);
        if (type === 1) result.text++;
        else if (type === 3) result.images++;
        else if (type === 5) visit(item, depth + 1);
      }
    };
    for (let index = 0, count = api.FPDFPage_CountObjects(page); index < count && budget > 0; index++) {
      const object = api.FPDFPage_GetObject(page, index);
      if (api.FPDFPageObj_GetType(object) === 5) visit(object, 1);
    }
    return result;
  }));
}

export function imageDimensions(bytes: Uint8Array, isPng: boolean): [number, number] | null {
  if (isPng) {
    if (bytes.length < 24 || bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return [view.getUint32(16), view.getUint32(20)];
  }
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 255) return null;
    while (offset < bytes.length && bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const size = bytes[offset] * 256 + bytes[offset + 1];
    if (size < 2 || offset + size > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (size < 7) return null;
      return [bytes[offset + 5] * 256 + bytes[offset + 6], bytes[offset + 3] * 256 + bytes[offset + 4]];
    }
    offset += size;
  }
  return null;
}

/** Give the selected placement an unambiguous temporary marker for resource editing. */
export function markImagePlacement(api:WrappedPdfiumModule,bytes:Uint8Array,pageIndex:number,expected:PdfImageObject,marker:string):{bytes:Uint8Array;ordinal:number} {
  if(!/^ZionPdfImage[A-Za-z0-9]+$/.test(marker))throw new Error("Invalid image edit marker.");
  const current=inspectImageObjects(api,bytes,pageIndex).find(item=>item.index===expected.index);
  if(JSON.stringify(current)!==JSON.stringify(expected))throw new Error("The document changed. Select the image again.");
  let ordinal=0;
  const output=withDocument(api,bytes,doc=>{
    withPage(api,doc,pageIndex,(page,_text,release)=>{
      release();
      const object=api.FPDFPage_GetObject(page,expected.index);
      const mark=api.FPDFPageObj_AddMark(object,marker);
      if(!mark)throw new Error("Couldn't prepare the image edit.");
      // PDFium can share a mark list across a whole group. Count this placement within that list.
      for(let i=0;i<expected.index;i++){
        const previous=api.FPDFPage_GetObject(page,i),type=api.FPDFPageObj_GetType(previous);
        if(type!==3&&type!==5)continue;
        for(let j=0;j<api.FPDFPageObj_CountMarks(previous);j++)if(api.FPDFPageObj_GetMark(previous,j)===mark){ordinal++;break;}
      }
      if(!api.FPDFPage_GenerateContent(page))throw new Error("Couldn't prepare the image edit.");
    });
    return saveDocument(api,doc);
  });
  return {bytes:output,ordinal};
}

/** Modify one top-level placement; never alter or replace its shared image resource. */
export function editImageObject(api: WrappedPdfiumModule, bytes: Uint8Array, pageIndex: number, expected: PdfImageObject,
  action: { kind: "resize"; bounds: [number, number, number, number] } | { kind: "delete"; removeTagged?:boolean } | { kind: "duplicate" } | { kind: "move"; dx: number; dy: number } | { kind: "transform"; operation: ImageTransform }
    | { kind: "replace"; bytes: Uint8Array }): Uint8Array {
  const current = inspectImageObjects(api, bytes, pageIndex).find(item => item.index === expected.index);
  if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error("The document changed. Select the image again.");
  if (action.kind === "move" && (![action.dx, action.dy].every(Number.isFinite) || Math.abs(action.dx) > 10000 || Math.abs(action.dy) > 10000))
    throw new Error("That image position is not valid.");
  const png = action.kind === "replace" && action.bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => action.bytes[index] === value);
  const jpeg = action.kind === "replace" && action.bytes.length >= 3 && action.bytes[0] === 255 && action.bytes[1] === 216 && action.bytes[2] === 255;
  if (action.kind === "replace" && (action.bytes.length > 25 * 1024 * 1024 || (!png && !jpeg))) throw new Error("Choose a PNG or JPEG image smaller than 25 MB.");
  if (action.kind === "replace") {
    const size = imageDimensions(action.bytes, !!png);
    if (!size || size[0] <= 0 || size[1] <= 0 || size[0] > 10000 || size[1] > 10000 || size[0] * size[1] > 20_000_000)
      throw new Error("The image dimensions are too large or invalid.");
  }
  let desired = [...expected.matrix];
  let clipTransform = [1, 0, 0, 1, 0, 0];
  let replacementSize: [number, number] | undefined;
  let originalJpeg: Uint8Array | undefined;
  if (action.kind === "resize") {
    const [l, b, r, t] = action.bounds, [ol, ob, or, ot] = expected.bounds;
    if (![l,b,r,t].every(Number.isFinite) || r-l < 2 || t-b < 2 || r-l > 10000 || t-b > 10000) throw new Error("Invalid image size.");
    const sx = (r-l)/(or-ol), sy = (t-b)/(ot-ob);
    clipTransform = [sx, 0, 0, sy, l-ol*sx, b-ob*sy];
    desired = [desired[0]*sx, desired[1]*sy, desired[2]*sx, desired[3]*sy, l+(desired[4]-ol)*sx, b+(desired[5]-ob)*sy];
  }
  if (action.kind === "move") { desired[4] += action.dx; desired[5] += action.dy; clipTransform = [1,0,0,1,action.dx,action.dy]; }
  if (action.kind === "duplicate") { desired[4] += 12; desired[5] -= 12; }
  if (action.kind === "transform") {
    const [left, bottom, right, top] = expected.bounds, cx = (left + right) / 2, cy = (bottom + top) / 2;
    const transform: Record<ImageTransform, [number, number, number, number]> = {
      "rotate-right": [0, 1, -1, 0], "flip-horizontal": [-1, 0, 0, 1], smaller: [0.9, 0, 0, 0.9], larger: [1.1, 0, 0, 1.1],
    };
    const coefficients = transform[action.operation];
    if (!coefficients) throw new Error("That image transformation is not supported.");
    const [a, c, b, d] = coefficients, [x0, y0, x1, y1, x, y] = expected.matrix;
    clipTransform = [a,b,c,d,cx-a*cx-c*cy,cy-b*cx-d*cy];
    desired = [a * x0 + c * y0, b * x0 + d * y0, a * x1 + c * y1, b * x1 + d * y1,
      cx + a * (x - cx) + c * (y - cy), cy + b * (x - cx) + d * (y - cy)];
  }
  const output = withDocument(api, bytes, doc => {
    withPage(api, doc, pageIndex, (page, _textPage, releaseText) => {
      const object = api.FPDFPage_GetObject(page, expected.index);
      if (!object || api.FPDFPageObj_GetType(object) !== 3) throw new Error("The image is no longer available.");
      const clip = api.FPDFPageObj_GetClipPath(object);
      // Replacement of existing cropped placements uses replaceImagePlacement, retaining native clip commands.
      if ((action.kind==="duplicate" || action.kind==="replace") && clip && api.FPDFClipPath_CountPaths(clip)>0) throw new Error(action.kind==="duplicate"?"Only uncropped, untagged, opaque JPEG images can be duplicated yet.":"The replacement must preserve this image's crop.");
      if (action.kind === "duplicate") {
        if (simpleMark(api, object) !== null || api.FPDFPageObj_HasTransparency(object)
          || !expected.pixelSize || expected.pixelSize[0] * expected.pixelSize[1] > 20_000_000)
          throw new Error("Only untagged, opaque JPEG images can be duplicated yet.");
        const info = api.pdfium.wasmExports.malloc(512);
        if (!info) throw new Error("Not enough memory to inspect the image.");
        try {
          const hasProfile = api.FPDFImageObj_GetIccProfileDataDecoded(object, page, 0, 0, info);
          const filterLength = api.FPDFImageObj_GetImageFilter(object, 0, info, 512);
          if (hasProfile || api.FPDFImageObj_GetImageFilterCount(object) !== 1
            || filterLength <= 0 || filterLength > 512 || api.pdfium.UTF8ToString(info) !== "DCTDecode")
            throw new Error("Only untagged, opaque JPEG images can be duplicated yet.");
        } finally { api.pdfium.wasmExports.free(info); }
        const length = api.FPDFImageObj_GetImageDataRaw(object, 0, 0);
        if (!length || length > 25 * 1024 * 1024) throw new Error("The image is too large to duplicate.");
        const dataPtr = api.pdfium.wasmExports.malloc(length), matrixPtr = api.pdfium.wasmExports.malloc(24);
        const duplicate = api.FPDFPageObj_NewImageObj(doc);
        if (!dataPtr || !matrixPtr || !duplicate) {
          if (dataPtr) api.pdfium.wasmExports.free(dataPtr);
          if (matrixPtr) api.pdfium.wasmExports.free(matrixPtr);
          if (duplicate) api.FPDFPageObj_Destroy(duplicate);
          throw new Error("Not enough memory to duplicate the image.");
        }
        let owned = true;
        try {
          if (api.FPDFImageObj_GetImageDataRaw(object, dataPtr, length) !== length) throw new Error("Couldn't read the original image.");
          originalJpeg = heap(api).slice(dataPtr, dataPtr + length);
          if (!api.EPDFImageObj_SetJpeg(page, 0, duplicate, dataPtr, length)) throw new Error("Couldn't duplicate the image.");
          for (let index = 0; index < 6; index++) api.pdfium.setValue(matrixPtr + 4 * index, desired[index], "float");
          if (!api.FPDFPageObj_SetMatrix(duplicate, matrixPtr)) throw new Error("Couldn't position the image copy.");
          releaseText();
          if (!api.FPDFPage_InsertObjectAtIndex(page, duplicate, expected.index + 1)) throw new Error("Couldn't insert the image copy.");
          owned = false;
        } finally {
          api.pdfium.wasmExports.free(dataPtr); api.pdfium.wasmExports.free(matrixPtr);
          if (owned) api.FPDFPageObj_Destroy(duplicate);
        }
      } else if (action.kind === "replace") {
        const mark = simpleMark(api, object);
        if (mark === undefined || api.FPDFPageObj_HasTransparency(object)) throw new Error("This image's effects or tags are not supported for replacement yet.");
        const replacement = api.FPDFPageObj_NewImageObj(doc);
        if (!replacement) throw new Error("Couldn't prepare the replacement image.");
        let owned = true;
        const dataPtr = api.pdfium.wasmExports.malloc(action.bytes.length), matrixPtr = api.pdfium.wasmExports.malloc(24);
        if (!dataPtr || !matrixPtr) {
          if (dataPtr) api.pdfium.wasmExports.free(dataPtr);
          if (matrixPtr) api.pdfium.wasmExports.free(matrixPtr);
          api.FPDFPageObj_Destroy(replacement);
          throw new Error("Not enough memory to replace the image.");
        }
        try {
          heap(api).set(action.bytes, dataPtr);
          const loaded = png ? api.EPDFImageObj_SetPng(page, 0, replacement, dataPtr, action.bytes.length)
            : api.EPDFImageObj_SetJpeg(page, 0, replacement, dataPtr, action.bytes.length);
          if (!loaded) throw new Error("Couldn't read the replacement image.");
          for (let index = 0; index < 6; index++) api.pdfium.setValue(matrixPtr + 4 * index, expected.matrix[index], "float");
          if (!api.FPDFPageObj_SetMatrix(replacement, matrixPtr)) throw new Error("Couldn't preserve the image position.");
          if (!api.FPDFImageObj_GetImagePixelSize(replacement, matrixPtr, matrixPtr + 4)) throw new Error("Couldn't verify the image dimensions.");
          replacementSize = [api.pdfium.getValue(matrixPtr, "i32"), api.pdfium.getValue(matrixPtr + 4, "i32")];
          if (replacementSize[0] <= 0 || replacementSize[1] <= 0 || replacementSize[0] * replacementSize[1] > 20_000_000)
            throw new Error("The image dimensions are too large or invalid.");
          if (mark) {
            const newMark = api.FPDFPageObj_AddMark(replacement, mark.name);
            if (!newMark || !api.FPDFPageObjMark_SetIntParam(doc, replacement, newMark, "MCID", mark.id)) throw new Error("Couldn't preserve the image's document structure.");
          }
          releaseText();
          if (!api.FPDFPage_RemoveObject(page, object)) throw new Error("Couldn't replace the original image.");
          api.FPDFPageObj_Destroy(object);
          if (!api.FPDFPage_InsertObjectAtIndex(page, replacement, expected.index)) throw new Error("Couldn't insert the replacement image.");
          owned = false;
        } finally {
          api.pdfium.wasmExports.free(dataPtr); api.pdfium.wasmExports.free(matrixPtr);
          if (owned) api.FPDFPageObj_Destroy(replacement);
        }
      } else if (action.kind === "delete") {
        const mark=simpleMark(api,object);if(mark!==null&&!nonStructuralMarks(api,object)&&(!action.removeTagged||mark===undefined))throw new Error("This image's accessibility tags could not be updated safely.");
        releaseText();
        if (!api.FPDFPage_RemoveObject(page, object)) throw new Error("Couldn't remove the image.");
        api.FPDFPageObj_Destroy(object);
      } else {
        const ptr = api.pdfium.wasmExports.malloc(24);
        if (!ptr) throw new Error("Not enough memory to move the image.");
        try {
          if (!api.FPDFPageObj_GetMatrix(object, ptr)) throw new Error("Couldn't read the image position.");
          for (let index = 0; index < 6; index++) api.pdfium.setValue(ptr + 4 * index, desired[index], "float");
          if (!api.FPDFPageObj_SetMatrix(object, ptr)) throw new Error("Couldn't move the image.");
          api.FPDFPageObj_TransformClipPath(object,clipTransform[0],clipTransform[1],clipTransform[2],clipTransform[3],clipTransform[4],clipTransform[5]);
        } finally { api.pdfium.wasmExports.free(ptr); }
      }
      if (!api.FPDFPage_GenerateContent(page)) throw new Error("Couldn't update the page.");
    });
    const writer = api.PDFiumExt_OpenFileWriter();
    if (!writer) throw new Error("Couldn't prepare the PDF copy.");
    try {
      if (!api.PDFiumExt_SaveAsCopy(doc, writer)) throw new Error("Couldn't save the PDF copy.");
      const size = api.PDFiumExt_GetFileWriterSize(writer);
      if (!size) throw new Error("Couldn't prepare the PDF copy.");
      const ptr = api.pdfium.wasmExports.malloc(size);
      if (!ptr) throw new Error("Couldn't allocate the PDF copy.");
      try {
        if (api.PDFiumExt_GetFileWriterData(writer, ptr, size) !== size) throw new Error("Couldn't read the PDF copy.");
        return heap(api).slice(ptr, ptr + size);
      } finally { api.pdfium.wasmExports.free(ptr); }
    } finally { api.PDFiumExt_CloseFileWriter(writer); }
  });
  const images = inspectImageObjects(api, output, pageIndex);
  const verified = action.kind === "delete" ? images.length === inspectImageObjects(api, bytes, pageIndex).length - 1
    : images.some(image => image.matrix.every((value, index) => Math.abs(value - desired[index]) < 0.01)
      && (action.kind !== "replace" || (replacementSize && image.pixelSize?.[0] === replacementSize[0] && image.pixelSize?.[1] === replacementSize[1])));
  if (!verified) throw new Error("The edited image couldn't be verified in the saved copy.");
  if (action.kind === "duplicate") {
    const duplicate = images.find(image => image.matrix.every((value, index) => Math.abs(value - desired[index]) < 0.01));
    const preserved = duplicate && withDocument(api, output, doc => withPage(api, doc, pageIndex, page => {
      const object = api.FPDFPage_GetObject(page, duplicate.index), length = api.FPDFImageObj_GetImageDataRaw(object, 0, 0);
      if (!originalJpeg || length !== originalJpeg.length) return false;
      const ptr = api.pdfium.wasmExports.malloc(length);
      if (!ptr) return false;
      try {
        return api.FPDFImageObj_GetImageDataRaw(object, ptr, length) === length
          && originalJpeg.every((value, index) => heap(api)[ptr + index] === value);
      } finally { api.pdfium.wasmExports.free(ptr); }
    }));
    if (!preserved || images.length !== inspectImageObjects(api, bytes, pageIndex).length + 1) throw new Error("The image copy could not be verified.");
  }
  return output;
}

export function inspectTextObjects(api: WrappedPdfiumModule, bytes: Uint8Array, pageIndex: number): PdfTextObject[] {
  return withDocument(api, bytes, doc => withPage(api, doc, pageIndex, (page, textPage) => {
    const result: PdfTextObject[] = [];
    for (let index = 0, count = api.FPDFPage_CountObjects(page); index < count; index++) {
      const object = api.FPDFPage_GetObject(page, index);
      if (api.FPDFPageObj_GetType(object) !== 1) continue;
      const text = objectText(api, object, textPage);
      if (text) result.push({ index, text, bounds: objectBounds(api, object) });
    }
    return result;
  }));
}

/** Group consecutive, equally styled horizontal glyph objects into words; never cross other page objects. */
export function inspectTextGroups(api: WrappedPdfiumModule, bytes: Uint8Array, pageIndex: number, line = false): PdfTextObject[] {
  return withDocument(api, bytes, doc => withPage(api, doc, pageIndex, (page, textPage) => {
    const items: Array<Omit<PdfTextObject, "color"> & { font: number; size: number; matrix: number[]; color: number[]; simple: boolean; mark: ReturnType<typeof simpleMark> }> = [];
    const ptr = api.pdfium.wasmExports.malloc(44);
    if (!ptr) throw new Error("Not enough memory to inspect text.");
    try {
      for (let index = 0, count = api.FPDFPage_CountObjects(page); index < count; index++) {
        const object = api.FPDFPage_GetObject(page, index);
        if (api.FPDFPageObj_GetType(object) !== 1) continue;
        const text = objectText(api, object, textPage);
        if (!text) continue;
        const mark = simpleMark(api, object);
        const fontInfo = api.FPDFTextObj_GetFontSize(object, ptr) && api.FPDFPageObj_GetMatrix(object, ptr + 4);
        const paintMode=api.FPDFTextObj_GetTextRenderMode(object);
        const colorInfo = (paintMode===1 || paintMode===5) ? api.FPDFPageObj_GetStrokeColor(object,ptr+28,ptr+32,ptr+36,ptr+40) : api.FPDFPageObj_GetFillColor(object, ptr + 28, ptr + 32, ptr + 36, ptr + 40);
        const simple = fontInfo && colorInfo && api.FPDFTextObj_GetTextRenderMode(object) === 0 && mark !== undefined;
        const matrix = fontInfo ? [4, 8, 12, 16, 20, 24].map(offset => api.pdfium.getValue(ptr + offset, "float")) : [];
        items.push({ index, text, bounds: objectBounds(api, object), font: api.FPDFTextObj_GetFont(object),
          size: fontInfo ? api.pdfium.getValue(ptr, "float") : 0, matrix,
          color: colorInfo ? [28, 32, 36, 40].map(offset => api.pdfium.getValue(ptr + offset, "i32")) : [], mark,
          simple: !!simple && matrix[0] > 0 && matrix[3] > 0 && Math.abs(matrix[1]) < 0.0001 && Math.abs(matrix[2]) < 0.0001 });
      }
    } finally { api.pdfium.wasmExports.free(ptr); }
    const groups: PdfTextObject[] = [];
    let previous: typeof items[number] | undefined;
    for (const item of items) {
      const last = groups[groups.length - 1];
      const gap = previous ? item.bounds[0] - previous.bounds[2] : Infinity;
      const join = previous && last && previous.simple && item.simple && item.index === previous.index + 1
        && previous.font === item.font && Math.abs(previous.size - item.size) < 0.01
        && JSON.stringify(previous.mark) === JSON.stringify(item.mark)
        && previous.color.every((value, i) => value === item.color[i])
        && [0, 1, 2, 3, 5].every(i => Math.abs(previous!.matrix[i] - item.matrix[i]) < 0.05)
        && gap >= -previous.size * 0.15 && gap <= previous.size * (line ? 0.7 : 0.3)
        && (line || (!/\s$/.test(previous.text) && !/^\s/.test(item.text)));
      const namePtr = api.pdfium.wasmExports.malloc(256);
      let fontName = "";
      try { const size = api.FPDFFont_GetBaseFontName(item.font, namePtr, 256); if (size && size <= 256) fontName = api.pdfium.UTF8ToString(namePtr); }
      finally { api.pdfium.wasmExports.free(namePtr); }
      const member = { index: item.index, text: item.text, bounds: item.bounds, fontName, fontSize: item.size, fontScale: item.matrix.length ? Math.hypot(item.matrix[1],item.matrix[3]) : 1, fontScaleX: item.matrix.length ? Math.hypot(item.matrix[0],item.matrix[2]) : 1, color: "#"+item.color.slice(0,3).map(value => value.toString(16).padStart(2,"0")).join("") };
      if (join) {
        last.members!.push(member);
        last.text = line ? (last.text + item.text).replace(/[ \t]+/g, " ") : last.text + item.text;
        last.bounds = [Math.min(last.bounds[0], item.bounds[0]), Math.min(last.bounds[1], item.bounds[1]),
          Math.max(last.bounds[2], item.bounds[2]), Math.max(last.bounds[3], item.bounds[3])];
      } else groups.push({ ...member, bounds: [...member.bounds], members: [member], ...(line ? { granularity: "line" as const } : {}) });
      previous = item;
    }
    const underlines: PdfTextObject["bounds"][] = [];
    const rectPtr=api.pdfium.wasmExports.malloc(16);
    try { for(let i=0;i<api.FPDFPage_GetAnnotCount(page);i++) {const annot=api.FPDFPage_GetAnnot(page,i);try {if(api.FPDFAnnot_GetSubtype(annot)===10 && api.FPDFAnnot_GetRect(annot,rectPtr)) {const [l,t,r,b]=[0,4,8,12].map(offset=>api.pdfium.getValue(rectPtr+offset,"float"));underlines.push([l,b,r,t]);}}finally{api.FPDFPage_CloseAnnot(annot);}} }
    finally {api.pdfium.wasmExports.free(rectPtr);}
    for(const group of groups)group.underline=underlines.some(box=>box[0]<=group.bounds[0]+1&&box[2]>=group.bounds[2]-1&&box[1]<=group.bounds[1]+2&&box[3]>=group.bounds[3]-2);
    return groups;
  }));
}

function verticalRoom(api: WrappedPdfiumModule, page: number, expected: PdfTextObject): [number,number] {
  let bottom=0,top=api.FPDF_GetPageHeightF(page);
  const selected=new Set((expected.members || [expected]).map(item=>item.index));
  for(let i=0;i<api.FPDFPage_CountObjects(page);i++) {
    if(selected.has(i))continue;
    const object=api.FPDFPage_GetObject(page,i); if(![1,3].includes(api.FPDFPageObj_GetType(object)))continue;
    const box=objectBounds(api,object);
    if(box[2]<=expected.bounds[0] || box[0]>=expected.bounds[2])continue;
    if(box[1]>=expected.bounds[3]-.1)top=Math.min(top,box[1]-.5);
    if(box[3]<=expected.bounds[1]+.1)bottom=Math.max(bottom,box[3]+.5);
  }
  return [bottom,top];
}

/** Group adjacent lines with matching typography and a shared column. */
export function inspectParagraphs(api: WrappedPdfiumModule, bytes: Uint8Array, pageIndex: number): PdfTextObject[] {
  const lines=inspectTextGroups(api,bytes,pageIndex,true);
  const barriers=withDocument(api,bytes,doc=>withPage(api,doc,pageIndex,page=>{const boxes:PdfTextObject["bounds"][]=[];for(let i=0;i<api.FPDFPage_CountObjects(page);i++){const object=api.FPDFPage_GetObject(page,i),type=api.FPDFPageObj_GetType(object);if(![2,3,5].includes(type))continue;const box=objectBounds(api,object),width=box[2]-box[0],height=box[3]-box[1];if(type!==2||width<3||height<3)boxes.push(box);}return boxes;}));
  return groupParagraphLines(lines,barriers);
}

/** Rewrite a supported text run without overwriting its surrounding page content. */
export function replaceTextObject(api: WrappedPdfiumModule, bytes: Uint8Array, pageIndex: number,
  expected: PdfTextObject, replacement: string, fontBytes?: Uint8Array, formatting: TextFormatting = {}): Uint8Array {
  for(const [value,min,max,label] of [[formatting.lineHeight,.5,4,"line spacing"],[formatting.paragraphSpacing,0,40,"paragraph spacing"]] as const) {
    if(value !== undefined && (!Number.isFinite(value) || value < min || value > max)) throw new Error(`Choose valid ${label} between ${min} and ${max}.`);
  }
  if (expected.granularity === "paragraph" && expected.lines) {
    const current = inspectParagraphs(api, bytes, pageIndex).find(item => item.index === expected.index);
    if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error("The document changed. Select the paragraph again.");
    const lines = expected.lines;
    // Keep the existing paragraph footprint; never cover the next section.
    const capacity = Math.max(1, Math.floor(Math.max(...lines.map(line => line.text.length)) / ((formatting.fontSize || lines[0].fontSize || 12)/(lines[0].fontSize || 12)) / ((formatting.horizontalScale || 100)/100)));
    const wrapped: string[] = [];
    for (const paragraph of replacement.split("\n")) {
      let row = "";
      for (const word of paragraph.split(/\s+/)) {
        if (row && row.length + word.length + 1 > capacity) { wrapped.push(row); row = word; }
        else row += (row ? " " : "") + word;
      }
      wrapped.push(row);
    }
    if (wrapped.length > lines.length) throw new Error("The paragraph needs more space. Shorten the text or use a smaller selection.");
    let output = bytes;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = inspectTextGroups(api, output, pageIndex, true).find(item => Math.abs(item.bounds[0] - lines[i].bounds[0]) < .1 && Math.abs(item.bounds[1] - lines[i].bounds[1]) < .1);
      if (!line) throw new Error("Couldn't locate the paragraph line.");
      const lineGap = formatting.lineHeight ? formatting.lineHeight * (formatting.fontSize || line.fontSize || 12) * (line.fontScale || 1) : undefined;
      const offsetY = lineGap === undefined ? 0 : lines[0].bounds[3] - line.bounds[3] - i * lineGap;
      output = replaceTextObject(api, output, pageIndex, line, wrapped[i] || "", fontBytes, {...formatting, region: expected.bounds, offsetY: offsetY - (formatting.paragraphSpacing || 0) * i});
    }
    return output;
  }
  if (replacement && (!/^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{P}\p{N}\p{Zs}]+$/u.test(replacement)
    || [...replacement].some(char => char.codePointAt(0)! > 0xffff)))
    throw new Error("This edit requires characters or formatting the editor doesn't support yet.");
  if (fontBytes && (!embeddingRights(fontBytes).editable || ![0x00010000, 0x4f54544f].includes(new DataView(fontBytes.buffer, fontBytes.byteOffset, fontBytes.byteLength).getUint32(0))))
    throw new Error("Choose a TrueType font that permits editable embedding.");
  if (fontBytes && !hasFontCharacters(fontBytes, replacement)) throw new Error("The selected font doesn't contain every character.");
  if (formatting.fontSize !== undefined && !validFontSize(formatting.fontSize,expected.fontScale ?? 1))
    throw new Error("Choose a font size between 1 and 300.");
  if (formatting.color !== undefined && !/^#[0-9a-f]{6}$/i.test(formatting.color)) throw new Error("Choose a valid text color.");
  if (expected.members?.length && JSON.stringify(inspectTextGroups(api, bytes, pageIndex, expected.granularity === "line").find(group => group.index === expected.index)) !== JSON.stringify(expected))
    throw new Error("The document changed. Select the text again.");
  const result = withDocument(api, bytes, doc => {
    withPage(api, doc, pageIndex, (page, textPage, releaseText) => {
      const object = api.FPDFPage_GetObject(page, expected.index);
      const members = expected.members ?? [expected];
      if (!object || api.FPDFPageObj_GetType(object) !== 1 || objectText(api, object, textPage) !== members[0].text)
        throw new Error("The document changed. Select the text again.");
      if (replacement && !fontBytes) {
        const missing = new Set([...replacement]);
        const sourceFont = api.FPDFTextObj_GetFont(object);
        for (let index = 0, count = api.FPDFPage_CountObjects(page); index < count && missing.size; index++) {
          const candidate = api.FPDFPage_GetObject(page, index);
          if (api.FPDFPageObj_GetType(candidate) !== 1 || api.FPDFTextObj_GetFont(candidate) !== sourceFont) continue;
          for (const char of objectText(api, candidate, textPage)) missing.delete(char);
        }
        if (missing.size) throw new Error("The original font may not contain every character. Choose a device font.");
      }
      requireSimpleTransform(api, object);
      const old = expected.bounds;
      const rightLimit = availableRight(api, page, expected);
      const [bottomLimit,topLimit] = verticalRoom(api,page,expected);
      if (objectBounds(api, object).some((value, i) => Math.abs(value - members[0].bounds[i]) > 0.01)) throw new Error("The text position changed. Select it again.");
      if (!replacement) {
        if (members.some(member => simpleMark(api, api.FPDFPage_GetObject(page, member.index)) !== null))
          throw new Error("Deleting tagged text is not supported yet.");
        releaseText();
        for (const member of [...members].reverse()) {
          const removed = api.FPDFPage_GetObject(page, member.index);
          if (!removed || !api.FPDFPage_RemoveObject(page, removed)) throw new Error("Couldn't delete the original text.");
          api.FPDFPageObj_Destroy(removed);
        }
        if (!api.FPDFPage_GenerateContent(page)) throw new Error("Couldn't update the page.");
        return;
      }
      let target = object;
      let owned = false;
      let font = 0;
      const needsNewObject = !!fontBytes || formatting.fontSize !== undefined;
      if (needsNewObject) {
        const mark = simpleMark(api, object);
        if (mark === undefined || api.FPDFTextObj_GetTextRenderMode(object) !== 0)
          throw new Error("This text's formatting is not supported for font replacement yet.");
        const info = api.pdfium.wasmExports.malloc(44);
        const fontPtr = fontBytes ? api.pdfium.wasmExports.malloc(fontBytes.byteLength) : 0;
        if (!info || (fontBytes && !fontPtr)) {
          if (info) api.pdfium.wasmExports.free(info);
          if (fontPtr) api.pdfium.wasmExports.free(fontPtr);
          throw new Error("Not enough memory to load the font.");
        }
        try {
          if (fontBytes) {
            heap(api).set(fontBytes, fontPtr);
            font = api.FPDFText_LoadFont(doc, fontPtr, fontBytes.byteLength, new DataView(fontBytes.buffer, fontBytes.byteOffset, fontBytes.byteLength).getUint32(0) === 0x4f54544f ? 1 : 2, true);
          } else font = api.FPDFTextObj_GetFont(object);
          if (!font || !api.FPDFTextObj_GetFontSize(object, info) || !api.FPDFPageObj_GetMatrix(object, info + 4)
            || !api.FPDFPageObj_GetFillColor(object, info + 28, info + 32, info + 36, info + 40))
            throw new Error("Couldn't preserve the original text formatting.");
          target = api.FPDFPageObj_CreateTextObj(doc, font, formatting.fontSize ?? api.pdfium.getValue(info, "float"));
          if (!target) throw new Error("Couldn't create text with that font.");
          owned = true;
          const rgba = [28, 32, 36, 40].map(offset => api.pdfium.getValue(info + offset, "i32"));
          if (!api.FPDFPageObj_SetMatrix(target, info + 4) || !api.FPDFPageObj_SetFillColor(target, rgba[0], rgba[1], rgba[2], rgba[3]))
            throw new Error("Couldn't preserve the original text formatting.");
          if (mark) {
            const newMark = api.FPDFPageObj_AddMark(target, mark.name);
            if (!newMark || !api.FPDFPageObjMark_SetIntParam(doc, target, newMark, "MCID", mark.id))
              throw new Error("Couldn't preserve the document's text structure.");
          }
        } catch (error) {
          if (owned) api.FPDFPageObj_Destroy(target);
          if (fontBytes && font) api.FPDFFont_Close(font);
          throw error;
        } finally { api.pdfium.wasmExports.free(info); if (fontPtr) api.pdfium.wasmExports.free(fontPtr); }
      }
      const ptr = api.pdfium.wasmExports.malloc((replacement.length + 1) * 2);
      if (!ptr) {
        if (owned) api.FPDFPageObj_Destroy(target);
        if (fontBytes && font) api.FPDFFont_Close(font);
        throw new Error("Not enough memory to edit text.");
      }
      try {
        api.pdfium.stringToUTF16(replacement, ptr, (replacement.length + 1) * 2);
        if (!api.FPDFText_SetText(target, ptr)) throw new Error("Couldn't replace the text.");
        if (formatting.color) {
          const rgba = api.pdfium.wasmExports.malloc(16);
          if (!rgba) throw new Error("Not enough memory to change the text color.");
          try {
            if (!api.FPDFPageObj_GetFillColor(target, rgba, rgba + 4, rgba + 8, rgba + 12)) throw new Error("Couldn't read the text color.");
            const alpha = api.pdfium.getValue(rgba + 12, "i32");
            const color = formatting.color;
            if (!api.FPDFPageObj_SetFillColor(target, parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), alpha))
              throw new Error("Couldn't change the text color.");
          } finally { api.pdfium.wasmExports.free(rgba); }
        }
        const next = objectBounds(api, target);
        if (next[0] < old[0] - 1 || next[1] < bottomLimit - .1 || next[2] > rightLimit + 0.1 || next[3] > topLimit + .1)
          throw new Error("The replacement doesn't fit the available space.");
        if (members.length > 1) {
          releaseText();
          for (const member of members.slice(1).reverse()) {
            const other = api.FPDFPage_GetObject(page, member.index);
            if (!other || !api.FPDFPage_RemoveObject(page, other)) throw new Error("Couldn't replace the original text.");
            api.FPDFPageObj_Destroy(other);
          }
        }
        if (needsNewObject) {
          releaseText();
          if (!api.FPDFPage_RemoveObject(page, object)) throw new Error("Couldn't replace the original text.");
          api.FPDFPageObj_Destroy(object);
          if (!api.FPDFPage_InsertObjectAtIndex(page, target, expected.index)) throw new Error("Couldn't insert the replacement text.");
          owned = false;
        }
        if (!api.FPDFPage_GenerateContent(page)) throw new Error("Couldn't update the page.");
      } finally {
        api.pdfium.wasmExports.free(ptr);
        if (owned) api.FPDFPageObj_Destroy(target);
        if (fontBytes && font) api.FPDFFont_Close(font);
      }
    });
    const writer = api.PDFiumExt_OpenFileWriter();
    if (!writer) throw new Error("Couldn't prepare the PDF copy.");
    try {
      if (!api.PDFiumExt_SaveAsCopy(doc, writer)) throw new Error("Couldn't save the PDF copy.");
      const size = api.PDFiumExt_GetFileWriterSize(writer);
      if (!size) throw new Error("Couldn't prepare the PDF copy.");
      const ptr = api.pdfium.wasmExports.malloc(size);
      if (!ptr) throw new Error("Couldn't allocate the PDF copy.");
      try {
        if (api.PDFiumExt_GetFileWriterData(writer, ptr, size) !== size) throw new Error("Couldn't read the PDF copy.");
        return heap(api).slice(ptr, ptr + size);
      } finally { api.pdfium.wasmExports.free(ptr); }
    } finally { api.PDFiumExt_CloseFileWriter(writer); }
  });
  const outputObjects = inspectTextObjects(api, result, pageIndex);
  const nearOriginal = (item: PdfTextObject) => Math.abs(item.bounds[0] - expected.bounds[0]) <= 1
    && (formatting.fontSize !== undefined || item.bounds[1] >= expected.bounds[1] - 1 && item.bounds[3] <= expected.bounds[3] + 1);
  const verified = replacement ? outputObjects.some(item => item.text.trimEnd() === replacement.trimEnd() && nearOriginal(item))
    : !outputObjects.some(item => item.text.trimEnd() === (expected.members?.[0].text ?? expected.text).trimEnd() && nearOriginal(item));
  if (!verified) throw new Error("The edited text couldn't be verified in the saved copy.");
  return replacement ? formatTextRun(api, result, pageIndex, expected.bounds, replacement, formatting) : result;
}

export type PageAction = "delete" | "rotate" | "flip" | "reorder";
export function editPage(api: WrappedPdfiumModule, bytes: Uint8Array, pageIndex: number, action: PageAction, target = 0): Uint8Array {
  return withDocument(api, bytes, doc => {
    const count = api.FPDF_GetPageCount(doc);
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= count) throw new Error("Invalid page.");
    if (action === "delete") {
      if (count <= 1) throw new Error("Keep at least one page in the document.");
      api.FPDFPage_Delete(doc, pageIndex);
    } else if (action === "reorder") {
      if (!Number.isInteger(target) || target < 0 || target >= count) throw new Error("Invalid destination page.");
      const ptr = api.pdfium.wasmExports.malloc(4);
      try { api.pdfium.setValue(ptr, pageIndex, "i32"); if (!api.FPDF_MovePages(doc, ptr, 1, target)) throw new Error("Couldn't reorder pages."); }
      finally { api.pdfium.wasmExports.free(ptr); }
    } else withPage(api, doc, pageIndex, (page, _text, release) => {
      release();
      if (action === "rotate") api.FPDFPage_SetRotation(page, (api.FPDFPage_GetRotation(page) + 1) % 4);
      else {
        const ptr = api.pdfium.wasmExports.malloc(40);
        try {
          if (!api.FPDFPage_GetCropBox(page, ptr+24,ptr+28,ptr+32,ptr+36) && !api.FPDFPage_GetMediaBox(page,ptr+24,ptr+28,ptr+32,ptr+36)) throw new Error("Couldn't read page bounds.");
          const sum = api.pdfium.getValue(ptr+24,"float") + api.pdfium.getValue(ptr+32,"float");
          [-1,0,0,1,sum,0].forEach((v,i) => api.pdfium.setValue(ptr+i*4,v,"float"));
          if (!api.FPDFPage_TransFormWithClip(page, ptr, 0)) throw new Error("Couldn't flip the page.");
          api.FPDFPage_TransformAnnots(page,-1,0,0,1,sum,0);
        } finally { api.pdfium.wasmExports.free(ptr); }
      }
    });
    const writer = api.PDFiumExt_OpenFileWriter();
    if (!writer) throw new Error("Couldn't prepare the PDF copy.");
    try {
      if (!api.PDFiumExt_SaveAsCopy(doc,writer)) throw new Error("Couldn't save the page changes.");
      const size = api.PDFiumExt_GetFileWriterSize(writer), ptr = api.pdfium.wasmExports.malloc(size);
      if (!ptr) throw new Error("Not enough memory.");
      try { if (api.PDFiumExt_GetFileWriterData(writer,ptr,size) !== size) throw new Error("Couldn't read page changes."); return heap(api).slice(ptr,ptr+size); }
      finally { api.pdfium.wasmExports.free(ptr); }
    } finally { api.PDFiumExt_CloseFileWriter(writer); }
  });
}

function saveDocument(api: WrappedPdfiumModule, doc: number): Uint8Array {
  const writer = api.PDFiumExt_OpenFileWriter();
  if (!writer) throw new Error("Couldn't create the working copy.");
  try {
    if (!api.PDFiumExt_SaveAsCopy(doc,writer)) throw new Error("Couldn't save the working copy.");
    const size = api.PDFiumExt_GetFileWriterSize(writer), ptr = api.pdfium.wasmExports.malloc(size);
    if (!ptr) throw new Error("Not enough memory.");
    try { if (api.PDFiumExt_GetFileWriterData(writer,ptr,size) !== size) throw new Error("Couldn't read the working copy."); return heap(api).slice(ptr,ptr+size); }
    finally { api.pdfium.wasmExports.free(ptr); }
  } finally { api.PDFiumExt_CloseFileWriter(writer); }
}

function formatTextRun(api: WrappedPdfiumModule, bytes: Uint8Array, index: number, bounds: PdfTextObject["bounds"], text: string, format: TextFormatting): Uint8Array {
  const {alignment,horizontalScale,tracking,underline,link,offsetY} = format;
  if (!alignment && !horizontalScale && !tracking && underline === undefined && !link && !offsetY) return bytes;
  if (horizontalScale !== undefined && (!Number.isFinite(horizontalScale) || horizontalScale < 10 || horizontalScale > 300)) throw new Error("Choose a horizontal scale between 10 and 300%.");
  if (tracking !== undefined && (!Number.isFinite(tracking) || Math.abs(tracking) > 20)) throw new Error("Choose character spacing between -20 and 20 points.");
  if (link && !/^https?:\/\//i.test(link)) throw new Error("Enter an http or https link.");
  return withDocument(api,bytes,doc => {
    withPage(api,doc,index,(page,textPage,release) => {
      let target = 0;
      for (let i=0;i<api.FPDFPage_CountObjects(page);i++) { const obj=api.FPDFPage_GetObject(page,i); if (api.FPDFPageObj_GetType(obj)===1 && objectText(api,obj,textPage).trimEnd()===text.trimEnd() && Math.abs(objectBounds(api,obj)[0]-bounds[0])<1) {target=obj;break;} }
      if (!target) throw new Error("Couldn't locate text for formatting.");
      const handles=[target], ptr=api.pdfium.wasmExports.malloc(64);
      if (!ptr) throw new Error("Not enough memory.");
      try {
        if (!api.FPDFPageObj_GetMatrix(target,ptr) || !api.FPDFTextObj_GetFontSize(target,ptr+24) || !api.FPDFPageObj_GetFillColor(target,ptr+28,ptr+32,ptr+36,ptr+40)) throw new Error("Couldn't inspect text formatting.");
        const matrix=[0,4,8,12,16,20].map(offset=>api.pdfium.getValue(ptr+offset,"float"));
        const rgba=[28,32,36,40].map(offset=>api.pdfium.getValue(ptr+offset,"i32"));
        const size=api.pdfium.getValue(ptr+24,"float"), font=api.FPDFTextObj_GetFont(target), mark=simpleMark(api,target);
        if (tracking || alignment === "justify") {
          const advances=[...text].map(char => { if (!api.FPDFFont_GetGlyphWidth(font,char.codePointAt(0)!,size,ptr+44)) throw new Error("Couldn't measure character spacing."); return api.pdfium.getValue(ptr+44,"float") * matrix[0]; });
          const region = format.region || bounds;
          const extra = alignment === "justify" && text.includes(" ") ? Math.max(0,(region[2]-region[0]-advances.reduce((a,b)=>a+b,0))/(text.match(/ /g)?.length || 1)) : 0;
          if(mark === undefined) throw new Error("Character spacing is not supported for this tagged text.");
          const targetIndex=Array.from({length:api.FPDFPage_CountObjects(page)},(_,i)=>i).find(i=>api.FPDFPage_GetObject(page,i)===target)!;
          let x=0; handles.length=0;
          for (const [i,char] of [...text].entries()) {
            const glyph=api.FPDFPageObj_CreateTextObj(doc,font,size); if (!glyph) throw new Error("Couldn't space text.");
            try {
              const cp=api.pdfium.wasmExports.malloc(8);
              try { api.pdfium.stringToUTF16(char,cp,8); if (!api.FPDFText_SetText(glyph,cp)) throw new Error("Couldn't space this character."); }
              finally {api.pdfium.wasmExports.free(cp);}
              matrix.forEach((v,j)=>api.pdfium.setValue(ptr+j*4,j===4?v+x:v,"float"));
              if (!api.FPDFPageObj_SetMatrix(glyph,ptr) || !api.FPDFPageObj_SetFillColor(glyph,...rgba as [number,number,number,number])) throw new Error("Couldn't preserve text appearance.");
              if (mark) { const next=api.FPDFPageObj_AddMark(glyph,mark.name); if (!next || !api.FPDFPageObjMark_SetIntParam(doc,glyph,next,"MCID",mark.id)) throw new Error("Couldn't preserve text tags."); }
              if(!api.FPDFPage_InsertObjectAtIndex(page,glyph,targetIndex+handles.length)) throw new Error("Couldn't preserve text order."); handles.push(glyph);
            } catch (error) { api.FPDFPageObj_Destroy(glyph); throw error; }
            x += advances[i] + (tracking || 0) + (char === " " ? extra : 0);
          }
          release(); if (!api.FPDFPage_RemoveObject(page,target)) throw new Error("Couldn't update character spacing."); api.FPDFPageObj_Destroy(target);
        }
        const region=format.region || bounds;
        const sx=(horizontalScale || 100)/100;
        for (const handle of handles) api.FPDFPageObj_Transform(handle,sx,0,0,1,region[0]*(1-sx),offsetY || 0);
        const boxes=handles.map(handle=>objectBounds(api,handle)).filter(box=>box[2]>box[0] && box[3]>box[1]);
        let box: PdfTextObject["bounds"] = [Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))];
        const shift = alignment === "center" ? (region[0]+region[2]-box[0]-box[2])/2 : alignment === "right" ? region[2]-box[2] : alignment === "left" ? region[0]-box[0] : 0;
        if (format.region && (box[1] < region[1]-.5 || box[3] > region[3]+.5)) throw new Error("The paragraph spacing does not fit this section. Reduce the spacing or font size.");
        if (box[2]+shift > availableRight(api,page,{index:-1,text:"",bounds:region,members:handles.map(handle=>({index:Array.from({length:api.FPDFPage_CountObjects(page)},(_,i)=>i).find(i=>api.FPDFPage_GetObject(page,i)===handle)!,text:"",bounds:objectBounds(api,handle)}))})+.5 || box[1]<0) throw new Error("The formatted text doesn't fit the available space.");
        if (shift) for (const handle of handles) api.FPDFPageObj_Transform(handle,1,0,0,1,shift,0);
        box=[box[0]+shift,box[1],box[2]+shift,box[3]];
        if (underline !== undefined || link) {
          for(let i=api.FPDFPage_GetAnnotCount(page)-1;i>=0;i--) {
            const annot=api.FPDFPage_GetAnnot(page,i); if(!annot)continue;
            let remove=false;
            try { if(((link && api.FPDFAnnot_GetSubtype(annot)===2) || (underline !== undefined && api.FPDFAnnot_GetSubtype(annot)===10)) && api.FPDFAnnot_GetRect(annot,ptr)) {
              const [l,t,r,b]=[0,4,8,12].map(o=>api.pdfium.getValue(ptr+o,"float"));
              remove=l>=bounds[0]-1&&r<=bounds[2]+1&&b>=bounds[1]-2&&t<=bounds[3]+2;
            }} finally {api.FPDFPage_CloseAnnot(annot);}
            if(remove)api.FPDFPage_RemoveAnnot(page,i);
          }
        }
        for (const kind of [...(underline ? [10] : []),...(link ? [2] : [])]) {
          const annot=api.FPDFPage_CreateAnnot(page,kind); if (!annot) throw new Error("Couldn't add text decoration.");
          try {
            [box[0],box[3],box[2],box[1]].forEach((v,i)=>api.pdfium.setValue(ptr+i*4,v,"float"));
            if (!api.FPDFAnnot_SetRect(annot,ptr)) throw new Error("Couldn't set the text annotation bounds.");
            api.FPDFAnnot_SetFlags(annot,4);
            if (kind === 2 && link) { const encoded=new TextEncoder().encode(link+"\0"), uri=api.pdfium.wasmExports.malloc(encoded.length); try {heap(api).set(encoded,uri);if (!api.FPDFAnnot_SetURI(annot,uri)) throw new Error("Couldn't add the link.");} finally {api.pdfium.wasmExports.free(uri);} }
            else { [box[0],box[3],box[2],box[3],box[0],box[1],box[2],box[1]].forEach((v,i)=>api.pdfium.setValue(ptr+i*4,v,"float")); if (!api.FPDFAnnot_AppendAttachmentPoints(annot,ptr) || !api.FPDFAnnot_SetColor(annot,0,...rgba as [number,number,number,number])) throw new Error("Couldn't underline text."); }
          } finally {api.FPDFPage_CloseAnnot(annot);}
        }
        if (!api.FPDFPage_GenerateContent(page)) throw new Error("Couldn't update text formatting.");
      } finally {api.pdfium.wasmExports.free(ptr);}
    });
    return saveDocument(api,doc);
  });
}

export function reorderObjects(api: WrappedPdfiumModule, bytes: Uint8Array, index: number, indices: number[], order: "front"|"forward"|"backward"|"back"): Uint8Array {
  return withDocument(api,bytes,doc=>{withPage(api,doc,index,(page,_text,release)=>{
    const count=api.FPDFPage_CountObjects(page), sorted=[...new Set(indices)].sort((a,b)=>a-b);
    if (!sorted.length || sorted.some(i=>i<0||i>=count)) throw new Error("Select an object to arrange.");
    const handles=sorted.map(i=>api.FPDFPage_GetObject(page,i));
    release(); for(const object of handles) if(!api.FPDFPage_RemoveObject(page,object)) throw new Error("Couldn't arrange this object.");
    const target=order==="front"?count-handles.length:order==="back"?0:Math.max(0,Math.min(count-handles.length,sorted[0]+(order==="forward"?1:-1)));
    handles.forEach((object,i)=>{if(!api.FPDFPage_InsertObjectAtIndex(page,object,target+i)) throw new Error("Couldn't arrange this object.");});
    if(!api.FPDFPage_GenerateContent(page)) throw new Error("Couldn't update object order.");
  });return saveDocument(api,doc);});
}

export function insertContent(api: WrappedPdfiumModule, bytes: Uint8Array, index: number, point: [number,number], imageBytes?: Uint8Array, fontBytes?: Uint8Array): Uint8Array {
  if (!point.every(Number.isFinite)) throw new Error("Choose a point on the page.");
  let imageIndex=-1;
  const result=withDocument(api,bytes,doc=>{
    withPage(api,doc,index,(page,_text,release)=>{
      release(); let object=0, font=0, ptr=0, bitmap=0;
      try {
        const x=Math.max(0,Math.min(point[0],api.FPDF_GetPageWidthF(page)-30)), y=Math.max(20,Math.min(point[1],api.FPDF_GetPageHeightF(page)-20));
        if (imageBytes) {
          const png=imageBytes[0]===137, size=imageDimensions(imageBytes,png);
          if (!size || imageBytes.length>25*1024*1024) throw new Error("Choose a valid PNG or JPEG smaller than 25 MB.");
          const width=Math.max(10,Math.min(200,api.FPDF_GetPageWidthF(page)-x)), height=Math.max(10,Math.min(api.FPDF_GetPageHeightF(page),width*size[1]/size[0]));
          object=api.FPDFPageObj_NewImageObj(doc); bitmap=api.FPDFBitmap_Create(1,1,1);
          if (!object || !bitmap || !api.FPDFImageObj_SetBitmap(0,0,object,bitmap)) throw new Error("Couldn't insert the image.");
          if (!api.FPDFImageObj_SetMatrix(object,width,0,0,height,x,Math.max(0,y-height))) throw new Error("Couldn't place the image.");
          imageIndex=api.FPDFPage_CountObjects(page);
        } else {
          if (fontBytes) {
            if (!embeddingRights(fontBytes).editable || !hasFontCharacters(fontBytes,"New text")) throw new Error("Choose a font that supports editable text.");
            ptr=api.pdfium.wasmExports.malloc(fontBytes.length); heap(api).set(fontBytes,ptr);
            font=api.FPDFText_LoadFont(doc,ptr,fontBytes.length,new DataView(fontBytes.buffer,fontBytes.byteOffset,fontBytes.byteLength).getUint32(0)===0x4f54544f?1:2,true);
            if (!font) throw new Error("Couldn't load this font.");
            object=api.FPDFPageObj_CreateTextObj(doc,font,12);
          } else object=api.FPDFPageObj_NewTextObj(doc,"Helvetica",12);
          if (!object) throw new Error("Couldn't create text.");
          const text=api.pdfium.wasmExports.malloc(18);
          try {api.pdfium.stringToUTF16("New text",text,18);if(!api.FPDFText_SetText(object,text))throw new Error("Couldn't add text.");}
          finally {api.pdfium.wasmExports.free(text);}
          api.FPDFPageObj_Transform(object,1,0,0,1,x,y);
        }
        api.FPDFPage_InsertObject(page,object); object=0;
        if (!api.FPDFPage_GenerateContent(page)) throw new Error("Couldn't insert content.");
      } finally { if(object)api.FPDFPageObj_Destroy(object); if(bitmap)api.FPDFBitmap_Destroy(bitmap); if(font)api.FPDFFont_Close(font); if(ptr)api.pdfium.wasmExports.free(ptr); }
    });return saveDocument(api,doc);
  });
  if (!imageBytes) return result;
  const image=inspectImageObjects(api,result,index).find(item=>item.index===imageIndex);
  if (!image) throw new Error("Couldn't locate the new image.");
  return editImageObject(api,result,index,image,{kind:"replace",bytes:imageBytes});
}

export { withDocument, withPage, heap, objectText, objectBounds, simpleMark, requireSimpleTransform, saveDocument };
