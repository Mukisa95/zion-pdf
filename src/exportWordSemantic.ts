import * as word from "docx";
import {ShapeRun,ShapeGroupRun,type IShapeGroupChildOptions} from "docx/shapes";
import type {PDFDocumentProxy} from "./pdf";
import {WordLayoutEngine} from "./exportWordLayout";
import type {WordBox,WordText,WordTable,WordLayer,WordPage} from "./editor/wordLayout";
import {listLocalFonts,matchLocalFont,type LocalFontFace} from "./editor/fonts";
import {fontTraits} from "./fontOptions";
import {rowsFor} from "./exportDocument";
import {prepareWordFonts,wordFontFace} from "./wordFonts";

type TextBlock={kind:"text";box:WordBox;text:string;label:string;level?:number;marker?:string};
type TableCell={text:string;box:WordBox|null;row:number;col:number;rowSpan:number;colSpan:number;header:boolean};
type TableBlock={kind:"table";box:WordBox;rows:number;cols:number;cells:TableCell[]};
type PictureBlock={kind:"picture";box:WordBox};
export type SemanticDocument={engine:string;pages:{number:number;width:number;height:number;blocks:(TextBlock|TableBlock|PictureBlock)[]}[]};
const twips=(v:number)=>Math.round(v*20),px=(v:number)=>v*96/72;
const contains=(outer:WordBox,inner:WordBox)=>{const x=inner[0]+inner[2]/2,y=inner[1]+inner[3]/2;return x>=outer[0]-2&&x<=outer[0]+outer[2]+2&&y>=outer[1]-2&&y<=outer[1]+outer[3]+2;};
const intersects=(a:WordBox,b:WordBox)=>a[0]<b[0]+b[2]&&a[0]+a[2]>b[0]&&a[1]<b[1]+b[3]&&a[1]+a[3]>b[1];
const family=(value:string)=>value.replace(/[-,](BoldItalic|BoldOblique|Bold|Italic|Oblique|Regular|Roman|MT|PSMT).*$/i,"").replace(/^Helvetica$/i,"Arial").replace(/^Times(?:-Roman)?$/i,"Times New Roman").replace(/^Courier$/i,"Courier New");
class PdfWordRun extends word.TextRun { constructor(options:word.IRunOptions,outline?:boolean){super(options);if(outline)this.properties.push(new word.OnOffElement("w:outline",true));} }
function run(text:WordText,fonts:LocalFontFace[],value=text.text,raise=0){const face=matchLocalFont(fonts,text.font),traits=face?fontTraits(face):null,legacy=face?wordFontFace(face):null;return new PdfWordRun({text:value,font:legacy?.family||face?.family||family(text.font),size:Math.max(2,Math.round(text.size*2)),bold:legacy?.bold??traits?.bold??text.bold,italics:legacy?.italic??traits?.italic??text.italic,color:text.color,scale:text.horizontalScale,...(Math.abs(raise)>1?{position:`${Number(raise.toFixed(2))}pt` as const}:{})},text.outline);}
const descent=(text:WordText,fonts:LocalFontFace[])=>{const face=matchLocalFont(fonts,text.font);return text.size*(face?wordFontFace(face)?.descent||.23:.23);};
const sameLine=(a:WordText,b:WordText)=>Math.abs(a.baseline-b.baseline)<Math.max(a.size,b.size)*.45;
function textRuns(texts:WordText[],fonts:LocalFontFace[],preserveLines=false){
  const sorted=texts.slice().sort((a,b)=>sameLine(a,b)?a.box[0]-b.box[0]:a.baseline-b.baseline),runs:word.TextRun[]=[];
  for(let i=0;i<sorted.length;i++){const text=sorted[i],previous=sorted[i-1];
    const nextLine=previous&&!sameLine(previous,text);
    if(nextLine&&preserveLines)runs.push(new word.TextRun({break:1}));
    else if(previous&&!/\s$/.test(previous.text)&&!/^\s/.test(text.text)&&(nextLine||text.box[0]-previous.box[0]-previous.box[2]>text.size*.12))runs.push(new word.TextRun(" "));
    const main=sorted.filter(t=>sameLine(t,text)).sort((a,b)=>b.size-a.size)[0];
    runs.push(run(text,fonts,text.text,(main?.baseline||text.baseline)-text.baseline));
  }return runs;
}
function metrics(texts:WordText[],fallback=0){
  const sorted=texts.slice().sort((a,b)=>a.baseline-b.baseline||a.box[0]-b.box[0]),size=Math.max(1,...texts.map(t=>t.size)),lines:WordText[][]=[];
  for(const text of sorted){const last=lines.at(-1);if(last&&last.some(t=>sameLine(t,text)))last.push(text);else lines.push([text]);}
  const baselines=lines.map(line=>line.slice().sort((a,b)=>b.size-a.size)[0].baseline);
  lines.forEach(line=>line.sort((a,b)=>a.box[0]-b.box[0]));
  const gaps=baselines.slice(1).map((y,i)=>y-baselines[i]).filter(g=>g>size*.6&&g<size*2.5).sort((a,b)=>a-b),line=gaps.length?gaps[Math.floor(gaps.length/2)]:fallback||size*1.2;
  return {lines,size,line,top:(baselines[0]||0)-line+size*.205,height:line*lines.length};
}
function paragraph(block:TextBlock,texts:WordText[],fonts:LocalFontFace[],pageWidth?:number,flow?:{margin:number;width:number;before:number;line:number}){
  const children=texts.length?textRuns(texts,fonts,!!pageWidth):[new word.TextRun({text:block.text,font:"Arial",size:24})];
  if(pageWidth){const size=Math.max(1,...texts.map(t=>t.size)),first=texts.slice().sort((a,b)=>a.baseline-b.baseline)[0],baselines=[...new Set(texts.map(t=>Math.round(t.baseline*10)/10))].sort((a,b)=>a-b),steps=baselines.slice(1).map((y,i)=>y-baselines[i]).filter(gap=>gap>size*.6),line=steps.length?steps.sort((a,b)=>a-b)[Math.floor(steps.length/2)]:size*1.15;
    const centers=baselines.map(y=>{const row=texts.filter(t=>Math.abs(t.baseline-y)<size*.3);return (Math.min(...row.map(t=>t.box[0]))+Math.max(...row.map(t=>t.box[0]+t.box[2])))/2;}),centered=baselines.length>1&&Math.max(...centers)-Math.min(...centers)<size*1.5;
    const padding=size*.9,left=Math.max(0,block.box[0]-(centered?padding/2:0));
    return new word.Paragraph({alignment:centered?word.AlignmentType.CENTER:word.AlignmentType.LEFT,frame:{type:"absolute",position:{x:twips(left),y:twips(first?first.baseline-line+descent(first,fonts):block.box[1])},width:twips(Math.min(pageWidth-left,block.box[2]+padding)),anchor:{horizontal:word.FrameAnchorType.PAGE,vertical:word.FrameAnchorType.PAGE},wrap:word.FrameWrap.NONE,anchorLock:true},spacing:{before:0,after:0,line:twips(line),lineRule:word.LineRuleType.EXACT},children});
  }
  if(flow){
    const {lines,size}=metrics(texts),first=lines[0]||[],left=Math.min(...texts.map(t=>t.box[0])),right=Math.max(...texts.map(t=>t.box[0]+t.box[2]));
    const marker=first.length>1&&/^\s*(?:•|\d{1,3}[.)]?|[a-z][.)]|[ivxlcdm]+[.)])\s*$/i.test(first[0].text),bodyLeft=marker?first[1].box[0]:left;
    // A PDF list label is already part of its text. Adding Word's automatic bullet duplicates it.
    if(marker){children.length=0;children.push(run(first[0],fonts),new word.TextRun({children:[new word.Tab()]}),...textRuns(texts.filter(t=>t!==first[0]),fonts));}
    const centered=!marker&&lines.length===1&&Math.abs((left+right)/2-flow.width/2)<size;
    const narrow=lines.length>1&&right-left<flow.width*.65;
    return new word.Paragraph({widowControl:false,contextualSpacing:false,alignment:centered?word.AlignmentType.CENTER:word.AlignmentType.LEFT,indent:centered?undefined:{left:twips(Math.max(0,bodyLeft-flow.margin)),...(narrow?{right:twips(Math.max(0,flow.width-flow.margin-right-size*.7))}:{}),...(marker?{hanging:twips(bodyLeft-left)}:{})},tabStops:marker?[{type:word.TabStopType.LEFT,position:twips(bodyLeft-flow.margin)}]:undefined,spacing:{before:twips(flow.before),after:0,line:twips(flow.line),lineRule:word.LineRuleType.EXACT},children});
  }
  return new word.Paragraph({spacing:{before:0,after:0},children});
}
function nativeTable(table:WordTable,fonts:LocalFontFace[],available:number,floating=false){
  const scale=Math.min(1,available/table.box[2]),border={style:word.BorderStyle.SINGLE,color:table.stroke,size:Math.max(1,Math.round(table.lineWidth*8))},cols=table.xs.length-1;
  const spans=table.spans||table.cells.map((_,i)=>({row:Math.floor(i/cols),col:i%cols,rowSpan:1,colSpan:1}));
  return new word.Table({width:{size:twips(table.box[2]*scale),type:word.WidthType.DXA},columnWidths:table.xs.slice(0,-1).map((x,i)=>twips((table.xs[i+1]-x)*scale)),...(floating?{float:{horizontalAnchor:word.TableAnchorType.PAGE,verticalAnchor:word.TableAnchorType.PAGE,absoluteHorizontalPosition:twips(table.box[0]),absoluteVerticalPosition:twips(table.box[1]),overlap:word.OverlapType.OVERLAP}}:{indent:{size:twips(Math.max(0,table.box[0]-36)),type:word.WidthType.DXA}}),layout:word.TableLayoutType.FIXED,borders:{top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border},rows:table.ys.slice(0,-1).map((_y,row)=>new word.TableRow({cantSplit:true,height:{value:twips(Math.max(1,table.ys[row+1]-table.ys[row]-table.lineWidth)),rule:word.HeightRule.ATLEAST},children:spans.filter(s=>s.row===row).map(span=>{
    const members=table.cells[row*cols+span.col],m=metrics(members);
    const center=(table.xs[span.col]+table.xs[span.col+span.colSpan])/2,centered=m.lines.length&&m.lines.every(line=>Math.min(...line.map(t=>t.box[0]))-table.xs[span.col]>m.size*.5&&Math.abs((Math.min(...line.map(t=>t.box[0]))+Math.max(...line.map(t=>t.box[0]+t.box[2])))/2-center)<m.size*1.1);
    return new word.TableCell({columnSpan:span.colSpan,rowSpan:span.rowSpan,width:{size:twips((table.xs[span.col+span.colSpan]-table.xs[span.col])*scale),type:word.WidthType.DXA},margins:{top:0,bottom:0,left:twips(4),right:twips(2)},children:m.lines.length?m.lines.map((texts,i)=>new word.Paragraph({alignment:centered?word.AlignmentType.CENTER:word.AlignmentType.LEFT,widowControl:false,spacing:{before:0,after:0,line:twips(Math.max(m.size,i?texts[0].baseline-m.lines[i-1][0].baseline:texts[0].baseline-table.ys[row]+Math.max(...texts.map(t=>descent(t,fonts)))-table.lineWidth/2)),lineRule:word.LineRuleType.EXACT},children:textRuns(texts,fonts)})):[new word.Paragraph({spacing:{before:0,after:0,line:1,lineRule:word.LineRuleType.EXACT}})]});
  })}))});
}
async function semanticTable(table:TableBlock,texts:WordText[],fonts:LocalFontFace[],available:number,graphics:WordLayer[],usedGraphics:Set<number>,signal:AbortSignal,floating=false){
  if(table.rows<1||table.cols<1||table.rows>1000||table.cols>100)throw new Error("A table is too large to reconstruct. Export a smaller page range.");
  const width=Math.min(available,table.box[2]),border={style:word.BorderStyle.SINGLE,color:"000000",size:4};
  return new word.Table({width:{size:twips(width),type:word.WidthType.DXA},columnWidths:Array.from({length:table.cols},()=>twips(width/table.cols)),layout:word.TableLayoutType.FIXED,...(floating?{float:{horizontalAnchor:word.TableAnchorType.PAGE,verticalAnchor:word.TableAnchorType.PAGE,absoluteHorizontalPosition:twips(table.box[0]),absoluteVerticalPosition:twips(table.box[1]),overlap:word.OverlapType.OVERLAP}}:{indent:{size:twips(Math.max(0,table.box[0]-36)),type:word.WidthType.DXA}}),borders:{top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border},rows:await Promise.all(Array.from({length:table.rows},async(_,row)=>{
    const cells:word.TableCell[]=[];
    for(let col=0;col<table.cols;){const cell=table.cells.find(c=>c.row===row&&c.col===col),cover=table.cells.find(c=>c.row<row&&c.row+c.rowSpan>row&&c.col===col);
      if(cover){col+=Math.max(1,cover.colSpan);continue;}
      const span=Math.max(1,Math.min(table.cols-col,cell?.colSpan||1)),matching=cell?.box?texts.filter(t=>contains(cell.box!,t.box)):[];
      const m=metrics(matching),children=[new word.Paragraph({widowControl:false,spacing:{before:0,after:0,line:twips(m.line),lineRule:word.LineRuleType.EXACT},children:matching.length?textRuns(matching,fonts,true):[new word.TextRun({text:cell?.text||"",font:"Arial",size:22,bold:cell?.header})]})];
      for(const layer of graphics)if(cell?.box&&!usedGraphics.has(layer.index)&&contains(cell.box,layer.box)){const picture=await graphic(layer,width/table.cols*span-8,signal);if(picture){usedGraphics.add(layer.index);children.push(picture);}}
      cells.push(new word.TableCell({columnSpan:span,rowSpan:Math.max(1,Math.min(table.rows-row,cell?.rowSpan||1)),width:{size:twips(width/table.cols*span),type:word.WidthType.DXA},margins:{top:0,bottom:0,left:40,right:40},children}));col+=span;
    }return new word.TableRow({cantSplit:true,children:cells});
  }))});
}
const artworkPosition=(box:WordBox):word.IFloating=>({horizontalPosition:{relative:word.HorizontalPositionRelativeFrom.PAGE,offset:Math.round(box[0]*12700)},verticalPosition:{relative:word.VerticalPositionRelativeFrom.PAGE,offset:Math.round(box[1]*12700)},behindDocument:true,allowOverlap:true,wrap:{type:word.TextWrappingType.NONE}});
async function graphic(layer:WordLayer,available:number,signal:AbortSignal,background=false):Promise<word.Paragraph|null>{
  if(layer.kind!=="image"&&layer.kind!=="shape")return null;
  const scale=background?1:Math.min(1,available/Math.max(1,layer.box[2]),400/Math.max(1,layer.box[3])),transformation={width:px(Math.max(.1,layer.box[2])*scale),height:px(Math.max(.1,layer.box[3])*scale)};
  let child:word.ParagraphChild;
  if(layer.kind==="image"){
    const canvas=document.createElement("canvas");canvas.width=layer.width;canvas.height=layer.height;
    try{canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(layer.pixels),layer.width,layer.height),0,0);const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Couldn't preserve a picture.")),"image/png"));signal.throwIfAborted();child=new word.ImageRun({type:"png",data:new Uint8Array(await blob.arrayBuffer()),transformation,...(background?{floating:artworkPosition(layer.box)}:{}),altText:{title:"PDF picture",description:"Original PDF artwork",name:`Picture ${layer.index}`}});}finally{canvas.width=canvas.height=0;}
  }else{const common={transformation,...(background?{floating:artworkPosition(layer.box)}:{}),fill:layer.fill||"none",line:layer.stroke?{color:layer.stroke,width:Math.max(.1,layer.lineWidth*scale)}:"none" as const,altText:{title:"PDF shape",name:`Shape ${layer.index}`}};child=layer.box[2]<.01||layer.box[3]<.01?new ShapeRun({...common,type:"line"}):new ShapeRun({...common,type:"custom",path:layer.path});}
  return new word.Paragraph({spacing:background?{before:0,after:0,line:1,lineRule:word.LineRuleType.EXACT}:{before:80,after:100},children:[child]});
}
async function graphicGroup(layers:WordLayer[],available:number,signal:AbortSignal,background=false){
  if(layers.length===1)return graphic(layers[0],available,signal,background);
  const left=Math.min(...layers.map(l=>l.box[0])),top=Math.min(...layers.map(l=>l.box[1])),width=Math.max(...layers.map(l=>l.box[0]+l.box[2]))-left,height=Math.max(...layers.map(l=>l.box[1]+l.box[3]))-top,scale=background?1:Math.min(1,available/Math.max(1,width),400/Math.max(1,height)),children:IShapeGroupChildOptions[]=[];
  for(const layer of layers.slice().sort((a,b)=>a.index-b.index)){
    signal.throwIfAborted();const transformation={width:px(Math.max(.1,layer.box[2])*scale),height:px(Math.max(.1,layer.box[3])*scale),offset:{left:px((layer.box[0]-left)*scale),top:px((layer.box[1]-top)*scale)}};
    if(layer.kind==="shape"){const common={transformation,fill:layer.fill||"none",line:layer.stroke?{color:layer.stroke,width:Math.max(.1,layer.lineWidth*scale)}:"none" as const};children.push(layer.box[2]<.01||layer.box[3]<.01?{...common,type:"line"}:{...common,type:"custom",path:layer.path});}
    else if(layer.kind==="image"){
      const canvas=document.createElement("canvas");canvas.width=layer.width;canvas.height=layer.height;
      try{canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(layer.pixels),layer.width,layer.height),0,0);const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Couldn't preserve a diagram.")),"image/png"));signal.throwIfAborted();children.push({type:"picture",image:{type:"png",data:new Uint8Array(await blob.arrayBuffer())},transformation});}finally{canvas.width=canvas.height=0;}
    }
  }
  return new word.Paragraph({spacing:background?{before:0,after:0,line:1,lineRule:word.LineRuleType.EXACT}:{before:80,after:100},children:[new ShapeGroupRun({children,transformation:{width:px(width*scale),height:px(height*scale)},...(background?{floating:artworkPosition([left,top,width,height])}:{}),altText:{title:"PDF diagram",name:"PDF diagram"}})]});
}
function section(page:WordPage,children:(word.Paragraph|word.Table)[],positioned=false):word.ISectionOptions{
  const width=Math.min(1584,page.width),height=Math.min(1584,page.height),margin=positioned?1:Math.min(36,width*.06);
  return {properties:{type:word.SectionType.NEXT_PAGE,page:{size:{width:twips(Math.min(width,height)),height:twips(Math.max(width,height)),orientation:width>height?word.PageOrientation.LANDSCAPE:word.PageOrientation.PORTRAIT},margin:{top:twips(positioned?1:24),bottom:twips(positioned?1:24),left:twips(margin),right:twips(margin)}}},children:children.length?children:[new word.Paragraph("")]};
}
export async function editableWord(pdf:PDFDocumentProxy,name:string,pages:number[],dpi:number,password:string|undefined,signal:AbortSignal,progress:(n:number,message:string)=>void){
  const desktop=window.zionpdfDesktop;
  if(!desktop)throw new Error("Editable Word conversion is available in the offline Zion PDF desktop application.");
  const id=crypto.randomUUID(),off=desktop.onWordProgress(event=>{if(event.id===id)progress(event.progress*.7,event.message);}),cancel=()=>void desktop.cancelWord(id);
  signal.throwIfAborted();signal.addEventListener("abort",cancel,{once:true});
  let engine:WordLayoutEngine|undefined;
  try{
    const bytes=await pdf.getData();signal.throwIfAborted();const structure=await desktop.wordStructure(id,bytes,{pages,password});signal.throwIfAborted();
    engine=new WordLayoutEngine(bytes,signal,password);const fonts=await listLocalFonts().catch(()=>[]),sections:word.ISectionOptions[]=[];
    for(let i=0;i<structure.pages.length;i++){
      const semantic=structure.pages[i];progress(.7+.28*i/pages.length,`Building editable page ${semantic.number}`);const native=await engine.page(pdf,semantic.number,dpi);signal.throwIfAborted();
      const originalTexts=native.layers.flatMap(l=>l.kind==="text"?[l]:l.kind==="table"?l.cells.flat():[]),tables=native.layers.filter((l):l is WordTable=>l.kind==="table"),rows=await rowsFor(pdf,semantic.number);
      // PDF.js owns the Unicode text. Native geometry supplies colour and exact font faces,
      // not a second copy of the same sentence with overlapping extraction boundaries.
      let index=0;
      const sourceRows=rows.map(row=>row.runs.flatMap(item=>{
        const candidates=originalTexts.filter(t=>Math.abs(t.baseline-item.y)<Math.min(t.size,item.size)*.4&&t.box[0]<item.x+item.width+2&&t.box[0]+t.box[2]>item.x-2);
        const native=candidates.sort((a,b)=>Math.min(b.box[0]+b.box[2],item.x+item.width)-Math.max(b.box[0],item.x)-(Math.min(a.box[0]+a.box[2],item.x+item.width)-Math.max(a.box[0],item.x)))[0];
        const complete=candidates.filter(t=>t.box[0]>=item.x-item.size*.2&&t.box[0]+t.box[2]<=item.x+item.width+item.size*.2).sort((a,b)=>a.box[0]-b.box[0]),key=(s:string)=>s.normalize("NFKC").replace(/\s/g,"");
        // PDF.js may combine adjacent glyphs with different sizes into one item. Split only
        // when the complete native fragments account for exactly the same Unicode text.
        if(complete.length>1&&key(complete.map(t=>t.text).join(""))===key(item.text)&&complete.some(t=>Math.abs(t.size-item.size)>.2||t.font!==native?.font))return complete.map(t=>({...t,index:index++,box:[...t.box] as WordBox}));
        return [{kind:"text" as const,index:index++,box:[item.x,item.y-item.size*.85,item.width,item.size] as WordBox,text:native?.text.trim()==="•"?"•":item.text,font:native?.text.trim()==="•"?"Arial":native?.font||item.font,size:item.size,color:native?.color||"000000",bold:item.bold,italic:item.italics,baseline:item.y,advance:item.width,horizontalScale:native?.horizontalScale,outline:native?.outline}];
      }));
      const texts=sourceRows.flat(),used=new Set<number>(),usedGraphics=new Set<number>(),recognizedTables=semantic.blocks.filter((b):b is TableBlock=>b.kind==="table"),available=Math.min(native.width,1584)-2;
      await prepareWordFonts(fonts,texts.map(t=>t.font));signal.throwIfAborted();
      const sizes=texts.map(t=>t.size).filter(size=>size>4),positioned=[...tables,...recognizedTables].some(e=>e.box[0]>native.width*.5&&texts.some(t=>t.box[0]+t.box[2]<e.box[0]&&t.baseline>e.box[1]&&t.baseline<e.box[1]+e.box[3]))||(!tables.length&&!recognizedTables.length&&texts.reduce((n,t)=>n+t.text.length,0)<2000&&Math.max(0,...sizes)>Math.min(300,...sizes)*1.5&&native.layers.some(l=>l.kind==="image"&&l.box[2]*l.box[3]>native.width*native.height*.7));
      const tableEvents:{box:WordBox;value:word.Table}[]=[];
      for(const table of tables){
        const cols=table.xs.length-1,spans=table.spans||table.cells.map((_,i)=>({row:Math.floor(i/cols),col:i%cols,rowSpan:1,colSpan:1}));
        table.cells=table.cells.map(()=>[]);
        for(const text of texts){const span=spans.find(s=>contains([table.xs[s.col],table.ys[s.row],table.xs[s.col+s.colSpan]-table.xs[s.col],table.ys[s.row+s.rowSpan]-table.ys[s.row]],text.box));if(span){table.cells[span.row*cols+span.col].push(text);used.add(text.index);}}
        tableEvents.push({box:table.box,value:nativeTable(table,fonts,available,positioned)});
      }
      for(const table of recognizedTables){
        if(tables.some(t=>contains(table.box,t.box)||contains(t.box,table.box)))continue;
        // A one-row form recognized over existing artwork has no recoverable cell grid.
        // Preserve its original boxes and editable labels instead of inventing an oversized table.
        if(table.rows===1&&native.layers.some(l=>l.kind==="image"&&contains(l.box,table.box)))continue;
        const members=texts.filter(t=>!used.has(t.index)&&contains(table.box,t.box));
        if(!members.length)continue;
        members.forEach(t=>used.add(t.index));tableEvents.push({box:table.box,value:await semanticTable(table,members,fonts,available,native.layers.filter(l=>l.kind==="image"),usedGraphics,signal,positioned)});
      }

      const textBlocks=semantic.blocks.filter((b):b is TextBlock=>b.kind==="text"),groups:{owner:number;texts:WordText[]}[]=[],artwork:WordLayer[]=native.layers.filter(l=>(l.kind==="shape"||l.kind==="image")&&!usedGraphics.has(l.index)),footers:WordText[]=[];
      for(const row of sourceRows){
        const members=row.filter(t=>!used.has(t.index)).filter(t=>{
          if(/^[_\s]+$/.test(t.text)){const y=t.baseline+t.size*.08;artwork.push({kind:"shape",index:100000+t.index,box:[t.box[0],y,t.box[2],0],path:`M ${t.box[0]} ${y} L ${t.box[0]+t.box[2]} ${y}`,stroke:t.color,lineWidth:.5});return false;}
          if(t.box[1]>native.height*.94&&/^\s*\d+\s*$/.test(t.text)){footers.push(t);return false;}
          return true;
        });
        if(!members.length)continue;
        const scores=textBlocks.map((b,owner)=>({owner,score:members.reduce((n,t)=>n+(contains(b.box,t.box)?t.text.length:0),0)})).sort((a,b)=>b.score-a.score),owner=scores[0]?.score?scores[0].owner:-1,last=groups.at(-1),previous=last?.texts.at(-1),first=members[0];
        const same=last&&last.owner===owner&&previous&&first.baseline-previous.baseline<Math.max(first.size,previous.size)*2.2&&Math.abs(first.size-previous.size)<Math.max(first.size,previous.size)*.4;
        if(same)last.texts.push(...members);else groups.push({owner,texts:members});
      }
      const graphics:WordLayer[][]=[];
      for(const layer of artwork){
        if(tables.some(t=>contains(t.box,layer.box)))continue;
        if(layer.kind==="shape"&&Math.min(layer.box[2],layer.box[3])<=1.5&&recognizedTables.some(t=>contains(t.box,layer.box))&&tableEvents.some(t=>contains(t.box,layer.box)))continue;
        if(layer.kind==="shape"&&layer.fill?.toLowerCase()==="ffffff"&&!layer.stroke&&layer.box[2]*layer.box[3]>native.width*native.height*.8)continue;
        const expanded:WordBox=[layer.box[0]-2,layer.box[1]-2,layer.box[2]+4,layer.box[3]+4],hits=graphics.filter(group=>group.some(other=>intersects(expanded,other.box)));
        if(!hits.length)graphics.push([layer]);else{hits[0].push(layer);for(const group of hits.slice(1)){hits[0].push(...group);graphics.splice(graphics.indexOf(group),1);}}
      }
      const children:(word.Paragraph|word.Table)[]=[];
      for(const group of graphics){const value=await graphicGroup(group,available,signal,true);if(value)children.push(value);}
      for(const footer of footers)children.push(paragraph({kind:"text",box:footer.box,text:footer.text,label:"text"},[footer],fonts,native.width));
      if(positioned)children.push(...tableEvents.map(e=>e.value));
      const margin=positioned?1:Math.min(36,native.width*.06),steps=sourceRows.slice(1).map((row,j)=>row[0]?.baseline-sourceRows[j][0]?.baseline).filter(g=>g>10&&g<24).sort((a,b)=>a-b),defaultLine=steps.length?steps[Math.floor(steps.length/2)]:0;
      let cursor=24;
      const pending=positioned?[]:tableEvents.slice().sort((a,b)=>a.box[1]-b.box[1]);
      for(const group of groups){
        while(pending.length&&pending[0].box[1]<group.texts[0].baseline){
          const table=pending.shift()!,gap=Math.max(.05,table.box[1]-cursor);
          children.push(new word.Paragraph({spacing:{before:0,after:0,line:twips(gap),lineRule:word.LineRuleType.EXACT},children:[]}));
          children.push(table.value);cursor=Math.max(cursor,table.box[1])+table.box[3];
        }
        const members=group.texts,x=Math.min(...members.map(t=>t.box[0])),y=Math.min(...members.map(t=>t.box[1])),box:WordBox=[x,y,Math.max(...members.map(t=>t.box[0]+t.box[2]))-x,Math.max(...members.map(t=>t.box[1]+t.box[3]))-y],block:TextBlock={kind:"text",box,text:"",label:textBlocks[group.owner]?.label||"text"},nearby=sourceRows.slice(1).map((row,j)=>({gap:row[0].baseline-sourceRows[j][0].baseline,distance:Math.min(...members.map(t=>Math.abs(t.baseline-row[0].baseline)))})).filter(s=>s.gap>members[0].size*.8&&s.gap<members[0].size*1.8).sort((a,b)=>a.distance-b.distance),m=metrics(members,nearby[0]?.gap||defaultLine);
        const before=Math.max(0,m.top-cursor);
        children.push(paragraph(block,members,fonts,positioned?native.width:undefined,{margin,width:native.width,before,line:m.line}));
        if(!positioned)cursor+=before+m.height;
      }
      children.push(...pending.map(e=>e.value));
      sections.push(section(native,children,positioned));
    }
    signal.throwIfAborted();progress(.99,"Finishing editable Word document");return new Uint8Array(await word.Packer.toArrayBuffer(new word.Document({creator:"Zion PDF",title:name,sections})));
  }finally{off();signal.removeEventListener("abort",cancel);engine?.close();}
}

