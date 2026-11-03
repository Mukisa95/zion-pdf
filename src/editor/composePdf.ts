import type {WrappedPdfiumModule as Api} from "@embedpdf/pdfium";
import {withDocument,saveDocument} from "./pdfium.ts";

export type ComposeSource={bytes:Uint8Array;pages:number[];password?:string;hasForms?:boolean};
export function prepareComposeSources(api:Api,sources:ComposeSource[]){
  return sources.map(source=>withDocument(api,source.bytes,doc=>{
    const hasForms=api.FPDF_GetFormType(doc)!==0;
    if(!api.EPDF_IsEncrypted(doc))return {...source,hasForms};
    if(!api.EPDF_RemoveEncryption(doc))throw new Error("Couldn't unlock this PDF for merging.");
    return {...source,bytes:saveDocument(api,doc),password:undefined,hasForms};
  },{readOnly:true,password:source.password}));
}
/** Copy native pages in the requested order; text, vectors and images stay PDF objects. */
export function combinePdfPages(api:Api,sources:ComposeSource[],progress?:(done:number,total:number)=>void){
  const total=sources.reduce((n,s)=>n+s.pages.length,0);
  if(!total||total>10000)throw new Error("Choose between 1 and 10,000 pages.");
  const output=api.FPDF_CreateNewDocument();if(!output)throw new Error("Couldn't create the PDF.");
  try{
    let at=0;
    for(const source of sources){
      if(!source.pages.length)continue;
      withDocument(api,source.bytes,doc=>{
        const count=api.FPDF_GetPageCount(doc);
        if(source.pages.some(p=>!Number.isInteger(p)||p<1||p>count)||new Set(source.pages).size!==source.pages.length)throw new Error("The selected page order is invalid.");
        const ptr=api.pdfium.wasmExports.malloc(source.pages.length*4);if(!ptr)throw new Error("Not enough memory to merge these files.");
        try{source.pages.forEach((p,i)=>api.pdfium.setValue(ptr+i*4,p-1,"i32"));if(!api.FPDF_ImportPagesByIndex(output,doc,ptr,source.pages.length,at))throw new Error("Couldn't copy pages from a PDF.");}
        finally{api.pdfium.wasmExports.free(ptr);}
      },{readOnly:true,password:source.password});
      at+=source.pages.length;progress?.(at,total);
    }
    const bytes=saveDocument(api,output);if(bytes.length>300*1024*1024)throw new Error("The PDF exceeds 300 MB. Use fewer files.");return bytes;
  }finally{api.FPDF_CloseDocument(output);}
}
