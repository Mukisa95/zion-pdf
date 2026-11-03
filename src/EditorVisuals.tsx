import {useLayoutEffect,useRef} from "react";
import type {CSSProperties} from "react";
import type {PDFViewer} from "./viewer";
import type {TextStyleRun} from "./editor/pdfium";
import type {LocalFontFace} from "./editor/fonts";
export type PixelFrame={pixels:Uint8ClampedArray;width:number;height:number};
export type ObjectLayers={background:Uint8ClampedArray;foreground:Uint8ClampedArray;width:number;height:number;key:string};
export type VisualBox=[number,number,number,number];
type Viewport=ReturnType<PDFViewer["getPageView"]>["viewport"];
export const screenBox=(viewport:Viewport,bounds:VisualBox)=>{const a=viewport.convertToViewportPoint(bounds[0],bounds[1]),b=viewport.convertToViewportPoint(bounds[2],bounds[3]);return {left:Math.min(a[0],b[0]),top:Math.min(a[1],b[1]),width:Math.abs(b[0]-a[0]),height:Math.abs(b[1]-a[1])};};
export function PixelCanvas({frame,className="",style}:{frame:PixelFrame;className?:string;style?:CSSProperties}){
  const canvas=useRef<HTMLCanvasElement>(null);
  useLayoutEffect(()=>{const target=canvas.current;if(!target)return;target.width=frame.width;target.height=frame.height;target.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels),frame.width,frame.height),0,0);},[frame.pixels,frame.width,frame.height]);
  return <canvas className={className} ref={canvas} style={style} aria-hidden="true"/>;
}
export function ObjectGhost({layers,fallback,bounds,destination,viewport}:{layers:ObjectLayers|null;fallback:HTMLCanvasElement|null;bounds:VisualBox;destination:VisualBox;viewport:Viewport}){
  const canvas=useRef<HTMLCanvasElement>(null),source=screenBox(viewport,bounds),next=screenBox(viewport,destination);
  useLayoutEffect(()=>{const target=canvas.current;if(!target)return;let image=fallback;
    if(layers){image=document.createElement("canvas");image.width=layers.width;image.height=layers.height;image.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(layers.foreground),layers.width,layers.height),0,0);}
    if(!image)return;const sx=image.width/viewport.width,sy=image.height/viewport.height;
    target.width=Math.max(1,Math.ceil(source.width*sx));target.height=Math.max(1,Math.ceil(source.height*sy));
    target.getContext("2d")!.drawImage(image,source.left*sx,source.top*sy,source.width*sx,source.height*sy,0,0,target.width,target.height);
  },[layers?.foreground,fallback,bounds.join(","),viewport.width,viewport.height]);
  return <>{layers&&<PixelCanvas className="editor-object-background" frame={{pixels:layers.background,width:layers.width,height:layers.height}}/>}<canvas ref={canvas} className="editor-object-ghost" data-live-object style={{left:source.left,top:source.top,width:source.width,height:source.height,transformOrigin:"top left",transform:`translate(${next.left-source.left}px,${next.top-source.top}px) scale(${next.width/Math.max(.01,source.width)},${next.height/Math.max(.01,source.height)})`}}/></>;
}
export function LiveText({text,runs,faces,fontFamily,fontSize,unitScale,color,scaleX,lineHeight,tracking,alignment,underline,bold,italic}:{text:string;runs:TextStyleRun[];faces:LocalFontFace[];fontFamily:string;fontSize:number;unitScale:number;color:string;scaleX:number;lineHeight:number;tracking:number;alignment:string;underline:boolean;bold:boolean;italic:boolean}){
  const cuts=[...new Set([0,text.length,...runs.flatMap(run=>[run.start,run.end])])].filter(i=>i>=0&&i<=text.length).sort((a,b)=>a-b);
  return <div className="editor-live-text" data-live-text aria-hidden="true" style={{width:`${100/Math.max(.01,scaleX)}%`,transform:`scaleX(${scaleX})`,transformOrigin:"top left",fontFamily,fontSize,color,lineHeight,fontWeight:bold?700:400,fontStyle:italic?"italic":"normal",letterSpacing:tracking,textAlign:alignment as CSSProperties["textAlign"],textDecoration:"none"}}>{cuts.slice(0,-1).map((start,i)=>{const run=runs.find(run=>start>=run.start&&start<run.end),face=faces.find(face=>face.postscriptName===run?.fontName);return <span key={start} style={{fontFamily:face?`"${face.family}"`:undefined,fontWeight:face?(/bold|heavy|black|semibold/i.test(face.style)?700:400):undefined,fontStyle:face?(/italic|oblique/i.test(face.style)?"italic":"normal"):undefined,fontSize:run?.fontSize?run.fontSize*unitScale:undefined,color:run?.color,textDecoration:(run?.underline ?? underline)?"underline":"none"}}>{text.slice(start,cuts[i+1])}</span>;})}</div>;
}
