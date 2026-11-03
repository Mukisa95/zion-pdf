import type { WrappedPdfiumModule as Api } from "@embedpdf/pdfium";
import {withDocument,withPage,objectBounds,simpleMark,nonStructuralMarks,heap,saveDocument,inspectImageObjects,inspectGraphicObjects,type PdfImageObject,type PdfGraphicObject} from "./pdfium.ts";
import {storeTextCell} from "./textCells.ts";
import {embeddingRights,hasFontCharacters} from "./fonts.ts";
import {removeImageTag} from "./imageTags.ts";
import type {Raster} from "./ocrAppearance.ts";
export type OcrBackground=Uint8Array|Raster;
export type OcrTarget={image?:PdfImageObject;graphic?:PdfGraphicObject;page?:true;backgroundOnly?:boolean;keepImage?:boolean};
export type OcrLine={text:string;confidence:number;box:[number,number,number,number];paragraph:number;color?:string;masks?:[number,number,number,number][];bold?:boolean};
const keepNative=(api:Api,object:number)=>api.FPDFPageObj_GetType(object)===1&&[0,1,2,4,5,6].includes(api.FPDFTextObj_GetTextRenderMode(object))&&nonStructuralMarks(api,object);
const target=(api:Api,bytes:Uint8Array,page:number,expected:OcrTarget)=>{
  if(expected.page)return withDocument(api,bytes,doc=>withPage(api,doc,page,pageIndex=>{const ptr=api.pdfium.wasmExports.malloc(16);try{api.FPDFPage_SetRotation(pageIndex,0);const has=api.FPDFPage_GetCropBox(pageIndex,ptr,ptr+4,ptr+8,ptr+12)||api.FPDFPage_GetMediaBox(pageIndex,ptr,ptr+4,ptr+8,ptr+12);const bounds:[number,number,number,number]=has?[0,4,8,12].map(offset=>api.pdfium.getValue(ptr+offset,"float")) as [number,number,number,number]:[0,0,api.FPDF_GetPageWidthF(pageIndex),api.FPDF_GetPageHeightF(pageIndex)];return {index:-1,bounds};}finally{api.pdfium.wasmExports.free(ptr);}}));
  const item=expected.image || expected.graphic;if(!item)throw new Error("Select an image or a content group.");
  const found=expected.image?inspectImageObjects(api,bytes,page).find(i=>i.index===item.index):inspectGraphicObjects(api,bytes,page).find(i=>i.index===item.index);
  if(JSON.stringify(found)!==JSON.stringify(item))throw new Error("The page changed. Select the image again.");return item;
};
export function renderOcrTarget(api:Api,bytes:Uint8Array,index:number,expected:OcrTarget){
  const item=target(api,bytes,index,expected),[l,b,r,t]=item.bounds,w=r-l,h=t-b;if(w<1||h<1)throw new Error("This selection is too small for text detection.");
  const scale=Math.min(4.2,Math.sqrt(12000000/(w*h)),4000/Math.max(w,h)),width=Math.ceil(w*scale),height=Math.ceil(h*scale);
  return withDocument(api,bytes,doc=>withPage(api,doc,index,(page,_text,release)=>{release();api.FPDFPage_SetRotation(page,0);
    const nativeText:{box:[number,number,number,number]}[]=[];
    for(let i=0;i<api.FPDFPage_CountObjects(page);i++){const object=api.FPDFPage_GetObject(page,i),native=expected.page&&keepNative(api,object);if(native){const box=objectBounds(api,object);nativeText.push({box:[(box[0]-l)/w,(t-box[3])/h,(box[2]-l)/w,(t-box[1])/h]});}if(!api.FPDFPageObj_SetIsActive(object,expected.page?!expected.backgroundOnly||!native:i===item.index))throw new Error("Couldn't isolate the selected image.");}
    const bitmap=api.FPDFBitmap_Create(width,height,1),ptr=api.pdfium.wasmExports.malloc(16);if(!bitmap||!ptr)throw new Error("Not enough memory to detect text.");
    try{api.FPDFBitmap_FillRect(bitmap,0,0,width,height,0xffffffff);let left=0,top=api.FPDF_GetPageHeightF(page);if(api.FPDFPage_GetCropBox(page,ptr,ptr+4,ptr+8,ptr+12)){left=api.pdfium.getValue(ptr,"float");top=api.pdfium.getValue(ptr+12,"float");}
      api.FPDF_RenderPageBitmap(bitmap,page,Math.round(-(l-left)*scale),Math.round(-(top-t)*scale),Math.round(api.FPDF_GetPageWidthF(page)*scale),Math.round(api.FPDF_GetPageHeightF(page)*scale),0,0);
      const buffer=api.FPDFBitmap_GetBuffer(bitmap),stride=api.FPDFBitmap_GetStride(bitmap),pixels=new Uint8ClampedArray(width*height*4),data=heap(api);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=buffer+y*stride+x*4,z=(y*width+x)*4;pixels[z]=data[a+2];pixels[z+1]=data[a+1];pixels[z+2]=data[a];pixels[z+3]=data[a+3];}return {pixels,width,height,nativeText};
    }finally{api.FPDFBitmap_Destroy(bitmap);api.pdfium.wasmExports.free(ptr);}
  }));
}
export async function convertOcrTarget(api:Api,bytes:Uint8Array,index:number,expected:OcrTarget,lines:OcrLine[],background?:OcrBackground,fontBytes?:Uint8Array){
  const item=target(api,bytes,index,expected);if(!expected.page&&!lines.length&&!background||lines.length>500||lines.some(line=>line.text.length>5000||!line.box.every(Number.isFinite)||line.box.some(v=>v<0||v>1)||line.box[2]<=line.box[0]||line.box[3]<=line.box[1]))throw new Error("Choose a valid, bounded text detection result.");
  let mcid=-1;const overlayMode=!!background&&(!!expected.keepImage||lines.length>0);
  const output=withDocument(api,bytes,doc=>{withPage(api,doc,index,(page,_text,release)=>{const originals=overlayMode?[]:expected.page?Array.from({length:api.FPDFPage_CountObjects(page)},(_,i)=>api.FPDFPage_GetObject(page,i)).filter(object=>!keepNative(api,object)):[api.FPDFPage_GetObject(page,item.index)];
    const original=originals[0],mark=expected.page||overlayMode?null:simpleMark(api,original);if(mark===undefined&&!nonStructuralMarks(api,original))throw new Error("This selection has unsupported marked content.");if(mark)mcid=mark.id;if(expected.page&&!overlayMode)mcid=-2;
    const taggedChildren=(object:number,depth=0):boolean=>{if(depth>8)return true;for(let i=0;i<api.FPDFFormObj_CountObjects(object);i++){const child=api.FPDFFormObj_GetObject(object,i);if(!nonStructuralMarks(api,child)&&api.FPDFPageObj_CountMarks(child)>0||api.FPDFPageObj_GetType(child)===5&&taggedChildren(child,depth+1))return true;}return false;};
    if(!overlayMode&&expected.graphic&&taggedChildren(original))throw new Error("This group contains structural child tags. Use page OCR to convert its page safely.");
    release();const ptr=api.pdfium.wasmExports.malloc(32);let font=0,boldFont=0,fontPtr=0,owned=0;const [l,b,r,t]=item.bounds,w=r-l,h=t-b;let at=overlayMode?api.FPDFPage_CountObjects(page):expected.page?0:item.index;
    try{if(fontBytes){if(!embeddingRights(fontBytes).editable||!hasFontCharacters(fontBytes,lines.map(line=>line.text).join("").replace(/\s/g,"")))throw new Error("Choose an editable font containing the detected text.");fontPtr=api.pdfium.wasmExports.malloc(fontBytes.length);heap(api).set(fontBytes,fontPtr);font=api.FPDFText_LoadFont(doc,fontPtr,fontBytes.length,new DataView(fontBytes.buffer,fontBytes.byteOffset,fontBytes.byteLength).getUint32(0)===0x4f54544f?1:2,true);}else font=api.FPDFText_LoadStandardFont(doc,"Helvetica");if(!font)throw new Error("Couldn't load a font for detected text.");if(lines.some(line=>line.bold))boldFont=api.FPDFText_LoadStandardFont(doc,"Helvetica-Bold");
      for(const object of originals){if(!api.FPDFPage_RemoveObject(page,object))throw new Error("Couldn't replace the selected content.");api.FPDFPageObj_Destroy(object);}
      if(background){owned=api.FPDFPageObj_NewImageObj(doc);if(overlayMode)api.FPDFPageObj_AddMark(owned,"ZionPdfOcrOverlay");
        if(background instanceof Uint8Array){if(background.length>40*1024*1024)throw new Error("The cleaned image is too large.");const data=api.pdfium.wasmExports.malloc(background.length);try{heap(api).set(background,data);if(!api.EPDFImageObj_SetPng(page,0,owned,data,background.length))throw new Error("Couldn't preserve the image background.");}finally{api.pdfium.wasmExports.free(data);}}
        else{const {width,height,pixels}=background;if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>12010000||pixels.length!==width*height*4)throw new Error("The cleaned image is invalid or too large.");const bitmap=api.FPDFBitmap_Create(width,height,1);if(!bitmap)throw new Error("Couldn't prepare the image background.");try{const data=heap(api),buffer=api.FPDFBitmap_GetBuffer(bitmap),stride=api.FPDFBitmap_GetStride(bitmap);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const from=(y*width+x)*4,to=buffer+y*stride+x*4;data[to]=pixels[from+2];data[to+1]=pixels[from+1];data[to+2]=pixels[from];data[to+3]=pixels[from+3];}if(!api.FPDFImageObj_SetBitmap(0,0,owned,bitmap))throw new Error("Couldn't preserve the image background.");}finally{api.FPDFBitmap_Destroy(bitmap);}}
        if(!api.FPDFImageObj_SetMatrix(owned,w,0,0,h,l,b)||!api.FPDFPage_InsertObjectAtIndex(page,owned,at++))throw new Error("Couldn't place the image background.");owned=0;
      }
      for(const line of lines){if(!line.text.trim())continue;const rowFont=line.bold&&boldFont?boldFont:font;const box:[number,number,number,number]=[l+line.box[0]*w,t-line.box[3]*h,l+line.box[2]*w,t-line.box[1]*h],size=Math.max(1,Math.min(300,(box[3]-box[1])*1.05));let length=0;for(const char of line.text){if(!api.FPDFFont_GetGlyphWidth(rowFont,char.codePointAt(0)!,size,ptr)||api.pdfium.getValue(ptr,"float")<=0&&!/\s/.test(char))throw new Error("The detected text contains characters missing from the selected font.");length+=api.pdfium.getValue(ptr,"float");}
        owned=api.FPDFPageObj_CreateTextObj(doc,rowFont,size);const string=api.pdfium.wasmExports.malloc((line.text.length+1)*2);try{api.pdfium.stringToUTF16(line.text,string,(line.text.length+1)*2);if(!api.FPDFText_SetText(owned,string))throw new Error("Couldn't create editable text.");}finally{api.pdfium.wasmExports.free(string);}
        const natural=objectBounds(api,owned),sx=(box[2]-box[0])/Math.max(.01,natural[2]-natural[0]),sy=(box[3]-box[1])/Math.max(.01,natural[3]-natural[1]),baseline=box[1]-natural[1]*sy;const color=line.color&&/^#[0-9a-f]{6}$/i.test(line.color)?line.color:"#000000",rgb=[1,3,5].map(offset=>parseInt(color.slice(offset,offset+2),16));
        api.FPDFPageObj_Destroy(owned);owned=0;const members:{text:string;bounds:[number,number,number,number]}[]=[],prefix:number[]=[0];let advance=0;
        for(const char of line.text){api.FPDFFont_GetGlyphWidth(rowFont,char.codePointAt(0)!,size,ptr);const width=api.pdfium.getValue(ptr,"float");advance+=width>0?width:/\s/.test(char)?size*.25:0;prefix.push(advance);}
        for(const match of line.text.matchAll(/\S+/g)){const value=match[0];owned=api.FPDFPageObj_CreateTextObj(doc,rowFont,size);const textPtr=api.pdfium.wasmExports.malloc((value.length+1)*2);try{api.pdfium.stringToUTF16(value,textPtr,(value.length+1)*2);if(!api.FPDFText_SetText(owned,textPtr))throw new Error("Couldn't create editable words.");}finally{api.pdfium.wasmExports.free(textPtr);}
          [sx,0,0,sy,box[0]-natural[0]*sx+(prefix[match.index] || 0)*sx,baseline].forEach((v,i)=>api.pdfium.setValue(ptr+i*4,v,"float"));if(!api.FPDFPageObj_SetMatrix(owned,ptr)||!api.FPDFPageObj_SetFillColor(owned,rgb[0],rgb[1],rgb[2],255)||!api.FPDFPage_InsertObjectAtIndex(page,owned,at++))throw new Error("Couldn't position editable text.");members.push({text:value,bounds:objectBounds(api,owned)});owned=0;
        }
        if(members.length)storeTextCell(api,page,{id:crypto.randomUUID(),bounds:box,text:line.text,members,format:{fontSize:size},fontSize:size,fontScale:sy,fontScaleX:sx,color,cap:Math.max(...members.map(member=>member.bounds[3]))-baseline});
      }
      if(!api.FPDFPage_GenerateContent(page))throw new Error("Couldn't save detected text.");
    }finally{if(owned)api.FPDFPageObj_Destroy(owned);if(boldFont)api.FPDFFont_Close(boldFont);if(font)api.FPDFFont_Close(font);if(fontPtr)api.pdfium.wasmExports.free(fontPtr);api.pdfium.wasmExports.free(ptr);}
  });return saveDocument(api,doc);});return mcid>=0||mcid===-2?removeImageTag(output,index,mcid):output;
}
