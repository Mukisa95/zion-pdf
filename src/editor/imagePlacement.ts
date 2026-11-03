import { PDFDocument, PDFArray, PDFDict, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { imageDimensions, inspectImageObjects, markImagePlacement, type PdfImageObject } from "./pdfium.ts";

type Token={value:string;start:number;end:number};
/** Skip comments and string payloads so text resembling a PDF operator cannot become an edit target. */
function tokens(source:string):Token[]{
  const result:Token[]=[];let i=0;
  while(i<source.length){
    const start=i,char=source[i];
    if(/[\s\0]/.test(char)){i++;continue;}
    if(char==="%" && source[i+1]!==undefined){while(i<source.length&&!/[\r\n]/.test(source[i]))i++;continue;}
    if(char==="("){i++;let depth=1;while(i<source.length&&depth){const c=source[i++];if(c==="\\")i++;else if(c==="(")depth++;else if(c===")")depth--;}result.push({value:"string",start,end:i});continue;}
    if(char==="<"&&source[i+1]!=="<"){i++;while(i<source.length&&source[i]!==">")i++;i++;result.push({value:"string",start,end:i});continue;}
    if(char==="/" ){i++;while(i<source.length&&!/[\s\0()[\]<>/%]/.test(source[i]))i++;}
    else if(/[()[\]<>]/.test(char)){i++;if((char==="<"||char===">")&&source[i]===char)i++;}
    else {i++;while(i<source.length&&!/[\s\0()[\]<>/%]/.test(source[i]))i++;}
    result.push({value:source.slice(start,i),start,end:i});
  }return result;
}

/** Change only the selected Do operation, keeping its crop, tags, blend state and stacking position. */
export async function replaceImagePlacement(api:WrappedPdfiumModule,bytes:Uint8Array,pageIndex:number,expected:PdfImageObject,replacement:Uint8Array):Promise<Uint8Array> {
  if(replacement.length>25*1024*1024)throw new Error("Choose a PNG or JPEG image smaller than 25 MB.");
  const png=[137,80,78,71,13,10,26,10].every((value,index)=>replacement[index]===value);
  const jpeg=replacement[0]===255&&replacement[1]===216&&replacement[2]===255;
  if(!png&&!jpeg)throw new Error("Choose a PNG or JPEG image smaller than 25 MB.");
  const size=imageDimensions(replacement,png);
  if(!size||size[0]<=0||size[1]<=0||size[0]>10000||size[1]>10000||size[0]*size[1]>20_000_000)throw new Error("The image dimensions are too large or invalid.");
  const marker=`ZionPdfImage${crypto.randomUUID().replaceAll("-","")}`;
  const marked=markImagePlacement(api,bytes,pageIndex,expected,marker);
  const doc=await PDFDocument.load(marked.bytes,{updateMetadata:false}),page=doc.getPage(pageIndex),context=doc.context;
  const image=png?await doc.embedPng(replacement):await doc.embedJpg(replacement);
  if(image.width<=0||image.height<=0||image.width>10000||image.height>10000||image.width*image.height>20_000_000)throw new Error("The image dimensions are too large or invalid.");
  // Page resource dictionaries may be inherited or shared with other pages.
  const resources=page.node.Resources()?.clone(context) || context.obj({});
  const xobjects=resources.lookupMaybe(PDFName.of("XObject"),PDFDict)?.clone(context) || context.obj({});
  const name=PDFName.of(marker.replace("ZionPdfImage","ZionPdfReplacement"));xobjects.set(name,image.ref);resources.set(PDFName.of("XObject"),xobjects);page.node.set(PDFName.of("Resources"),resources);
  const contents=page.node.Contents(),streams=contents instanceof PDFArray?contents.asArray():[contents];
  let matches=0,ordinal=0;
  const rewritten=streams.map(ref=>{
    const stream=context.lookup(ref);if(!(stream instanceof PDFRawStream))throw new Error("Couldn't read this page's image content.");
    const decoded=decodePDFRawStream(stream).decode();
    let source="";for(let start=0;start<decoded.length;start+=8192)source+=String.fromCharCode(...decoded.subarray(start,start+8192));
    if(!source.includes(`/${marker}`))return ref!;
    const parts=tokens(source),edits:{start:number;end:number;text:string}[]=[];
    let depth=0,targetDepth=0;
    for(let i=0;i<parts.length;i++){
      const token=parts[i],previous=parts[i-1];
      if(token.value==="BMC"||token.value==="BDC"){
        depth++;
        if(token.value==="BMC"&&previous?.value===`/${marker}`){targetDepth=depth;edits.push({start:previous.start,end:token.end,text:""});}
      }else if(token.value==="EMC"){
        if(targetDepth===depth){edits.push({start:token.start,end:token.end,text:""});targetDepth=0;}depth--;
      }else if(targetDepth&&token.value==="Do"&&previous?.value.startsWith("/")){
        if(ordinal++===marked.ordinal){matches++;edits.push({start:previous.start,end:previous.end,text:name.toString()});}
      }else if(token.value==="BI")throw new Error("Couldn't prepare this page's inline image content.");
    }
    if(targetDepth)throw new Error("Couldn't read this image's document group.");
    let updated=source;for(const edit of edits.sort((a,b)=>b.start-a.start))updated=updated.slice(0,edit.start)+edit.text+updated.slice(edit.end);
    // Preserve byte values outside the selected operation, including non-ASCII text strings.
    if(updated===source)return ref!;
    const data=Uint8Array.from(updated,char=>char.charCodeAt(0));
    return context.register(context.flateStream(data));
  });
  if(matches!==1)throw new Error("Couldn't identify the selected image placement.");
  page.node.set(PDFName.of("Contents"),context.obj(rewritten));
  const output=await doc.save({useObjectStreams:false});
  const current=inspectImageObjects(api,output,pageIndex).find(item=>item.index===expected.index);
  if(!current||current.pixelSize?.[0]!==image.width||current.pixelSize?.[1]!==image.height||current.matrix.some((value,index)=>Math.abs(value-expected.matrix[index])>.01))throw new Error("The replacement image couldn't be verified.");
  return output;
}
