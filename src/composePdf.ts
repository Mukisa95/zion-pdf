import type {ComposeSource} from "./editor/composePdf";
export type ImagePaper="a4"|"letter"|"original";
export function buildPdf(sources:ComposeSource[],signal:AbortSignal,progress:(n:number)=>void){
  signal.throwIfAborted();
  return new Promise<Uint8Array>((resolve,reject)=>{
    const worker=new Worker(new URL("./editor/composeWorker.ts",import.meta.url),{type:"module"});
    const close=()=>{signal.removeEventListener("abort",abort);worker.terminate();},abort=()=>{close();reject(new DOMException("Canceled","AbortError"));};
    signal.addEventListener("abort",abort,{once:true});
    worker.onmessage=({data})=>{if(data.bytes){close();resolve(data.bytes);}else if(data.error){close();reject(new Error(data.error));}else if(typeof data.progress==="number")progress(data.progress);};
    worker.onerror=()=>{close();reject(new Error("Couldn't start the PDF builder."));};
    try{const copies=sources.map(source=>({...source,bytes:source.bytes.slice()}));worker.postMessage({sources:copies},copies.map(s=>s.bytes.buffer));}catch(reason){close();reject(reason);}
  });
}
export async function imagePdf(bytes:Uint8Array,paper:ImagePaper,signal:AbortSignal){
  signal.throwIfAborted();const bitmap=await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  const canvas=document.createElement("canvas");
  try{
    const scale=Math.min(1,Math.sqrt(24000000/(bitmap.width*bitmap.height)));
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Couldn't read the image.");ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const jpeg=bytes[0]===0xff&&bytes[1]===0xd8,type=jpeg?"image/jpeg":"image/png";
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Couldn't convert the image.")),type,.97));
    signal.throwIfAborted();const {PDFDocument}=await import("pdf-lib"),pdf=await PDFDocument.create(),data=new Uint8Array(await blob.arrayBuffer()),image=jpeg?await pdf.embedJpg(data):await pdf.embedPng(data);
    let [width,height]=paper==="a4"?[595.28,841.89]:paper==="letter"?[612,792]:[bitmap.width*.75,bitmap.height*.75];
    if(paper!=="original"&&bitmap.width>bitmap.height)[width,height]=[height,width];
    const margin=paper==="original"?0:18,fit=Math.min((width-2*margin)/bitmap.width,(height-2*margin)/bitmap.height),w=bitmap.width*fit,h=bitmap.height*fit;
    const page=pdf.addPage([width,height]);page.drawImage(image,{x:(width-w)/2,y:(height-h)/2,width:w,height:h});
    pdf.setCreator("Zion PDF");signal.throwIfAborted();return new Uint8Array(await pdf.save());
  }finally{bitmap.close();canvas.width=canvas.height=0;}
}
