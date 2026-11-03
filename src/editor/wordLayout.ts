import type {WrappedPdfiumModule as Api} from "@embedpdf/pdfium";
import {withDocument,withPage,objectBounds,objectText,heap} from "./pdfium.ts";
export type WordBox=[number,number,number,number];
export type WordText={kind:"text";index:number;box:WordBox;text:string;font:string;size:number;color:string;bold:boolean;italic:boolean;baseline:number;advance:number;outline?:boolean;horizontalScale?:number};
export type WordShape={kind:"shape";index:number;box:WordBox;path:string;fill?:string;stroke?:string;lineWidth:number;segments?:[number,number,number,number][]};
export type WordImage={kind:"image";index:number;box:WordBox;width:number;height:number;pixels:Uint8ClampedArray};
export type WordTable={kind:"table";index:number;box:WordBox;xs:number[];ys:number[];cells:WordText[][];spans?:{row:number;col:number;rowSpan:number;colSpan:number}[];stroke:string;lineWidth:number};
export type WordLayer=WordText|WordShape|WordImage|WordTable;
export type WordPage={width:number;height:number;layers:WordLayer[];appearance?:boolean};
const overlaps=(a:WordBox,b:WordBox)=>a[0]<b[0]+b[2]-.5&&a[0]+a[2]>b[0]+.5&&a[1]<b[1]+b[3]-.5&&a[1]+a[3]>b[1]+.5;
const hex=(values:number[])=>values.slice(0,3).map(v=>Math.max(0,Math.min(255,v)).toString(16).padStart(2,"0")).join("");
function mergeText(layers:WordLayer[]):WordLayer[]{
  const result:WordLayer[]=[];let previousIndex=-2;
  for(const layer of layers){const last=result.at(-1);
    if(last?.kind==="text"&&layer.kind==="text"&&layer.index===previousIndex+1&&last.font===layer.font&&last.color===layer.color&&last.bold===layer.bold&&last.italic===layer.italic&&Math.abs(last.size-layer.size)<.05&&Math.abs(last.baseline-layer.baseline)<.2){
      const gap=layer.box[0]-last.box[0]-last.box[2];
      if(gap>=-last.size*.15&&gap<last.size*.8){
        last.text+=! /\s$/.test(last.text)&&!/^\s/.test(layer.text)&&gap>last.size*.2?" "+layer.text:layer.text;
        last.advance=Math.max(last.advance,layer.box[0]-last.box[0]+layer.advance);
        const right=Math.max(last.box[0]+last.box[2],layer.box[0]+layer.box[2]),bottom=Math.max(last.box[1]+last.box[3],layer.box[1]+layer.box[3]);last.box=[Math.min(last.box[0],layer.box[0]),Math.min(last.box[1],layer.box[1]),0,0];last.box[2]=right-last.box[0];last.box[3]=bottom-last.box[1];previousIndex=layer.index;continue;
      }
    }
    result.push(layer.kind==="text"?{...layer,box:[...layer.box]}:layer);previousIndex=layer.index;
  }return result;
}
/** Ruled grids, including merged headings, become editable Word tables. */
export function wordTables(layers:WordLayer[]):WordLayer[]{
  // Office commonly writes table borders as filled, sub-point rectangles rather than stroked paths.
  const rules=layers.filter((l):l is WordShape=>l.kind==="shape"&&!!l.segments?.length&&((!!l.stroke&&!l.fill&&l.lineWidth<=3)||(!!l.fill&&Math.min(l.box[2],l.box[3])<=3))).map(shape=>{
    if(!shape.fill)return shape;
    const [x,y,w,h]=shape.box;
    const segments:[number,number,number,number][]=h>3&&w<=3?[[x+w/2,y,x+w/2,y+h]]:[[x,y+h/2,x+w,y+h/2]];
    return {...shape,stroke:shape.fill,fill:undefined,lineWidth:Math.min(w,h),segments};
  });
  if(rules.reduce((n,l)=>n+l.segments!.length,0)>400)return layers;
  const segments=rules.flatMap(shape=>shape.segments!.map(points=>({shape,points}))),groups:typeof segments[]=[];
  const intersects=(a:typeof segments[number],b:typeof segments[number])=>{const [x,y,r,t]=a.points,[u,v,s,w]=b.points;return Math.min(x,r)<=Math.max(u,s)+1&&Math.max(x,r)>=Math.min(u,s)-1&&Math.min(y,t)<=Math.max(v,w)+1&&Math.max(y,t)>=Math.min(v,w)-1;};
  for(const segment of segments){const hits=groups.filter(group=>group.some(other=>intersects(segment,other)));if(!hits.length)groups.push([segment]);else{hits[0].push(segment);for(const group of hits.slice(1)){hits[0].push(...group);groups.splice(groups.indexOf(group),1);}}}
  const removed=new Set<number>(),tables:WordTable[]=[];
  const unique=(values:number[])=>[...values].sort((a,b)=>a-b).filter((value,i,array)=>!i||value-array[i-1]>1);
  const covers=(intervals:[number,number][],start:number,end:number)=>{let at=start;for(const [l,r] of intervals.sort((a,b)=>a[0]-b[0])){if(l>at+1)return false;at=Math.max(at,r);}return at>=end-1;};
  for(const group of groups){
    const vertical=group.filter(({points:[x,y,r,t]})=>Math.abs(x-r)<.5&&Math.abs(y-t)>3),horizontal=group.filter(({points:[x,y,r,t]})=>Math.abs(y-t)<.5&&Math.abs(x-r)>3);
    const xs=unique(vertical.map(l=>l.points[0])),ys=unique(horizontal.map(l=>l.points[1]));if(xs.length<2||ys.length<2||xs.length>30||ys.length>100)continue;
    if(group.some(l=>l.shape.stroke!==group[0].shape.stroke))continue;
    const vCovers=(x:number,a:number,b:number)=>covers(vertical.filter(l=>Math.abs(l.points[0]-x)<1).map(l=>[Math.min(l.points[1],l.points[3]),Math.max(l.points[1],l.points[3])]),a,b),hCovers=(y:number,a:number,b:number)=>covers(horizontal.filter(l=>Math.abs(l.points[1]-y)<1).map(l=>[Math.min(l.points[0],l.points[2]),Math.max(l.points[0],l.points[2])]),a,b);
    if(!vCovers(xs[0],ys[0],ys.at(-1)!)||!vCovers(xs.at(-1)!,ys[0],ys.at(-1)!)||!hCovers(ys[0],xs[0],xs.at(-1)!)||!hCovers(ys.at(-1)!,xs[0],xs.at(-1)!))continue;
    const box:WordBox=[xs[0],ys[0],xs.at(-1)!-xs[0],ys.at(-1)!-ys[0]],ids=new Set(group.map(l=>l.shape.index));
    if(rules.some(shape=>ids.has(shape.index)&&shape.segments!.some(points=>!group.some(l=>l.shape===shape&&l.points===points))))continue;
    if(layers.some(l=>{
      if(l.kind!=="image"||!overlaps(box,l.box))return false;
      const x0=Math.max(0,Math.floor((box[0]-l.box[0])/l.box[2]*l.width)),x1=Math.min(l.width,Math.ceil((box[0]+box[2]-l.box[0])/l.box[2]*l.width)),y0=Math.max(0,Math.floor((box[1]-l.box[1])/l.box[3]*l.height)),y1=Math.min(l.height,Math.ceil((box[1]+box[3]-l.box[1])/l.box[3]*l.height));
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(l.pixels[(y*l.width+x)*4+3])return true;
      return false;
    }))continue;
    const cols=xs.length-1,rows=ys.length-1,parents=Array.from({length:rows*cols},(_,i)=>i),find=(i:number):number=>parents[i]===i?i:(parents[i]=find(parents[i])),join=(a:number,b:number)=>{parents[find(a)]=find(b);};
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){if(c+1<cols&&!vCovers(xs[c+1],ys[r],ys[r+1]))join(r*cols+c,r*cols+c+1);if(r+1<rows&&!hCovers(ys[r+1],xs[c],xs[c+1]))join(r*cols+c,(r+1)*cols+c);}
    const components=new Map<number,number[]>();for(let i=0;i<parents.length;i++){const key=find(i);components.set(key,[...(components.get(key)||[]),i]);}
    const spans=[...components.values()].map(ids=>{const rs=ids.map(i=>Math.floor(i/cols)),cs=ids.map(i=>i%cols);return {row:Math.min(...rs),col:Math.min(...cs),rowSpan:Math.max(...rs)-Math.min(...rs)+1,colSpan:Math.max(...cs)-Math.min(...cs)+1,count:ids.length};});
    if(spans.length<2||spans.some(s=>s.rowSpan*s.colSpan!==s.count))continue;
    const texts=layers.filter((l):l is WordText=>l.kind==="text"&&overlaps(box,l.box)),cells:WordText[][]=Array.from({length:rows*cols},()=>[]);let valid=true;
    for(const text of texts){const span=spans.find(s=>text.box[0]>=xs[s.col]-1&&text.box[0]+text.box[2]<=xs[s.col+s.colSpan]+1&&text.box[1]>=ys[s.row]-1&&text.box[1]+text.box[3]<=ys[s.row+s.rowSpan]+1);if(!span){valid=false;break;}cells[span.row*cols+span.col].push(text);}
    if(!valid||!texts.length||(xs.length-1)*(ys.length-1)<2)continue;
    const first=Math.min(...group.map(l=>l.shape.index),...texts.map(l=>l.index)),last=Math.max(...group.map(l=>l.shape.index),...texts.map(l=>l.index));
    if(layers.some(l=>!ids.has(l.index)&&!texts.some(t=>t.index===l.index)&&l.index>first&&l.index<last&&overlaps(box,l.box)))continue;
    group.forEach(l=>removed.add(l.shape.index));texts.forEach(l=>removed.add(l.index));
    tables.push({kind:"table",index:Math.max(...group.map(l=>l.shape.index),...texts.map(l=>l.index)),box,xs,ys,cells,spans,stroke:group[0].shape.stroke!,lineWidth:group[0].shape.lineWidth});
  }
  return [...layers.filter(l=>!removed.has(l.index)),...tables].sort((a,b)=>a.index-b.index);
}
/** Unconverted objects are painted in their original stacking order, never omitted. */
export function extractWordPage(api:Api,bytes:Uint8Array,index:number,width:number,height:number,transform:number[],dpi:number,password?:string):WordPage {
  const point=(x:number,y:number):[number,number]=>[transform[0]*x+transform[2]*y+transform[4],transform[1]*x+transform[3]*y+transform[5]];
  const box=(bounds:number[],parent:number[]):WordBox=>{const project=(x:number,y:number)=>point(parent[0]*x+parent[2]*y+parent[4],parent[1]*x+parent[3]*y+parent[5]);const pts=[project(bounds[0],bounds[1]),project(bounds[2],bounds[1]),project(bounds[0],bounds[3]),project(bounds[2],bounds[3])],xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);return [Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)];};
  return withDocument(api,bytes,doc=>withPage(api,doc,index,(page,textPage,release)=>{
    const ptr=api.pdfium.wasmExports.malloc(128);if(!ptr)throw new Error("Not enough memory to export this page.");
    const identity=[1,0,0,1,0,0],entries:{object:number;parent:number[];active:boolean;complex:boolean}[]=[],converted=new Map<number,WordText|WordShape>();
    const multiply=(a:number[],b:number[])=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
    const visit=(object:number,parent:number[],active:boolean,complex:boolean,depth:number)=>{
      if(entries.length>20000)throw new Error("This page contains too many objects to reconstruct at once.");
      api.FPDFPageObj_GetIsActive(object,ptr);active=active&&!!api.pdfium.getValue(ptr,"i32");
      if(api.FPDFPageObj_GetType(object)===5&&depth<16&&api.FPDFPageObj_GetMatrix(object,ptr)){
        const local=[0,4,8,12,16,20].map(o=>api.pdfium.getValue(ptr+o,"float")),matrix=multiply(parent,local),nextComplex=complex||!!api.FPDFPageObj_HasTransparency(object);
        for(let i=0,n=api.FPDFFormObj_CountObjects(object);i<n;i++)visit(api.FPDFFormObj_GetObject(object,i),matrix,active,nextComplex,depth+1);
      }else entries.push({object,parent,active,complex});
    };
    try{for(let i=0,n=api.FPDFPage_CountObjects(page);i<n;i++)visit(api.FPDFPage_GetObject(page,i),identity,true,false,0);}catch(error){api.pdfium.wasmExports.free(ptr);throw error;}
    // Shared form handles cannot be toggled per placement. Keep those uncommon placements as artwork.
    if(new Set(entries.map(e=>e.object)).size!==entries.length){entries.length=0;for(let i=0,n=api.FPDFPage_CountObjects(page);i<n;i++){const object=api.FPDFPage_GetObject(page,i);api.FPDFPageObj_GetIsActive(object,ptr);entries.push({object,parent:identity,active:!!api.pdfium.getValue(ptr,"i32"),complex:false});}}
    const objects=entries.map(e=>e.object),count=objects.length;
    const color=(object:number,stroke=false)=>{const ok=stroke?api.FPDFPageObj_GetStrokeColor(object,ptr+32,ptr+36,ptr+40,ptr+44):api.FPDFPageObj_GetFillColor(object,ptr+32,ptr+36,ptr+40,ptr+44);return ok?[32,36,40,44].map(o=>api.pdfium.getValue(ptr+o,"i32")):null;};
    try{
      for(const [i,object] of objects.entries()){
        if(!entries[i].active)continue;
        const type=api.FPDFPageObj_GetType(object);let optionalLayer=false;
        for(let mark=0;mark<api.FPDFPageObj_CountMarks(object);mark++)if(api.FPDFPageObjMark_GetName(api.FPDFPageObj_GetMark(object,mark),ptr+48,64,ptr+116)&&api.pdfium.getValue(ptr+116,"i32")<=64&&api.pdfium.UTF16ToString(ptr+48)==="OC")optionalLayer=true;
        if(optionalLayer&&type!==1)continue;
        const clip=api.FPDFPageObj_GetClipPath(object);if(clip&&api.FPDFClipPath_CountPaths(clip)>0&&type!==1)continue;
        if(!api.FPDFPageObj_GetMatrix(object,ptr))continue;const m=multiply(entries[i].parent,[0,4,8,12,16,20].map(o=>api.pdfium.getValue(ptr+o,"float")));if(entries[i].complex&&type!==1)continue;
        if(type===1){
          const text=objectText(api,object,textPage).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,"");
          const renderMode=api.FPDFTextObj_GetTextRenderMode(object);if(!text.trim()||/[\r\n\u0590-\u08ff]/.test(text)||![0,1,2].includes(renderMode)||!api.FPDFTextObj_GetFontSize(object,ptr+24))continue;
          const origin=point(m[4],m[5]),up=point(m[4]+m[2],m[5]+m[3]),right=point(m[4]+m[0],m[5]+m[1]);
          if(Math.abs(up[0]-origin[0])>.01||Math.abs(right[1]-origin[1])>.01||right[0]<=origin[0]||up[1]>=origin[1])continue;
          const size=api.pdfium.getValue(ptr+24,"float"),font=api.FPDFTextObj_GetFont(object),rgba=color(object,renderMode!==0);if(!rgba||rgba[3]!==255)continue;
          const length=api.FPDFFont_GetBaseFontName(font,ptr+48,72),name=length>0&&length<=72?api.pdfium.UTF8ToString(ptr+48):"Arial";
          const bounds=box(objectBounds(api,object),entries[i].parent);let advance=0;for(const char of text)if(api.FPDFFont_GetGlyphWidth(font,char.codePointAt(0)!,size,ptr+28))advance+=api.pdfium.getValue(ptr+28,"float")*(right[0]-origin[0]);
          converted.set(i,{kind:"text",index:i,box:bounds,text,font:name.replace(/^[A-Z]{6}\+/,""),size:size*(origin[1]-up[1]),color:hex(rgba),bold:/bold|black|heavy/i.test(name),italic:/italic|oblique/i.test(name),baseline:origin[1],advance:Math.max(bounds[2],advance),outline:renderMode!==0,horizontalScale:Math.max(1,Math.min(600,Math.round((right[0]-origin[0])/(origin[1]-up[1])*100)))});
        }else if(type===2&&api.FPDFPath_GetDrawMode(object,ptr+24,ptr+28)&&api.FPDFPageObj_GetDashCount(object)===0){
          const fillMode=api.pdfium.getValue(ptr+24,"i32"),stroked=!!api.pdfium.getValue(ptr+28,"i32"),fill=fillMode?color(object):null,stroke=stroked?color(object,true):null;
          if(fillMode&&!fill||stroked&&!stroke)continue;
          if(fill&&fill[3]!==255||stroke&&stroke[3]!==255)continue;
          if(stroked&&Math.abs(Math.hypot(m[0],m[1])-Math.hypot(m[2],m[3]))>.01)continue;
          const commands:string[]=[],segments:[number,number,number,number][]=[],points:{type:number;x:number;y:number;close:boolean}[]=[];let valid=true;
          for(let s=0;s<api.FPDFPath_CountSegments(object);s++){const part=api.FPDFPath_GetPathSegment(object,s);if(!api.FPDFPathSegment_GetPoint(part,ptr+24,ptr+28)){valid=false;break;}const x=api.pdfium.getValue(ptr+24,"float"),y=api.pdfium.getValue(ptr+28,"float"),[px,py]=point(m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]);points.push({type:api.FPDFPathSegment_GetType(part),x:px,y:py,close:api.FPDFPathSegment_GetClose(part)});}
          if(!valid||points.length>1000||fill&&points.filter(p=>p.type===2).length>1||points.some(p=>p.type===1)&&points.length!==13)continue;
          let start:typeof points[number]|undefined,previous:typeof points[number]|undefined,axis=true;
          for(let s=0;s<points.length;s++){const p=points[s];if(p.type===2){commands.push(`M ${p.x} ${p.y}`);start=p;}else if(p.type===0){commands.push(`L ${p.x} ${p.y}`);if(previous){segments.push([previous.x,previous.y,p.x,p.y]);if(Math.abs(previous.x-p.x)>.5&&Math.abs(previous.y-p.y)>.5)axis=false;}}else if(p.type===1&&points[s+1]?.type===1&&points[s+2]?.type===1){const q=points[++s],r=points[++s];commands.push(`C ${p.x} ${p.y} ${q.x} ${q.y} ${r.x} ${r.y}`);axis=false;if(r.close)commands.push("Z");previous=r;continue;}else{valid=false;break;}if(p.close&&start){commands.push("Z");segments.push([p.x,p.y,start.x,start.y]);}previous=p;}
          if(!valid||!points.length)continue;
          const xs=points.map(p=>p.x),ys=points.map(p=>p.y),bounds:WordBox=[Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)];
          const lineWidth=api.FPDFPageObj_GetStrokeWidth(object,ptr+24)?api.pdfium.getValue(ptr+24,"float")*Math.sqrt(Math.abs((m[0]*m[3]-m[1]*m[2])*(transform[0]*transform[3]-transform[1]*transform[2]))):1;
          converted.set(i,{kind:"shape",index:i,box:bounds,path:commands.join(" "),fill:fill?hex(fill):undefined,stroke:stroke?hex(stroke):undefined,lineWidth,...(axis?{segments}:{})});
        }
      }
      const groups:number[][]=[];for(let i=0;i<count;i++)if(!converted.has(i)){if(i&&groups.at(-1)?.at(-1)===i-1)groups.at(-1)!.push(i);else groups.push([i]);}
      if(converted.size>20000)throw new Error("This page has too many objects. Export fewer pages.");
      const scale=Math.min(dpi/72,Math.sqrt(24000000/(width*height*Math.max(1,groups.length))),10000/Math.max(width,height)),w=Math.max(1,Math.ceil(width*scale)),h=Math.max(1,Math.ceil(height*scale)),layers:WordLayer[]=[...converted.values()];
      const active=entries.map(entry=>entry.active);release();
      // Text inside forms is reconstructed as Word paragraphs too. Keep it out of the artwork raster.
      const suppressText=(form:number,depth:number)=>{if(depth>16)return;for(let i=0,n=api.FPDFFormObj_CountObjects(form);i<n;i++){const child=api.FPDFFormObj_GetObject(form,i),type=api.FPDFPageObj_GetType(child);if(type===1)api.FPDFPageObj_SetIsActive(child,false);else if(type===5)suppressText(child,depth+1);}};
      for(const object of objects)if(api.FPDFPageObj_GetType(object)===5)suppressText(object,0);
      for(const group of groups){
        const selected=new Set(group);objects.forEach((object,i)=>api.FPDFPageObj_SetIsActive(object,active[i]&&selected.has(i)&&api.FPDFPageObj_GetType(object)!==1));
        const bitmap=api.FPDFBitmap_Create(w,h,1);if(!bitmap)throw new Error("Not enough memory to keep this page's artwork.");
        try{api.FPDFBitmap_FillRect(bitmap,0,0,w,h,0);api.FPDF_RenderPageBitmap(bitmap,page,0,0,w,h,0,1);const memory=heap(api),buffer=api.FPDFBitmap_GetBuffer(bitmap),stride=api.FPDFBitmap_GetStride(bitmap);let left=w,top=h,right=-1,bottom=-1;
          for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(memory[buffer+y*stride+x*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
          if(right<left)continue;const rw=right-left+1,rh=bottom-top+1,pixels=new Uint8ClampedArray(rw*rh*4);for(let y=0;y<rh;y++)for(let x=0;x<rw;x++){const s=buffer+(top+y)*stride+(left+x)*4,d=(y*rw+x)*4;pixels[d]=memory[s+2];pixels[d+1]=memory[s+1];pixels[d+2]=memory[s];pixels[d+3]=memory[s+3];}
          layers.push({kind:"image",index:group[0] ?? 0,box:[left/w*width,top/h*height,rw/w*width,rh/h*height],width:rw,height:rh,pixels});
        }finally{api.FPDFBitmap_Destroy(bitmap);}
      }
      return {width,height,layers:wordTables(mergeText(layers.sort((a,b)=>a.index-b.index))),appearance:false};
    }finally{api.pdfium.wasmExports.free(ptr);}
  }),{readOnly:true,password});
}
