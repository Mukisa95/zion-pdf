import {init} from "@embedpdf/pdfium";
import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import {combinePdfPages,prepareComposeSources,type ComposeSource} from "./composePdf";
import {restoreMergedForms} from "./composeForms";
self.onmessage=async(event:MessageEvent<{sources:ComposeSource[]}>)=>{
  try{
    const response=await fetch(wasmUrl);if(!response.ok)throw new Error("Couldn't load the PDF builder.");
    const api=await init({wasmBinary:await response.arrayBuffer()});api.PDFiumExt_Init();
    const sources=prepareComposeSources(api,event.data.sources);
    const native=combinePdfPages(api,sources,(done,total)=>self.postMessage({progress:done/total*.85}));
    const bytes=await restoreMergedForms(native,sources);
    if(bytes.length>300*1024*1024)throw new Error("The PDF exceeds 300 MB. Use fewer files.");
    self.postMessage({bytes},{transfer:[bytes.buffer as ArrayBuffer]});
  }catch(reason){self.postMessage({error:reason instanceof Error?reason.message:"Couldn't create the PDF."});}
};
