export type Raster={pixels:Uint8ClampedArray;width:number;height:number};
export type NormalBox=[number,number,number,number];
type RecognitionBox={x0:number;y0:number;x1:number;y1:number};
/** Reject stray components attached to capital letters without trimming accents or descenders. */
export function recognitionBox(word:{text:string;bbox:RecognitionBox;symbols?:{text:string;bbox:RecognitionBox;is_superscript?:boolean;is_subscript?:boolean;is_dropcap?:boolean}[]}){
  const letters=word.text.replace(/[^A-Za-z]/g,"");if(letters.length<3||letters!==letters.toUpperCase())return word.bbox;
  const symbols=(word.symbols || []).filter(symbol=>/^[A-Z]$/.test(symbol.text)&&!symbol.is_superscript&&!symbol.is_subscript&&!symbol.is_dropcap);if(symbols.length<3)return word.bbox;
  const heights=symbols.map(symbol=>symbol.bbox.y1-symbol.bbox.y0).sort((a,b)=>a-b),median=heights[heights.length>>1],consistent=symbols.filter(symbol=>{const h=symbol.bbox.y1-symbol.bbox.y0;return h>=median*.75&&h<=median*1.3;});
  if(consistent.length<symbols.length*.6||word.bbox.y1-word.bbox.y0<median*1.4)return word.bbox;
  return {...word.bbox,y0:Math.min(...consistent.map(symbol=>symbol.bbox.y0)),y1:Math.max(...consistent.map(symbol=>symbol.bbox.y1))};
}
const distance=(a:number[],b:number[])=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
/** Segment ink inside OCR word bounds. Pixels outside the ink mask remain byte-for-byte unchanged. */
export function wordAppearance(frame:Raster,box:NormalBox){
  const {width,height,pixels}=frame,x0=Math.max(0,Math.floor(box[0]*width)-1),y0=Math.max(0,Math.floor(box[1]*height)-1),x1=Math.min(width,Math.ceil(box[2]*width)+1),y1=Math.min(height,Math.ceil(box[3]*height)+1);
  const rgb=(x:number,y:number)=>{const at=(Math.max(0,Math.min(height-1,y))*width+Math.max(0,Math.min(width-1,x)))*4;return [pixels[at],pixels[at+1],pixels[at+2]];};
  const mode=(colors:number[][])=>{const bins=new Map<string,number[][]>();for(const color of colors){const key=color.map(v=>v>>4).join(",");const bin=bins.get(key)||[];bin.push(color);bins.set(key,bin);}const best=[...bins.values()].sort((a,b)=>b.length-a.length)[0];return best?best[best.length>>1]:[255,255,255];};
  const edges:number[][]=[];for(let x=x0;x<x1;x+=2){edges.push(rgb(x,y0-2),rgb(x,y1+1));}for(let y=y0;y<y1;y+=2)edges.push(rgb(x0-2,y),rgb(x1+1,y));const background=mode(edges),inkPixels:number[][]=[];
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const color=rgb(x,y);if(distance(color,background)>55)inkPixels.push(color);}
  const ink=mode(inkPixels),vector=ink.map((v,i)=>v-background[i]),length=vector.reduce((sum,v)=>sum+v*v,0),indices:number[]=[],rules=new Set<number>();
  // Check the entire run: the first and last letters can both touch an OCR word's bounds.
  // Comparing only those endpoints would preserve rows of the old letters as false rules.
  const marginX=Math.max(6,Math.ceil((x1-x0)*.1)),marginY=Math.max(6,Math.ceil((y1-y0)*.2));
  for(let y=y0-2;y<=y1+1;y++){if(x0<marginX||x1+marginX>=width||distance(rgb(x0-marginX,y),ink)>35||distance(rgb(x1+marginX,y),ink)>35)continue;let hits=0;for(let x=x0-marginX;x<=x1+marginX;x++)if(distance(rgb(x,y),ink)<35)hits++;if(hits/(x1-x0+2*marginX+1)>.92)rules.add(y);}
  const verticalRules=new Set<number>();for(let x=x0-2;x<=x1+1;x++){if(y0<marginY||y1+marginY>=height||distance(rgb(x,y0-marginY),ink)>35||distance(rgb(x,y1+marginY),ink)>35)continue;let hits=0;for(let y=y0-marginY;y<=y1+marginY;y++)if(distance(rgb(x,y),ink)<35)hits++;if(hits/(y1-y0+2*marginY+1)>.92)verticalRules.add(x);}
  if(length>900)for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    const color=rgb(x,y),alpha=color.reduce((sum,v,i)=>sum+(v-background[i])*vector[i],0)/length;
    if(alpha<.04||alpha>1.3||distance(color,background.map((v,i)=>v+alpha*vector[i]))>28)continue;
    // A rule crossing the full word rectangle belongs to the drawing, not the glyph mask.
    if(rules.has(y)||verticalRules.has(x))continue;
    indices.push((y*width+x)*4);
  }
  // Cover the antialiasing fringe, including its background pixels, before PDF resampling.
  const expanded=new Set(indices);for(const index of indices){const pixel=index/4,x=pixel%width,y=Math.floor(pixel/width);for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const xx=x+dx,yy=y+dy;if(xx<0||xx>=width||yy<0||yy>=height||rules.has(yy)||verticalRules.has(xx))continue;expanded.add((yy*width+xx)*4);}}
  return {color:"#"+ink.map(v=>v.toString(16).padStart(2,"0")).join(""),background,inkCount:indices.length,indices:[...expanded]};
}
export function removeRecognizedInk(frame:Raster,boxes:NormalBox[]){const pixels=new Uint8ClampedArray(frame.pixels);for(const box of boxes){const {background,indices}=wordAppearance(frame,box);for(const index of indices){pixels[index]=background[0];pixels[index+1]=background[1];pixels[index+2]=background[2];}}return {...frame,pixels};}
export function inkRemovalOverlay(frame:Raster,boxes:NormalBox[]){
  const pixels=new Uint8ClampedArray(frame.pixels.length);for(let i=0;i<pixels.length;i+=4)pixels[i]=pixels[i+1]=pixels[i+2]=255;
  for(const box of boxes){const {background,indices}=wordAppearance(frame,box);for(const index of indices){const x=index/4%frame.width,y=Math.floor(index/4/frame.width);for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const xx=x+dx,yy=y+dy;if(xx<0||xx>=frame.width||yy<0||yy>=frame.height)continue;const at=(yy*frame.width+xx)*4;if(!pixels[at+3]){pixels[at]=background[0];pixels[at+1]=background[1];pixels[at+2]=background[2];}}pixels[index]=background[0];pixels[index+1]=background[1];pixels[index+2]=background[2];pixels[index+3]=255;}}
  return {width:frame.width,height:frame.height,pixels};
}
