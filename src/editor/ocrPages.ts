export function parseOcrPages(value:string,count:number):number[]{
  const pages=new Set<number>();for(const item of value.split(",")){const match=item.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!match)throw new Error("Enter pages such as 1, 3-5.");const start=Number(match[1]),end=Number(match[2]||match[1]);if(start<1||end<start||end>count)throw new Error(`Choose pages between 1 and ${count}.`);for(let page=start;page<=end;page++)pages.add(page);}return [...pages].sort((a,b)=>a-b);
}
