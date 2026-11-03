import {createWorker,PSM,type Worker as OcrWorker} from "tesseract.js";
import {wordAppearance,recognitionBox,type Raster,type NormalBox} from "./editor/ocrAppearance";
import type {OcrLine} from "./editor/ocrPdf";
export function createOcrEngine(progress:(status:string,progress:number)=>void){const base=new URL(`${import.meta.env.BASE_URL}ocr/`,window.location.href).href;return createWorker("eng",1,{workerPath:base+"worker.min.js",corePath:base,langPath:base.slice(0,-1),workerBlobURL:false,cacheMethod:"none",logger:m=>progress(m.status==="recognizing text"?"Detecting text":"Preparing offline recognition",m.progress||0)});}
export async function recognizeFrame(worker:OcrWorker,image:Raster & {nativeText?:{box:NormalBox}[]},layout="auto"){
  await worker.setParameters({tessedit_pageseg_mode:layout==="sparse"?PSM.SPARSE_TEXT:layout==="block"?PSM.SINGLE_BLOCK:PSM.AUTO,user_defined_dpi:"300",preserve_interword_spaces:"1"});
  const canvas=document.createElement("canvas");canvas.width=image.width;canvas.height=image.height;canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.pixels),image.width,image.height),0,0);
  const result=await worker.recognize(canvas,{}, {blocks:true,text:true}),lines:OcrLine[]=[],masks:NormalBox[]=[];let paragraph=0;
  const normalize=(box:{x0:number;y0:number;x1:number;y1:number}):NormalBox=>[Math.max(0,box.x0/image.width),Math.max(0,box.y0/image.height),Math.min(1,box.x1/image.width),Math.min(1,box.y1/image.height)];
  const nativeWord=(box:NormalBox)=>(image.nativeText || []).some(item=>{const b=item.box,area=Math.max(0,Math.min(box[2],b[2])-Math.max(box[0],b[0]))*Math.max(0,Math.min(box[3],b[3])-Math.max(box[1],b[1]));return area/Math.max(.000001,(box[2]-box[0])*(box[3]-box[1]))>.6;});
  for(const block of result.data.blocks || [])for(const para of block.paragraphs){for(const line of para.lines){
    const words=line.words.filter(word=>word.confidence>=50&&!nativeWord(normalize(recognitionBox(word))));if(!words.length)continue;
    const colors=new Map<string,number>(),wordMasks:NormalBox[]=[];let coverage=0,letters=0;
    for(const word of words){const box=normalize(recognitionBox(word)),appearance=wordAppearance(image,box);masks.push(box);wordMasks.push(box);colors.set(appearance.color,(colors.get(appearance.color)||0)+word.text.length);coverage+=appearance.inkCount/Math.max(1,(box[2]-box[0])*image.width*(box[3]-box[1])*image.height);letters+=word.text.length;}
    const color=[...colors].sort((a,b)=>b[1]-a[1])[0]?.[0] || "#000000",text=words.map(word=>word.text).join(" "),box:NormalBox=[Math.min(...wordMasks.map(b=>b[0])),Math.min(...wordMasks.map(b=>b[1])),Math.max(...wordMasks.map(b=>b[2])),Math.max(...wordMasks.map(b=>b[3]))];
    lines.push({text,confidence:words.reduce((sum,word)=>sum+word.confidence,0)/words.length,box,paragraph,color,masks:wordMasks,bold:coverage/words.length>.28&&text.replace(/[^A-Za-z]/g,"").length>2&&text===text.toUpperCase()});
  }paragraph++;}
  if(lines.length>500)throw new Error("This page contains more than 500 text lines. Use a smaller selection.");return {lines,masks};
}
