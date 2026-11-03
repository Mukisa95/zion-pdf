import type { TextStyleRun } from "./pdfium";
export function styleRange(runs:TextStyleRun[],start:number,end:number,patch:Partial<TextStyleRun>):TextStyleRun[]{
  const cuts=[...new Set([start,end,...runs.flatMap(run=>[run.start,run.end])])].sort((a,b)=>a-b),result:TextStyleRun[]=[];
  for(let i=0;i<cuts.length-1;i++){const a=cuts[i],b=cuts[i+1],old=runs.find(run=>run.start<=a&&run.end>=b);if(!old&&(a<start||b>end))continue;result.push({...old,...(a>=start&&b<=end?patch:{}),start:a,end:b});}return result;
}
export function shiftStyles(runs:TextStyleRun[],before:string,after:string):TextStyleRun[]{
  let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;let end=before.length,next=after.length;while(end>start&&next>start&&before[end-1]===after[next-1]){end--;next--;}
  const delta=next-end;return runs.flatMap(run=>{const a=run.start<start?run.start:run.start>=end?run.start+delta:start,b=run.end<=start?run.end:run.end>=end?run.end+delta:next;return b>a?[{...run,start:a,end:b}]:[];});
}
