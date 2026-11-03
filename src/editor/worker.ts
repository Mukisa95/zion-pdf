import {inspectEditableText, textCellFont, textCellBounds, writeTextCell, moveTextCell, renderTextPreview, textCaretPositions,previewTextCell,renderObjectLayers} from "./textCells";
import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import {renderOcrTarget,convertOcrTarget,type OcrTarget,type OcrLine,type OcrBackground} from "./ocrPdf";
import {removeImageTag} from "./imageTags";
import {replaceImagePlacement} from "./imagePlacement";
import {extractWordPage} from "./wordLayout";
import { insertContent, reorderObjects, editPage, type PageAction, inspectParagraphs, inspectTextGroups, replaceTextObject, inspectImageObjects, inspectNestedContent, editImageObject, inspectGraphicObjects, moveGraphicObjects, type PdfGraphicObject, type PdfTextObject, type PdfImageObject, type TextFormatting, type ImageTransform } from "./pdfium";

type Request = { id: number; kind: "word-page" | "inspect" | "replace" | "inspect-images" | "move-image" | "delete-image" | "transform-image" | "replace-image" | "duplicate-image" | "resize-image" | "page" | "order" | "insert" | "font" | "preview-cell" | "object-layers" | "replace-cell" | "transform-text" | "move-graphics" | "ocr-render" | "ocr-convert" | "ocr-adopt"; bytes: Uint8Array; page: number;key?:string;previewRevision?:string;
  nativePassword?:string;transform?:number[];dpi?:number;ocrTarget?:OcrTarget;ocrLines?:OcrLine[];background?:OcrBackground;
  graphics?:PdfGraphicObject[]; images?:PdfImageObject[];
  logicalText?:string; width?:number; height?:number; rotation?:number; resize?:boolean; fallbackFont?:Uint8Array; point?: [number,number]; indices?: number[]; order?: "front"|"forward"|"backward"|"back"; action?: PageAction; target?: number; expected?: PdfTextObject; image?: PdfImageObject; imageBytes?: Uint8Array; dx?: number; dy?: number; operation?: ImageTransform; replacement?: string; fontBytes?: Uint8Array; formatting?: TextFormatting; bounds?: [number, number, number, number]; granularity?: "word" | "line" | "paragraph" };
let engine: Promise<WrappedPdfiumModule> | undefined;
let wordSource:Uint8Array|undefined;
let previewSource:{key:string;bytes:Uint8Array}|undefined;
function getEngine() {
  if (!engine) engine = (async () => {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error("Couldn't load the PDF editor.");
    const api = await init({ wasmBinary: await response.arrayBuffer() });
    api.PDFiumExt_Init();
    return api;
  })().catch(error => { engine = undefined; throw error; });
  return engine;
}
self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  void (async () => {
    try {
      if(request.kind==="preview-cell"&&request.previewRevision){if(request.bytes)previewSource={key:request.previewRevision,bytes:request.bytes};else if(previewSource?.key===request.previewRevision)request.bytes=previewSource.bytes;else throw new Error("The preview changed. Select the text again.");}
      const api = await getEngine();
      if(request.kind === "word-page") {
        if(request.bytes)wordSource=request.bytes;if(!wordSource)throw new Error("The export document is unavailable.");
        const layout=extractWordPage(api,wordSource,request.page,request.width!,request.height!,request.transform!,request.dpi || 150,request.nativePassword);
        const transfer=layout.layers.flatMap(layer=>layer.kind==="image"?[layer.pixels.buffer]:[]);self.postMessage({id:request.id,layout},{transfer});
      } else if(request.kind === "ocr-render") {
        const raster=renderOcrTarget(api,request.bytes,request.page,request.ocrTarget!);self.postMessage({id:request.id,raster},{transfer:[raster.pixels.buffer]});
      } else if (request.kind === "font") {
        const fontBytes=textCellFont(api,request.bytes,request.page,request.expected!);
        self.postMessage({id:request.id,fontBytes});
      } else if(request.kind === "object-layers") {
        const layers=renderObjectLayers(api,request.bytes,request.page,request.indices || [],request.width!,request.height!,request.rotation!);self.postMessage({id:request.id,layers},{transfer:[layers.background.buffer,layers.foreground.buffer]});
      } else if(request.kind === "preview-cell"&&(request.replacement!==undefined||request.resize)) {
        const preview=previewTextCell(api,request.bytes,request.page,request.expected!,request.replacement ?? request.logicalText ?? request.expected!.text,request.bounds,request.fontBytes,request.formatting || {},request.fallbackFont,request.width!,request.height!,request.rotation!);
        self.postMessage({id:request.id,preview:{...preview,width:request.width,height:request.height,text:request.logicalText,key:request.key}},{transfer:[preview.pixels.buffer,preview.foreground.buffer]});
      } else if(request.kind === "preview-cell") {
        let data=request.bytes, cellId:string|undefined;
        if(request.replacement!==undefined){const result=writeTextCell(api,data,request.page,request.expected!,request.replacement,request.bounds,request.fontBytes,request.formatting,request.fallbackFont);data=result.bytes;cellId=result.cellId;}
        else if(request.bounds){const result=request.resize?writeTextCell(api,data,request.page,request.expected!,request.expected!.cell?request.expected!.text:request.expected!.text.replace(/\n/g," "),request.bounds,request.fontBytes,request.formatting,request.fallbackFont):moveTextCell(api,data,request.page,request.expected!,request.bounds);data=result.bytes;cellId=result.cellId;}
        const target=cellId?inspectEditableText(api,data,request.page).find(item=>item.cell?.id===cellId):request.expected;
        const carets=target?textCaretPositions(api,data,request.page,target,request.logicalText || ""):null;
        const pixels=renderTextPreview(api,data,request.page,request.width!,request.height!,request.rotation!);
        self.postMessage({id:request.id,preview:{pixels,width:request.width,height:request.height,carets,text:request.logicalText,key:request.key}}, {transfer:[pixels.buffer]});
      } else if (request.kind === "inspect") {
        self.postMessage({ id: request.id, objects: inspectEditableText(api,request.bytes,request.page,request.granularity), images: inspectImageObjects(api, request.bytes, request.page), graphics:inspectGraphicObjects(api,request.bytes,request.page), nested: inspectNestedContent(api, request.bytes, request.page) });
      } else if (request.kind === "inspect-images") {
        self.postMessage({ id: request.id, images: inspectImageObjects(api, request.bytes, request.page), nested: inspectNestedContent(api, request.bytes, request.page) });
      } else {
        let bytes: Uint8Array; let cellId:string|undefined;
        if(request.kind === "ocr-adopt") {
          if(request.bytes.length>300*1024*1024 || new TextDecoder().decode(request.bytes.subarray(0,5))!=="%PDF-")throw new Error("The staged OCR document is invalid.");bytes=request.bytes;
        } else if(request.kind === "ocr-convert") {
          bytes=await convertOcrTarget(api,request.bytes,request.page,request.ocrTarget!,request.ocrLines || [],request.background,request.fontBytes);
        } else if(request.kind === "move-graphics") {
          bytes=moveGraphicObjects(api,request.bytes,request.page,request.graphics || [],request.images || [],request.dx || 0,request.dy || 0);
        } else if(request.kind === "replace-cell" || request.kind === "transform-text") {
          if(!request.expected)throw new Error("Select a text cell.");
          const replacement=request.replacement ?? (request.expected.cell?request.expected.text:request.expected.text.replace(/\n/g," "));
          const result=request.kind === "transform-text" && !request.resize && request.replacement===undefined?moveTextCell(api,request.bytes,request.page,request.expected,request.bounds!):writeTextCell(api,request.bytes,request.page,request.expected,replacement,request.bounds,request.fontBytes,request.formatting,request.fallbackFont);
          bytes=result.bytes;cellId=result.cellId;
        } else if (request.kind === "insert") {
          bytes = insertContent(api,request.bytes,request.page,request.point!,request.imageBytes,request.fontBytes);
        } else if (request.kind === "order") {
          bytes = reorderObjects(api,request.bytes,request.page,request.indices || [],request.order || "front");
        } else if (request.kind === "page") {
          bytes = editPage(api, request.bytes, request.page, request.action!, request.target);
        } else if (request.kind === "replace") {
          if (!request.expected || request.replacement === undefined) throw new Error("Select text to edit.");
          bytes = replaceTextObject(api, request.bytes, request.page, request.expected, request.replacement, request.fontBytes, request.formatting);
        } else {
          if (!request.image) throw new Error("Select an image to edit.");
          if (request.kind === "transform-image" && !request.operation) throw new Error("Choose an image transformation.");
          if (request.kind === "replace-image" && !request.imageBytes) throw new Error("Choose a replacement image.");
          bytes = request.kind==="replace-image" ? await replaceImagePlacement(api,request.bytes,request.page,request.image,request.imageBytes!) : editImageObject(api, request.bytes, request.page, request.image, request.kind === "resize-image" && request.bounds ? { kind: "resize", bounds: request.bounds } : request.kind === "delete-image" ? { kind: "delete",removeTagged:true }
            : request.kind === "transform-image" ? { kind: "transform", operation: request.operation! }
                : request.kind === "duplicate-image" ? { kind: "duplicate" }
              : { kind: "move", dx: request.dx ?? 0, dy: request.dy ?? 0 });
          if(request.kind==="delete-image"&&request.image.markedContentId!==undefined)bytes=await removeImageTag(bytes,request.page,request.image.markedContentId);
        }
        self.postMessage({ id: request.id, bytes, cellId }, { transfer: [bytes.buffer] });
      }
    } catch (error) {
      self.postMessage({ id: request.id, error: error instanceof Error ? error.message : "Couldn't edit this PDF." });
    }
  })();
};
