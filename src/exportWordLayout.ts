import * as word from "docx";
import type {PDFDocumentProxy} from "./pdf";
import type {WordPage} from "./editor/wordLayout";
const twips=(points:number)=>Math.round(points*20);
// docx swaps the supplied dimensions for landscape sections.
export const wordPageProperties=(width:number,height:number):word.ISectionPropertiesOptions=>({page:{size:{width:twips(Math.min(width,height)),height:twips(Math.max(width,height)),orientation:width>height?word.PageOrientation.LANDSCAPE:word.PageOrientation.PORTRAIT},margin:{top:0,bottom:0,left:0,right:0,header:0,footer:0}}});
/** One private worker per export keeps PDF parsing off the interface and cancellation immediate. */
export class WordLayoutEngine {
  private worker:Worker;private id=0;private source:Uint8Array|undefined;private pending:{resolve:(page:WordPage)=>void;reject:(error:Error)=>void}|undefined;
  constructor(bytes:Uint8Array,private signal:AbortSignal,private password?:string){
    this.source=bytes;this.worker=new Worker(new URL("./editor/worker.ts",import.meta.url),{type:"module"});
    this.worker.onmessage=event=>{const result=event.data;if(result.id!==this.id)return;const current=this.pending;this.pending=undefined;if(result.layout)current?.resolve(result.layout);else current?.reject(new Error(result.error || "Couldn't prepare the Word layout."));};
    this.worker.onerror=()=>{this.pending?.reject(new Error("Couldn't start the Word converter."));this.pending=undefined;};signal.addEventListener("abort",this.abort,{once:true});
  }
  private abort=()=>{this.pending?.reject(new DOMException("Export canceled","AbortError"));this.pending=undefined;this.worker.terminate();};
  async page(pdf:PDFDocumentProxy,number:number,dpi:number){this.signal.throwIfAborted();const view=(await pdf.getPage(number)).getViewport({scale:1});this.signal.throwIfAborted();return new Promise<WordPage>((resolve,reject)=>{this.pending={resolve,reject};this.worker.postMessage({id:++this.id,kind:"word-page",bytes:this.source,page:number-1,width:view.width,height:view.height,transform:view.transform,dpi,nativePassword:this.password});this.source=undefined;});}
  close(){this.signal.removeEventListener("abort",this.abort);this.worker.terminate();}
}
