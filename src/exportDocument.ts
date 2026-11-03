import {Util,AnnotationMode} from "pdfjs-dist";
import type {PDFDocumentProxy} from "./pdf";
export type ExportFormat="docx"|"png"|"jpg"|"txt"|"html";
export type ExportOptions={format:ExportFormat;pages:number[];dpi:number;wordMode:"layout"|"text"|"appearance";password?:string};
type Run={text:string;font:string;size:number;bold:boolean;italics:boolean;x:number;y:number;width:number};
type Row={runs:Run[];x:number;y:number;height:number};
const clean=(value:string)=>value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,"");
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export async function rowsFor(pdf:PDFDocumentProxy,number:number):Promise<Row[]>{
  const page=await pdf.getPage(number),viewport=page.getViewport({scale:1}),content=await page.getTextContent();
  await page.getOperatorList();const runs:Run[]=[];
  for(const item of content.items){if(!("str" in item)||!item.str.trim())continue;
    const matrix=Util.transform(viewport.transform,item.transform),size=Math.max(1,Math.hypot(matrix[2],matrix[3]));
    const loaded=page.commonObjs.has(item.fontName)?page.commonObjs.get(item.fontName):null;
    const font=(loaded?.name || content.styles[item.fontName]?.fontFamily || "Arial").replace(/^[A-Z]{6}\+/,"");
    runs.push({text:clean(item.str),font:font.replace(/[-,](BoldItalic|BoldOblique|Bold|Italic|Oblique|Regular|Roman|MT|PSMT).*$/i,"").replace(/^sans-serif$/,"Arial").replace(/^serif$/,"Times New Roman").replace(/[^\p{L}\p{N} _-]/gu,"").slice(0,100),size:Math.min(300,size),bold:/bold|black|heavy/i.test(font),italics:/italic|oblique/i.test(font),x:matrix[4],y:matrix[5],width:item.width});
  }
  runs.sort((a,b)=>Math.abs(a.y-b.y)<Math.min(a.size,b.size)*.25?a.x-b.x:a.y-b.y);
  const rows:Row[]=[];
  for(const run of runs){const previous=rows.at(-1),last=previous?.runs.at(-1);
    if(previous&&last&&Math.abs(previous.y-run.y)<Math.min(previous.height,run.size)*.3&&run.x-last.x-last.width<Math.max(24,run.size*3)){
      if(!/\s$/.test(last.text)&&!/^\s/.test(run.text)&&run.x-last.x-last.width>run.size*.12)last.text+=" ";previous.runs.push(run);previous.height=Math.max(previous.height,run.size);
    }else rows.push({runs:[run],x:run.x,y:run.y,height:run.size});
  }
  return rows;
}
export async function renderExportPage(pdf:PDFDocumentProxy,number:number,dpi:number,format:"png"|"jpg",signal:AbortSignal){
  signal.throwIfAborted();const page=await pdf.getPage(number),base=page.getViewport({scale:1}),scale=Math.min(dpi/72,Math.sqrt(24000000/(base.width*base.height)),10000/Math.max(base.width,base.height));
  const viewport=page.getViewport({scale}),canvas=document.createElement("canvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const task=page.render({canvas,viewport,background:"rgb(255,255,255)",annotationMode:AnnotationMode.ENABLE_STORAGE});const cancel=()=>task.cancel();signal.addEventListener("abort",cancel,{once:true});
  try{await task.promise;signal.throwIfAborted();const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Couldn't encode the page image.")),format==="png"?"image/png":"image/jpeg",.94));return new Uint8Array(await blob.arrayBuffer());}
  finally{signal.removeEventListener("abort",cancel);canvas.width=canvas.height=0;}
}
export async function exportDocument(pdf:PDFDocumentProxy,name:string,options:ExportOptions,signal:AbortSignal,progress:(value:number,message:string)=>void){
  if(!options.pages.length||options.pages.some(page=>!Number.isInteger(page)||page<1||page>pdf.numPages))throw new Error("Choose valid pages to export.");
  if(options.format==="docx"&&options.wordMode==="layout"){
    const data=await (await import("./exportWordSemantic")).editableWord(pdf,name,options.pages,options.dpi,options.password,signal,progress);
    signal.throwIfAborted();if(data.length>300*1024*1024)throw new Error("The export exceeds 300 MB. Export fewer pages.");progress(1,"Ready to save export");
    return {data,extension:"docx",mime:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"};
  }
  const {format,pages}=options,images:Record<string,Uint8Array>={},textPages:string[]=[],htmlPages:string[]=[],sections:import("docx").ISectionOptions[]=[];
  const word=format==="docx"?await import("docx"):null;let total=0,textCount=0;
  for(let i=0;i<pages.length;i++){
    signal.throwIfAborted();const number=pages[i],page=await pdf.getPage(number),viewport=page.getViewport({scale:1});progress(i/pages.length,`Exporting page ${number} (${i+1} of ${pages.length})`);
    if(format==="png"||format==="jpg"){
      const image=await renderExportPage(pdf,number,options.dpi,format,signal);total+=image.length;images[`page-${String(number).padStart(String(pdf.numPages).length,"0")}.${format}`]=image;
    }else if(word&&options.wordMode!=="text"){
      const image=await renderExportPage(pdf,number,options.dpi,"png",signal);total+=image.length;
      const scale=Math.min(1,1584/Math.max(viewport.width,viewport.height)),{wordPageProperties}=await import("./exportWordLayout");
      sections.push({properties:wordPageProperties(viewport.width*scale,viewport.height*scale),children:[new word.Paragraph({spacing:{before:0,after:0,line:1,lineRule:word.LineRuleType.EXACT},children:[new word.ImageRun({type:"png",data:image,transformation:{width:viewport.width*scale*96/72,height:viewport.height*scale*96/72},floating:{horizontalPosition:{relative:word.HorizontalPositionRelativeFrom.PAGE,offset:0},verticalPosition:{relative:word.VerticalPositionRelativeFrom.PAGE,offset:0},behindDocument:true,allowOverlap:true},altText:{title:`Page ${number}`,description:"Original PDF page appearance",name:`Page ${number}`}})]})]});
    }else{
      const rows=await rowsFor(pdf,number),plain=rows.map(row=>row.runs.map(run=>run.text).join("")).join("\n");textCount+=plain.trim().length;
      if(word){const paragraphs:import("docx").Paragraph[]=[];
        for(let r=0;r<rows.length;r++){const row=rows[r],before=r?Math.max(0,row.y-rows[r-1].y-rows[r-1].height*1.2):0;
          paragraphs.push(new word.Paragraph({spacing:{before:Math.min(720,Math.round(before*20)),after:0,line:Math.round(row.height*24),lineRule:word.LineRuleType.EXACT},children:row.runs.map(run=>new word.TextRun({text:run.text,font:run.font,size:Math.max(2,Math.round(run.size*2)),bold:run.bold,italics:run.italics}))}));}
        const margin=Math.min(36,Math.max(8,viewport.width*.04));sections.push({properties:{page:{size:{width:Math.round(viewport.width*20),height:Math.round(viewport.height*20)},margin:{top:margin*20,bottom:margin*20,left:margin*20,right:margin*20}}},children:paragraphs.length?paragraphs:[new word.Paragraph("")]});
      }else if(format==="txt")textPages.push(plain);
      else htmlPages.push(`<section aria-label="Page ${number}" class="page">${rows.map(row=>`<p>${row.runs.map(run=>`<span style="font-family:${escape(run.font)};font-size:${run.size.toFixed(2)}pt;font-weight:${run.bold?700:400};font-style:${run.italics?"italic":"normal"}">${escape(run.text)}</span>`).join("")}</p>`).join("\n")}</section>`);
      total+=plain.length*2;
    }
    if(total>250*1024*1024)throw new Error("This export is too large. Export fewer pages or choose a lower image resolution.");
    signal.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,0));
  }
  let data:Uint8Array,extension:string=format,mime:string="application/octet-stream";
  if(word){if(options.wordMode==="text"&&!textCount)throw new Error("These pages have no readable text. Use OCR before exporting editable text.");data=new Uint8Array(await word.Packer.toArrayBuffer(new word.Document({creator:"Zion PDF",title:name,sections})));mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document";}
  else if(format==="png"||format==="jpg"){if(pages.length===1){data=Object.values(images)[0];mime=format==="png"?"image/png":"image/jpeg";}else{const {zip}=await import("fflate");data=await new Promise<Uint8Array>((resolve,reject)=>{const terminate=zip(images,{level:0},(error,result)=>{signal.removeEventListener("abort",abort);if(error)reject(error);else resolve(result);});const abort=()=>{terminate();reject(new DOMException("Export canceled","AbortError"));};signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();});extension="zip";mime="application/zip";}}
  else{if(!textCount)throw new Error("These pages have no readable text. Run OCR before exporting text.");data=new TextEncoder().encode(format==="txt"?textPages.join("\n\n\f\n\n"):`<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(name)}</title><style>body{margin:2rem auto;max-width:65rem;padding:0 1rem}.page{break-after:page;margin-bottom:3rem}p{white-space:pre-wrap;margin:0 0 .3em}</style><body>${htmlPages.join("\n")}</body></html>`);mime=format==="txt"?"text/plain;charset=utf-8":"text/html;charset=utf-8";}
  signal.throwIfAborted();if(data.length>300*1024*1024)throw new Error("The export exceeds 300 MB. Export fewer pages.");progress(1,"Ready to save export");return {data,extension,mime};
}
