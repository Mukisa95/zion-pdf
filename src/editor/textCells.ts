import type { WrappedPdfiumModule as Api } from "@embedpdf/pdfium";
import { withDocument, withPage, heap, objectText, objectBounds, simpleMark, requireSimpleTransform, saveDocument, inspectTextGroups, inspectParagraphs, type PdfTextObject as Text, type TextFormatting as Format } from "./pdfium.ts";
import { embeddingRights, hasFontCharacters, validFontSize } from "./fonts.ts";
type Box = [number,number,number,number];
type Cell = { id:string; bounds:Box; text:string; members:{text:string;bounds:Box}[]; format:Format; fontName?:string; fontSize?:number; fontScale?:number; fontScaleX?:number; color?:string;cap?:number };
const marker="ZionPdfTextCell:v1";
export { store as storeTextCell };
const union=(items:{bounds:Box}[]):Box=>[Math.min(...items.map(i=>i.bounds[0])),Math.min(...items.map(i=>i.bounds[1])),Math.max(...items.map(i=>i.bounds[2])),Math.max(...items.map(i=>i.bounds[3]))];
const validBox=(box:Box)=>Array.isArray(box)&&box.length===4&&box.every(v=>Number.isFinite(v)&&Math.abs(v)<100000)&&box[2]-box[0]>=1&&box[3]-box[1]>=1;
// Existing text follows its glyph bounds; a deliberately resized cell retains the user's dimensions.
export const textCellBounds=(text:Text):Box=>text.cell?.bounds || [text.bounds[0],text.bounds[1],Math.max(text.bounds[2],text.bounds[0]+1),Math.max(text.bounds[3],text.bounds[1]+1)];
function getString(api:Api,annot:number,key:string) {
  const length=api.FPDFAnnot_GetStringValue(annot,key,0,0);
  if(length<2||length>512*1024)return "";
  const ptr=api.pdfium.wasmExports.malloc(length);
  try {api.FPDFAnnot_GetStringValue(annot,key,ptr,length);return api.pdfium.UTF16ToString(ptr);}finally{api.pdfium.wasmExports.free(ptr);}
}
function setString(api:Api,annot:number,key:string,value:string) {
  const ptr=api.pdfium.wasmExports.malloc((value.length+1)*2);
  try {api.pdfium.stringToUTF16(value,ptr,(value.length+1)*2);if(!api.FPDFAnnot_SetStringValue(annot,key,ptr))throw new Error("Couldn't store the text cell.");}finally{api.pdfium.wasmExports.free(ptr);}
}
function cells(api:Api,page:number):{cell:Cell;index:number}[] {
  const result:{cell:Cell;index:number}[]=[];
  for(let i=0;i<api.FPDFPage_GetAnnotCount(page);i++) {
    const annot=api.FPDFPage_GetAnnot(page,i);if(!annot)continue;
    try {const name=getString(api,annot,"NM");if(![marker,"FolioTextCell:v1"].some(prefix=>name===prefix||name.startsWith(prefix+":")))continue;const cell=JSON.parse(getString(api,annot,"Contents")) as Cell;
      if(typeof cell.id==="string"&&typeof cell.text==="string"&&validBox(cell.bounds)&&Array.isArray(cell.members)&&cell.members.length<=10000&&cell.members.every(m=>typeof m.text==="string"&&Array.isArray(m.bounds)&&m.bounds.length===4&&m.bounds.every(Number.isFinite)))result.push({cell,index:i});
    }catch{}finally{api.FPDFPage_CloseAnnot(annot);}
  }return result;
}
function store(api:Api,page:number,cell:Cell) {
  const payload=JSON.stringify(cell);if((payload.length+1)*2>512*1024)throw new Error("This text cell is too large. Split it into smaller cells.");
  for(const entry of cells(api,page).reverse())if(entry.cell.id===cell.id)api.FPDFPage_RemoveAnnot(page,entry.index);
  const annot=api.FPDFPage_CreateAnnot(page,5),ptr=api.pdfium.wasmExports.malloc(16);
  if(!annot)throw new Error("Couldn't retain the text cell bounds.");
  try {[cell.bounds[0],cell.bounds[3],cell.bounds[2],cell.bounds[1]].forEach((v,i)=>api.pdfium.setValue(ptr+i*4,v,"float"));
    if(!api.FPDFAnnot_SetRect(annot,ptr)||!api.FPDFAnnot_SetFlags(annot,34))throw new Error("Couldn't retain the text cell bounds.");
    setString(api,annot,"NM",marker+":"+cell.id);setString(api,annot,"Contents",payload);
  }finally{api.FPDFPage_CloseAnnot(annot);api.pdfium.wasmExports.free(ptr);}
}
export function inspectEditableText(api:Api,bytes:Uint8Array,index:number,granularity="paragraph"):Text[] {
  const groups=granularity==="paragraph"?inspectParagraphs(api,bytes,index):inspectTextGroups(api,bytes,index,granularity==="line");
  const raw=inspectTextGroups(api,bytes,index).flatMap(group=>group.members || [group]);
  return withDocument(api,bytes,doc=>withPage(api,doc,index,page=>{
    const assigned=new Set<number>(), result:Text[]=[];
    for(const {cell} of cells(api,page)) {
      const members:Text[]=[];
      for(const fingerprint of cell.members) {
        const item=raw.find(item=>!assigned.has(item.index)&&item.text.trimEnd()===fingerprint.text.trimEnd()&&item.bounds.every((v,i)=>Math.abs(v-fingerprint.bounds[i])<.15));
        if(!item){members.length=0;break;}members.push(item);
      }
      if(!members.length)continue;
      members.forEach(item=>assigned.add(item.index));
      const first=members[0];
      result.push({...first,bounds:members.some(m=>m.bounds[3]>m.bounds[1])?union(members.filter(m=>m.bounds[3]>m.bounds[1])):cell.bounds,members,text:cell.text,fontName:cell.fontName || first.fontName,fontSize:cell.fontSize || first.fontSize,fontScale:cell.fontScale || first.fontScale,fontScaleX:cell.fontScaleX || first.fontScaleX,color:cell.color || first.color,underline:cell.format?.underline,cell:{id:cell.id,bounds:cell.bounds,format:cell.format,cap:cell.cap}});
    }
    for(const group of groups){const members=(group.members || [group]).filter(item=>!assigned.has(item.index));if(members.length===(group.members || [group]).length)result.push(group);else for(const item of members)result.push({...item,members:[item]});}
    return result.sort((a,b)=>a.index-b.index);
  }));
}
function check(api:Api,page:number,textPage:number,expected:Text) {
  const members=expected.members || [expected];
  if(!members.length || new Set(members.map(m=>m.index)).size!==members.length)throw new Error("Select the text again.");
  return members.map(member=>{const object=api.FPDFPage_GetObject(page,member.index);if(!object||api.FPDFPageObj_GetType(object)!==1||objectText(api,object,textPage).trimEnd()!==member.text.trimEnd()||objectBounds(api,object).some((v,i)=>Math.abs(v-member.bounds[i])>.15))throw new Error("The document changed. Select the text again.");return object;});
}
function fontData(api:Api,font:number):Uint8Array|undefined {
  const sizePtr=api.pdfium.wasmExports.malloc(4);
  try {if(!api.FPDFFont_GetFontData(font,0,0,sizePtr))return;const size=api.pdfium.getValue(sizePtr,"i32");if(size<12||size>64*1024*1024)return;
    const ptr=api.pdfium.wasmExports.malloc(size);try{if(!api.FPDFFont_GetFontData(font,ptr,size,sizePtr))return;return heap(api).slice(ptr,ptr+size);}finally{api.pdfium.wasmExports.free(ptr);}
  }finally{api.pdfium.wasmExports.free(sizePtr);}
}
export function textCellFont(api:Api,bytes:Uint8Array,index:number,expected:Text):Uint8Array|undefined {
  return withDocument(api,bytes,doc=>withPage(api,doc,index,(page,textPage)=>fontData(api,api.FPDFTextObj_GetFont(check(api,page,textPage,expected)[0]))));
}
function shiftAnnotations(api:Api,page:number,old:Box,next:Box,ownerId:string,initialize:boolean) {
  const sx=(next[2]-next[0])/(old[2]-old[0]),sy=(next[3]-next[1])/(old[3]-old[1]),ptr=api.pdfium.wasmExports.malloc(32);
  const xy=(x:number,y:number)=>[next[0]+(x-old[0])*sx,next[1]+(y-old[1])*sy];
  try {for(let i=0;i<api.FPDFPage_GetAnnotCount(page);i++) {const annot=api.FPDFPage_GetAnnot(page,i);try {
    if(![2,9,10,11,12].includes(api.FPDFAnnot_GetSubtype(annot))||!api.FPDFAnnot_GetRect(annot,ptr))continue;
    const owner=getString(api,annot,"ZionPdfTextCellOwner");if(owner!==ownerId&&(!initialize||owner))continue;
    const [l,t,r,b]=[0,4,8,12].map(o=>api.pdfium.getValue(ptr+o,"float"));if(l<old[0]-2||r>old[2]+2||b<old[1]-2||t>old[3]+2)continue;
    if(!owner)setString(api,annot,"ZionPdfTextCellOwner",ownerId);
    for(let q=0;q<api.FPDFAnnot_CountAttachmentPoints(annot);q++)if(api.FPDFAnnot_GetAttachmentPoints(annot,q,ptr)) {
      for(let p=0;p<4;p++){const [x,y]=xy(api.pdfium.getValue(ptr+p*8,"float"),api.pdfium.getValue(ptr+p*8+4,"float"));api.pdfium.setValue(ptr+p*8,x,"float");api.pdfium.setValue(ptr+p*8+4,y,"float");}api.FPDFAnnot_SetAttachmentPoints(annot,q,ptr);
    }
    const a=xy(l,t),z=xy(r,b);[a[0],a[1],z[0],z[1]].forEach((v,i)=>api.pdfium.setValue(ptr+i*4,v,"float"));api.FPDFAnnot_SetRect(annot,ptr);
  }finally{api.FPDFPage_CloseAnnot(annot);}}}finally{api.pdfium.wasmExports.free(ptr);}
}
export function moveTextCell(api:Api,bytes:Uint8Array,index:number,expected:Text,bounds:Box):{bytes:Uint8Array;cellId:string} {
  if(!validBox(bounds))throw new Error("Choose valid text cell bounds.");
  const id=expected.cell?.id || crypto.randomUUID(),old=textCellBounds(expected),dx=bounds[0]-old[0],dy=bounds[3]-old[3];
  const next:Box=[old[0]+dx,old[1]+dy,old[2]+dx,old[3]+dy];
  const output=withDocument(api,bytes,doc=>{withPage(api,doc,index,(page,textPage,release)=>{
    const handles=check(api,page,textPage,expected);release();for(const handle of handles){api.FPDFPageObj_Transform(handle,1,0,0,1,dx,dy);api.FPDFPageObj_TransformClipPath(handle,1,0,0,1,dx,dy);}
    shiftAnnotations(api,page,old,next,id,!expected.cell);
    store(api,page,{id,bounds:next,text:expected.cell?expected.text:expected.granularity==="paragraph"?expected.text.replace(/\n/g," "):expected.text,members:handles.map((handle,i)=>({text:(expected.members || [expected])[i].text,bounds:objectBounds(api,handle)})),format:{...expected.cell?.format,underline:expected.underline ?? expected.cell?.format?.underline},fontName:expected.fontName,fontSize:expected.fontSize,fontScale:expected.fontScale,fontScaleX:expected.fontScaleX,color:expected.color,cap:expected.cell?.cap});
    if(!api.FPDFPage_GenerateContent(page))throw new Error("Couldn't move the text cell.");
  });return saveDocument(api,doc);});return {bytes:output,cellId:id};
}
export function writeTextCell(api:Api,bytes:Uint8Array,index:number,expected:Text,replacement:string,requested?:Box,fontBytes?:Uint8Array,format:Format={},fallbackFont?:Uint8Array,preview?:(page:number,textPage:number,target:Text)=>void):{bytes:Uint8Array;cellId:string} {
  if(replacement.length>100000||/[^\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{P}\p{N}\p{Zs}\n\r\t]/u.test(replacement))throw new Error("This text needs characters the editor does not support yet.");
  const bounds=[...(requested || textCellBounds(expected))] as Box;if(!validBox(bounds))throw new Error("Choose valid text cell bounds.");
  const id=expected.cell?.id || crypto.randomUUID();
  const output=withDocument(api,bytes,doc=>{withPage(api,doc,index,(page,textPage,release)=>{
    const handles=check(api,page,textPage,expected),source=handles[(expected.members || [expected]).findIndex(item=>item.fontName===expected.fontName)] || handles[0],ptr=api.pdfium.wasmExports.malloc(96);
    let loadedFont=0,fontPtr=0;const richFonts:{font:number;ptr:number}[]=[];
    try {
      for(const handle of handles)requireSimpleTransform(api,handle);
      const renderMode=api.FPDFTextObj_GetTextRenderMode(source);
      if(!api.FPDFPageObj_GetMatrix(source,ptr)||!api.FPDFTextObj_GetFontSize(source,ptr+24)||!api.FPDFPageObj_GetFillColor(source,ptr+28,ptr+32,ptr+36,ptr+40))throw new Error("Couldn't preserve the text font.");
      const matrix=[0,4,8,12,16,20].map(o=>api.pdfium.getValue(ptr+o,"float")),oldSize=expected.fontSize || api.pdfium.getValue(ptr+24,"float");
      const hasStroke=api.FPDFPageObj_GetStrokeColor(source,ptr+48,ptr+52,ptr+56,ptr+60),hasStrokeWidth=api.FPDFPageObj_GetStrokeWidth(source,ptr+64);
      const stroke=hasStroke?[48,52,56,60].map(o=>api.pdfium.getValue(ptr+o,"i32")):[0,0,0,255],strokeWidth=hasStrokeWidth?api.pdfium.getValue(ptr+64,"float"):1;
      const size=format.fontSize ?? oldSize,rgba=[28,32,36,40].map(o=>api.pdfium.getValue(ptr+o,"i32"));
      if(!validFontSize(size,matrix[3]))throw new Error("Choose a font size between 1 and 300.");
      const baseColor=format.color || (expected.cell?expected.color:undefined);
      if(baseColor){if(!/^#[0-9a-f]{6}$/i.test(baseColor))throw new Error("Choose a valid color.");for(let i=0;i<3;i++)rgba[i]=parseInt(baseColor.slice(1+i*2,3+i*2),16);}
      const sx=matrix[0]*(format.horizontalScale || 100)/100,sy=matrix[3],tracking=format.tracking || 0;
      const gap=format.lineHeight?size*sy*format.lineHeight:expected.cell?.format?.lineHeight?size*sy*expected.cell.format.lineHeight:expected.lines&&expected.lines.length>1?Math.abs(expected.lines[0].bounds[3]-expected.lines[1].bounds[3]):size*sy*1.2;
      if(![sx,sy,gap,tracking,format.paragraphSpacing || 0].every(Number.isFinite)||sx<=0||sy<=0||gap<=0||Math.abs(tracking)>20)throw new Error("Choose valid text spacing.");
      let font=api.FPDFTextObj_GetFont(source);
      const contains=(font:number,char:string)=>/\s/u.test(char)||api.FPDFFont_GetGlyphWidth(font,char.codePointAt(0)!,size,ptr+44)&&api.pdfium.getValue(ptr+44,"float")>0;
      const known=new Set<string>();
      for(let i=0;i<api.FPDFPage_CountObjects(page);i++){const object=api.FPDFPage_GetObject(page,i);if(api.FPDFPageObj_GetType(object)===1&&api.FPDFTextObj_GetFont(object)===font)for(const char of objectText(api,object,textPage))known.add(char);}
      const missing=[...replacement].filter(char=>!/\s/u.test(char)&&!known.has(char));
      const data=missing.length&&api.FPDFFont_GetIsEmbedded(font)===1?fontData(api,font):undefined;
      const missingSpace=replacement.includes(" ")&&(!api.FPDFFont_GetGlyphWidth(font,32,size,ptr+44)||api.pdfium.getValue(ptr+44,"float")<=0);
      const needsFont=missingSpace || [...replacement].some(char=>!contains(font,char)) || missing.length>0&&api.FPDFFont_GetIsEmbedded(font)===1&&(!data||!hasFontCharacters(data,missing.join("")));
      if(!fontBytes&&needsFont){if(!fallbackFont)throw new Error("The PDF font lacks a new character. Choose an installed font.");fontBytes=fallbackFont;}
      if(fontBytes){if(!embeddingRights(fontBytes).editable||!hasFontCharacters(fontBytes,replacement.replace(/\s/g,"")))throw new Error("Choose an editable font containing the new characters.");
        fontPtr=api.pdfium.wasmExports.malloc(fontBytes.length);heap(api).set(fontBytes,fontPtr);loadedFont=api.FPDFText_LoadFont(doc,fontPtr,fontBytes.length,new DataView(fontBytes.buffer,fontBytes.byteOffset,fontBytes.byteLength).getUint32(0)===0x4f54544f?1:2,true);if(!loadedFont)throw new Error("Couldn't load the selected font.");font=loadedFont;
      }else if([...replacement].some(char=>!contains(font,char)))throw new Error("The PDF font lacks a new character. Choose an installed font.");
      const runs=format.runs || [];
      if(runs.some(run=>!Number.isInteger(run.start)||!Number.isInteger(run.end)||run.start<0||run.end>replacement.length||run.end<=run.start||run.fontSize!==undefined&&!validFontSize(run.fontSize,sy)))throw new Error("Choose valid character formatting.");
      const resolveFont=(run:typeof runs[number])=>{
        if(run.fontBytes){const data=run.fontBytes;if(!embeddingRights(data).editable||!hasFontCharacters(data,replacement.slice(run.start,run.end).replace(/\s/g,"")))throw new Error("Choose an editable font containing the selected characters.");const memory=api.pdfium.wasmExports.malloc(data.length);heap(api).set(data,memory);const loaded=api.FPDFText_LoadFont(doc,memory,data.length,new DataView(data.buffer,data.byteOffset,data.byteLength).getUint32(0)===0x4f54544f?1:2,true);if(!loaded){api.pdfium.wasmExports.free(memory);throw new Error("Couldn't load a text style.");}richFonts.push({font:loaded,ptr:memory});return loaded;}
        if(run.fontName){const normalize=(name:string)=>name.replace(/^[A-Z]{6}\+/,"").replace(/[^a-z0-9]/gi,"").toLowerCase();const member=(expected.members || [expected]).find(item=>normalize(item.fontName || "")===normalize(run.fontName!));if(member)return api.FPDFTextObj_GetFont(api.FPDFPage_GetObject(page,member.index));throw new Error("The selected text font is unavailable. Choose an installed font.");}return font;
      };
      const resolved=runs.map(run=>({...run,font:resolveFont(run)}));
      const style=(offset:number)=>resolved.find(run=>offset>=run.start&&offset<run.end);
      const advance=(char:string,offset=0)=>{const run=style(offset),face=run?.font || font,points=run?.fontSize || size;if(!api.FPDFFont_GetGlyphWidth(face,char.codePointAt(0)!,points,ptr+44))throw new Error("Couldn't measure text.");return Math.max(0,api.pdfium.getValue(ptr+44,"float")*sx)+tracking;};
      const measure=(value:string,start=0)=>{let offset=start,total=0;for(const char of value){total+=advance(char,offset);offset+=char.length;}return total;};
      const rows:{text:string;paragraphEnd:boolean;start:number}[]=[];
      const logical=replacement.replace(/\r\n?/g,"\n").replace(/\t/g,"    ");
      const bearing=(expected.members?.[0]?.bounds[0] ?? expected.bounds[0])-matrix[4];
      // The selection frame encloses visible ink. Font advance widths also include side bearings.
      // Keep that invisible edge space available so an unchanged line does not wrap its final word.
      const members=new Map(handles.map((handle,i)=>[handle,(expected.members || [expected])[i]]));
      let advanceRight=expected.bounds[2];
      for(let i=0;i<api.FPDFText_CountChars(textPage);i++){
        const object=api.FPDFText_GetTextObject(textPage,i),member=members.get(object);if(!member)continue;
        const char=api.FPDFText_GetUnicode(textPage,i);if(char<=32||!api.FPDFText_GetCharOrigin(textPage,i,ptr+72,ptr+80))continue;
        if(api.FPDFFont_GetGlyphWidth(api.FPDFTextObj_GetFont(object),char,member.fontSize || oldSize,ptr+44))advanceRight=Math.max(advanceRight,api.pdfium.getValue(ptr+72,"double")+api.pdfium.getValue(ptr+44,"float")*(member.fontScaleX || matrix[0]));
      }
      const edgeSpace=Math.max(0,advanceRight-expected.bounds[2])*(size/oldSize);
      const width=Math.max(1,bounds[2]-bounds[0]+bearing+edgeSpace);let paragraphStart=0;
      for(const paragraph of logical.split("\n")){
        let row="",rowStart=paragraphStart;
        for(const match of paragraph.matchAll(/\S+| +/g)){
          const token=match[0];let offset=paragraphStart+match.index;
          if(row && measure(row+token,rowStart)>width+.001){rows.push({text:row.trimEnd(),paragraphEnd:false,start:rowStart});row="";rowStart=offset;if(/^ +$/.test(token))continue;}
          for(const char of token){if(row && measure(row+char,rowStart)>width+.001){rows.push({text:row.trimEnd(),paragraphEnd:false,start:rowStart});row="";rowStart=offset;}if(!row)rowStart=offset;row+=char;offset+=char.length;}
        }rows.push({text:row.trimEnd(),paragraphEnd:true,start:rowStart});paragraphStart+=paragraph.length+1;
      }
      const cap=(expected.cell?.cap ?? Math.max(((expected.members || [expected])[0].bounds[3]-matrix[5]),oldSize*sy*.3))*(size/oldSize);
      let baseline=bounds[3]-Math.max(size*sy*.3,cap),paragraphOffset=0;
      const marks=handles.map(handle=>simpleMark(api,handle));if(marks.some(mark=>mark===undefined))throw new Error("This tagged text cannot be resized yet.");
      const created:{handle:number;text:string;bounds:Box;underline?:boolean;color?:number[]}[]=[];
      for(const [rowIndex,row] of rows.entries()){
        const y=baseline-rowIndex*gap-paragraphOffset;
        let x=bounds[0]-bearing;
        const rowWidth=measure(row.text,row.start),alignment=format.alignment || expected.cell?.format?.alignment || "left";
        if(alignment==="center")x+=(width-rowWidth)/2;else if(alignment==="right")x+=width-rowWidth;
        const spaces=(row.text.match(/ /g)||[]).length,justify=alignment==="justify"&&!row.paragraphEnd&&spaces?Math.max(0,(width-rowWidth)/spaces):0;
        const parts=tracking||justify||runs.length?[...row.text]:[row.text || " "];let partOffset=row.start;
        for(const part of parts){const run=style(partOffset),partColor=run?.color && /^#[0-9a-f]{6}$/i.test(run.color)?[parseInt(run.color.slice(1,3),16),parseInt(run.color.slice(3,5),16),parseInt(run.color.slice(5,7),16),rgba[3]]:rgba;const object=api.FPDFPageObj_CreateTextObj(doc,run?.font || font,run?.fontSize || size);if(!object)throw new Error("Couldn't create the text cell.");let owned=true;
          try {
            const textPtr=api.pdfium.wasmExports.malloc((part.length+1)*2);try{api.pdfium.stringToUTF16(part,textPtr,(part.length+1)*2);if(!api.FPDFText_SetText(object,textPtr))throw new Error("Couldn't update text.");}finally{api.pdfium.wasmExports.free(textPtr);}
            [sx,0,0,sy,x,y].forEach((v,i)=>api.pdfium.setValue(ptr+i*4,v,"float"));
            if(!api.FPDFPageObj_SetMatrix(object,ptr)||!api.FPDFPageObj_SetFillColor(object,...partColor as [number,number,number,number]))throw new Error("Couldn't preserve the font appearance.");
            api.FPDFTextObj_SetTextRenderMode(object,row.text?(renderMode===3&&expected.cell&&expected.text===""?0:renderMode):3);
            api.FPDFPageObj_SetStrokeColor(object,...(format.color?[rgba[0],rgba[1],rgba[2],stroke[3]]:stroke) as [number,number,number,number]);api.FPDFPageObj_SetStrokeWidth(object,strokeWidth);
            const mark=marks[Math.min(rowIndex,marks.length-1)];if(mark){const next=api.FPDFPageObj_AddMark(object,mark.name);if(!next||!api.FPDFPageObjMark_SetIntParam(doc,object,next,"MCID",mark.id))throw new Error("Couldn't preserve text tags.");}
            if(!api.FPDFPage_InsertObjectAtIndex(page,object,Math.min(...(expected.members || [expected]).map(item=>item.index))+created.length))throw new Error("Couldn't retain the text order.");owned=false;created.push({handle:object,text:part,bounds:objectBounds(api,object),underline:run?.underline,color:partColor});
          }finally{if(owned)api.FPDFPageObj_Destroy(object);}
          x+=measure(part,partOffset)+(part===" "?justify:0);partOffset+=part.length;
        }
        if(row.paragraphEnd)paragraphOffset+=format.paragraphSpacing || 0;
      }
      release();for(const handle of handles){if(!api.FPDFPage_RemoveObject(page,handle))throw new Error("Couldn't replace the original text.");api.FPDFPageObj_Destroy(handle);}
      const physical=created.filter(item=>item.bounds[3]>item.bounds[1]);if(physical.length)bounds[1]=Math.min(bounds[1],Math.min(...physical.map(item=>item.bounds[1]))-1);
      if(!validBox(bounds))throw new Error("This text cell is too large. Resize it or split its text.");
      shiftAnnotations(api,page,textCellBounds(expected),bounds,id,!expected.cell);
      const underlined=format.underline ?? expected.underline ?? expected.cell?.format?.underline;
      const oldBox=textCellBounds(expected);
      if(runs.length || underlined || format.underline!==undefined || format.link)for(let i=api.FPDFPage_GetAnnotCount(page)-1;i>=0;i--) {
        const annot=api.FPDFPage_GetAnnot(page,i);let remove=false;
        try{const type=api.FPDFAnnot_GetSubtype(annot);if(getString(api,annot,"ZionPdfTextCellOwner")===id&&((type===10&&(runs.length||underlined||format.underline!==undefined))||(type===2&&format.link))&&api.FPDFAnnot_GetRect(annot,ptr)) {const [l,t,r,b]=[0,4,8,12].map(o=>api.pdfium.getValue(ptr+o,"float"));remove=l>=bounds[0]-2&&r<=bounds[2]+2&&b>=bounds[1]-2&&t<=bounds[3]+2;}}finally{api.FPDFPage_CloseAnnot(annot);}
        if(remove)api.FPDFPage_RemoveAnnot(page,i);
      }
      if(runs.length || underlined || format.link)for(const row of created.filter(item=>item.bounds[3]>item.bounds[1]))for(const type of [...((row.underline ?? underlined)?[10]:[]),...(format.link?[2]:[])]) {
        const annot=api.FPDFPage_CreateAnnot(page,type),box=row.bounds;
        if(!annot)throw new Error("Couldn't format the text cell.");
        try{setString(api,annot,"ZionPdfTextCellOwner",id);[box[0],box[3],box[2],box[1]].forEach((v,i)=>api.pdfium.setValue(ptr+i*4,v,"float"));api.FPDFAnnot_SetRect(annot,ptr);api.FPDFAnnot_SetFlags(annot,4);
          if(type===10){[box[0],box[3],box[2],box[3],box[0],box[1],box[2],box[1]].forEach((v,i)=>api.pdfium.setValue(ptr+i*4,v,"float"));api.FPDFAnnot_AppendAttachmentPoints(annot,ptr);api.FPDFAnnot_SetColor(annot,0,...(row.color || rgba) as [number,number,number,number]);}
          else {if(!/^https?:\/\//i.test(format.link!))throw new Error("Enter an http or https link.");const data=new TextEncoder().encode(format.link+"\0"),uri=api.pdfium.wasmExports.malloc(data.length);try{heap(api).set(data,uri);if(!api.FPDFAnnot_SetURI(annot,uri))throw new Error("Couldn't add this link.");}finally{api.pdfium.wasmExports.free(uri);}}
        }finally{api.FPDFPage_CloseAnnot(annot);}
      }
      const namePtr=api.pdfium.wasmExports.malloc(512);let name=expected.fontName || "";try{if(api.FPDFFont_GetBaseFontName(font,namePtr,512))name=api.pdfium.UTF8ToString(namePtr);}finally{api.pdfium.wasmExports.free(namePtr);}
      const nextFormat={...expected.cell?.format,...format,runs:runs.map(({fontBytes,...run})=>run),underline:!!underlined,fontSize:size};
      store(api,page,{id,bounds,text:logical,members:created.map(item=>({text:item.text,bounds:item.bounds})),format:nextFormat,fontName:name,fontSize:size,fontScale:sy,fontScaleX:sx,cap,color:"#"+rgba.slice(0,3).map(v=>v.toString(16).padStart(2,"0")).join("")});
      if(preview){
        const start=Math.min(...(expected.members || [expected]).map(item=>item.index)),fresh=api.FPDFText_LoadPage(page);
        try{preview(page,fresh,{...expected,index:start,text:logical,bounds,members:created.map((item,i)=>({index:start+i,text:item.text,bounds:item.bounds})),fontName:name,fontSize:size,fontScale:sy,fontScaleX:sx,cell:{id,bounds,format:nextFormat,cap}});}finally{if(fresh)api.FPDFText_ClosePage(fresh);}
      }else if(!api.FPDFPage_GenerateContent(page))throw new Error("Couldn't update the text cell.");
    }finally{for(const item of richFonts){api.FPDFFont_Close(item.font);api.pdfium.wasmExports.free(item.ptr);}if(loadedFont)api.FPDFFont_Close(loadedFont);if(fontPtr)api.pdfium.wasmExports.free(fontPtr);api.pdfium.wasmExports.free(ptr);}
  });return preview?new Uint8Array():saveDocument(api,doc);});return {bytes:output,cellId:id};
}
function paintPreview(api:Api,page:number,width:number,height:number,rotation:number,transparent=false,annotations=true):Uint8ClampedArray {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>6000000)throw new Error("The text preview is too large.");
    const bitmap=api.FPDFBitmap_Create(width,height,1);if(!bitmap)throw new Error("Couldn't render the text preview.");
    try{api.FPDFBitmap_FillRect(bitmap,0,0,width,height,transparent?0:0xffffffff);api.FPDF_RenderPageBitmap(bitmap,page,0,0,width,height,((rotation/90-api.FPDFPage_GetRotation(page))%4+4)%4,annotations?1:0);
      const buffer=api.FPDFBitmap_GetBuffer(bitmap),stride=api.FPDFBitmap_GetStride(bitmap),pixels=new Uint8ClampedArray(width*height*4),data=heap(api);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){const s=buffer+y*stride+x*4,d=(y*width+x)*4;pixels[d]=data[s+2];pixels[d+1]=data[s+1];pixels[d+2]=data[s];pixels[d+3]=data[s+3];}return pixels;
    }finally{api.FPDFBitmap_Destroy(bitmap);}
}
export function renderTextPreview(api:Api,bytes:Uint8Array,index:number,width:number,height:number,rotation:number):Uint8ClampedArray {return withDocument(api,bytes,doc=>withPage(api,doc,index,page=>paintPreview(api,page,width,height,rotation)));}

/** Map logical insertion offsets to the actual PDF glyph origins, not browser font metrics. */
export function textCaretPositions(api:Api,bytes:Uint8Array,index:number,expected:Text,logical:string):[number,number,number][] | null {
  return withDocument(api,bytes,doc=>withPage(api,doc,index,(page,textPage)=>caretsOnPage(api,page,textPage,expected,logical)));
}
function caretsOnPage(api:Api,page:number,textPage:number,expected:Text,logical:string):[number,number,number][] | null {
    const objects=new Set(check(api,page,textPage,expected));
    const ptr=api.pdfium.wasmExports.malloc(72);if(!ptr)return null;
    try {
      const first=objects.values().next().value;
      if(first && api.FPDFPageObj_GetMatrix(first,ptr) && (Math.abs(api.pdfium.getValue(ptr+4,"float"))>.0001 || Math.abs(api.pdfium.getValue(ptr+8,"float"))>.0001))return null;
      const glyphs:{char:string;x:number;y:number;right:number;size:number}[]=[];
      const rawSize=expected.fontSize || 12,scaleX=expected.fontScaleX || expected.fontScale || 1;
      const measuredSpace=first && api.FPDFFont_GetGlyphWidth(api.FPDFTextObj_GetFont(first),32,rawSize,ptr+48)?api.pdfium.getValue(ptr+48,"float")*scaleX:0;
      const spaceWidth=(measuredSpace>0?measuredSpace:rawSize*scaleX*.25)+(expected.cell?.format?.tracking || 0);
      for(let i=0;i<api.FPDFText_CountChars(textPage);i++){
        const object=api.FPDFText_GetTextObject(textPage,i);if(!objects.has(object))continue;
        const code=api.FPDFText_GetUnicode(textPage,i);if(!code||code>0xffff)continue;
        if(!api.FPDFText_GetCharOrigin(textPage,i,ptr,ptr+8)||!api.FPDFText_GetCharBox(textPage,i,ptr+16,ptr+24,ptr+32,ptr+40))continue;
        const x=api.pdfium.getValue(ptr,"double"),y=api.pdfium.getValue(ptr+8,"double");
        const right=api.pdfium.getValue(ptr+24,"double");
        const size=(expected.fontSize || 12)*(expected.fontScale || 1);
        glyphs.push({char:String.fromCodePoint(code),x,y,right:Math.max(x,right),size});
      }
      const chars=[...logical];if(chars.length!==logical.length)return null;
      const matched:({char:string;x:number;y:number;right:number;size:number}|null)[]=[];let cursor=0;
      for(const char of chars){
        if(/\s/u.test(char)){if(glyphs[cursor]&&/\s/u.test(glyphs[cursor].char))matched.push(glyphs[cursor++]);else matched.push(null);continue;}
        while(cursor<glyphs.length&&/\s/u.test(glyphs[cursor].char))cursor++;
        if(!glyphs[cursor]||glyphs[cursor].char!==char)return null;
        matched.push(glyphs[cursor++]);
      }
      if(!matched.some(Boolean)){
        const box=textCellBounds(expected),size=(expected.fontSize || 12)*(expected.fontScale || 1),origin=glyphs[0];let x=origin?.x ?? box[0],y=origin?.y ?? box[3]-size*.85;
        const positions:[number,number,number][]=[[x,y-size*.25,y+size*.85]];
        for(const char of chars){if(char==="\n"){x=box[0];y-=size*1.2;}else x+=spaceWidth;positions.push([x,y-size*.25,y+size*.85]);}return positions;
      }
      const previous:number[]=[],next:number[]=[],spacing=[0];let seen=-1;
      for(const char of chars)spacing.push(spacing[spacing.length-1]+(char==="\n"?0:1));
      for(let i=0;i<=chars.length;i++){previous[i]=seen;if(i<chars.length&&matched[i])seen=i;}
      seen=-1;for(let i=chars.length;i>=0;i--){if(i<chars.length&&matched[i])seen=i;next[i]=seen;}
      const result:[number,number,number][]=[];
      for(let i=0;i<=chars.length;i++){
        const previousIndex=previous[i],nextIndex=next[i];
        const before=previousIndex<0?null:matched[previousIndex],after=nextIndex<0?null:matched[nextIndex];
        let x:number,y:number,size:number;
        if(before && after && Math.abs(after.y-before.y)>after.size*.45 && i===previousIndex+1){x=before.right;y=before.y;size=before.size;}
        else if(after && (!before || Math.abs(after.y-before.y)>after.size*.45)){x=after.x;y=after.y;size=after.size;}
        else if(before && after){x=before.right+(after.x-before.right)*(i-previousIndex)/(nextIndex-previousIndex);y=before.y;size=before.size;}
        else {const ref=before || after!;x=before?before.right+(spacing[i]-spacing[previousIndex+1])*spaceWidth:ref.x;y=ref.y;size=ref.size;}
        result.push([x,y-size*.25,y+size*.85]);
      }
      return result;
    }finally{api.pdfium.wasmExports.free(ptr);}
}

function annotationLayers(api:Api,page:number,indices:Set<number>,owner?:string){
  const objects=[...indices].map(index=>api.FPDFPage_GetObject(page,index)),textOnly=objects.every(object=>api.FPDFPageObj_GetType(object)===1),boxes=objects.map(object=>objectBounds(api,object)),box=union(boxes.map(bounds=>({bounds}))),ptr=api.pdfium.wasmExports.malloc(16);
  const items:{handle:number;flags:number;selected:boolean}[]=[];
  try{for(let i=0;i<api.FPDFPage_GetAnnotCount(page);i++){const handle=api.FPDFPage_GetAnnot(page,i);if(!handle)continue;let selected=false;
    if(textOnly&&[2,9,10,11,12].includes(api.FPDFAnnot_GetSubtype(handle))&&api.FPDFAnnot_GetRect(handle,ptr)){const [l,t,r,b]=[0,4,8,12].map(offset=>api.pdfium.getValue(ptr+offset,"float"));selected=!!owner&&getString(api,handle,"ZionPdfTextCellOwner")===owner||l>=box[0]-2&&r<=box[2]+2&&b>=box[1]-2&&t<=box[3]+2;}
    items.push({handle,flags:api.FPDFAnnot_GetFlags(handle),selected});}
  }finally{api.pdfium.wasmExports.free(ptr);}return items;
}
export function previewTextCell(api:Api,bytes:Uint8Array,index:number,expected:Text,text:string,bounds:Box|undefined,fontBytes:Uint8Array|undefined,format:Format,fallbackFont:Uint8Array|undefined,width:number,height:number,rotation:number){
  let result:{pixels:Uint8ClampedArray;foreground:Uint8ClampedArray;carets:[number,number,number][]|null;bounds:Box}|undefined;
  writeTextCell(api,bytes,index,expected,text,bounds,fontBytes,format,fallbackFont,(page,textPage,target)=>{
    const carets=caretsOnPage(api,page,textPage,target,text),pixels=paintPreview(api,page,width,height,rotation);
    const selected=new Set((target.members || [target]).map(member=>member.index));
    for(let i=0;i<api.FPDFPage_CountObjects(page);i++)api.FPDFPageObj_SetIsActive(api.FPDFPage_GetObject(page,i),selected.has(i));
    const annotations=annotationLayers(api,page,selected,target.cell?.id);
    try{for(const item of annotations)api.FPDFAnnot_SetFlags(item.handle,item.selected?item.flags:item.flags|2);result={carets,pixels,bounds:textCellBounds(target),foreground:paintPreview(api,page,width,height,rotation,true,true)};}
    finally{for(const item of annotations)api.FPDFPage_CloseAnnot(item.handle);}
  });
  if(!result)throw new Error("Couldn't preview this text.");return result;
}

/** Cache real object pixels and the page behind them once, then move that layer on the display. */
export function renderObjectLayers(api:Api,bytes:Uint8Array,index:number,indices:number[],width:number,height:number,rotation:number){
  return withDocument(api,bytes,doc=>withPage(api,doc,index,(page,_text,release)=>{
    const count=api.FPDFPage_CountObjects(page),selected=new Set(indices);if(!selected.size||indices.some(i=>!Number.isInteger(i)||i<0||i>=count))throw new Error("Select the object again.");release();
    const ptr=api.pdfium.wasmExports.malloc(4),objects=Array.from({length:count},(_,i)=>{const handle=api.FPDFPage_GetObject(page,i);api.FPDFPageObj_GetIsActive(handle,ptr);return {handle,active:!!api.pdfium.getValue(ptr,"i32")};});api.pdfium.wasmExports.free(ptr);
    const annotations=annotationLayers(api,page,selected);
    try{
      for(const [i,item] of objects.entries())api.FPDFPageObj_SetIsActive(item.handle,item.active&&!selected.has(i));
      for(const item of annotations)api.FPDFAnnot_SetFlags(item.handle,item.selected?item.flags|2:item.flags);
      const background=paintPreview(api,page,width,height,rotation);
      for(const [i,item] of objects.entries())api.FPDFPageObj_SetIsActive(item.handle,item.active&&selected.has(i));
      for(const item of annotations)api.FPDFAnnot_SetFlags(item.handle,item.selected?item.flags:item.flags|2);
      const foreground=paintPreview(api,page,width,height,rotation,true,true);return {background,foreground,width,height};
    }finally{for(const item of annotations)api.FPDFPage_CloseAnnot(item.handle);}
  }));
}
