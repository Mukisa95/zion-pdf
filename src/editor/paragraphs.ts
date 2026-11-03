import type { PdfTextObject as Text } from "./pdfium";
type Box=Text["bounds"];
const font=(name="")=>name.replace(/^[A-Z]{6}\+/,"").replace(/[\s_-]/g,"").toLowerCase();
const size=(line:Text)=>(line.fontSize || 12)*(line.fontScale || 1);
const compatible=(a:Text,b:Text)=>font(a.fontName)===font(b.fontName)&&Math.abs(size(a)-size(b))<=Math.max(.25,size(a)*.025)&&a.color===b.color&&a.underline===b.underline;
const union=(a:Box,b:Box):Box=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])];
const listStart=(text:string)=>/^\s*(?:[•●▪◦]|\d+[.)]|[a-zA-Z][.)])\s+/.test(text);
/** Layout order can differ from painting order, especially around tables and backgrounds. */
export function groupParagraphLines(input:Text[],barriers:Box[]=[]):Text[]{
  const blocked=(a:Box,b:Box)=>{const corridor:Box=[Math.min(a[0],b[0]),Math.min(a[3],b[3]),Math.max(a[2],b[2]),Math.max(a[1],b[1])];return barriers.some(box=>box[0]<corridor[2]&&box[2]>corridor[0]&&box[1]<corridor[3]&&box[3]>corridor[1]);};
  const ordered=[...input].sort((a,b)=>Math.abs(a.bounds[3]-b.bounds[3])<Math.min(size(a),size(b))*.3?a.bounds[0]-b.bounds[0]:b.bounds[3]-a.bounds[3]);
  const lines:Text[]=[];
  for(const item of ordered){const previous=lines.at(-1),gap=previous?item.bounds[0]-previous.bounds[2]:Infinity;
    if(previous&&compatible(previous,item)&&Math.abs(previous.bounds[3]-item.bounds[3])<size(item)*.25&&gap>=-size(item)*.1&&gap<size(item)*.9&&!blocked(previous.bounds,item.bounds)){
      previous.text+=! /\s$/.test(previous.text)&&!/^\s/.test(item.text)&&gap>size(item)*.12?" "+item.text:item.text;previous.members!.push(...(item.members || [item]));previous.bounds=union(previous.bounds,item.bounds);
    }else lines.push({...item,bounds:[...item.bounds],members:[...(item.members || [item])],granularity:"line"});
  }
  const blocks:Text[]=[];
  for(const line of lines){let best:Text|undefined,bestGap=Infinity;
    if(!listStart(line.text))for(const block of blocks){const previous=block.lines!.at(-1)!,points=size(line),gap=previous.bounds[1]-line.bounds[3],left=Math.abs(block.bounds[0]-line.bounds[0]),overlap=Math.min(previous.bounds[2],line.bounds[2])-Math.max(previous.bounds[0],line.bounds[0]);
      if(compatible(previous,line)&&gap>=-points*.15&&gap<points*.95&&left<points*1.6&&overlap>Math.min(previous.bounds[2]-previous.bounds[0],line.bounds[2]-line.bounds[0])*.45&&!blocked(previous.bounds,line.bounds)&&gap<bestGap){best=block;bestGap=gap;}
    }
    if(best){best.lines!.push(line);best.members!.push(...line.members!);best.text+="\n"+line.text;best.bounds=union(best.bounds,line.bounds);}
    else blocks.push({...line,bounds:[...line.bounds],members:[...line.members!],lines:[line],granularity:"paragraph"});
  }
  return blocks.sort((a,b)=>a.index-b.index);
}
