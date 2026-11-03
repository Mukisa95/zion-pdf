import { useRef } from "react";
import type { PDFViewer } from "./viewer";
import { Icon } from "./icons";
type Box=[number,number,number,number];
type View=ReturnType<PDFViewer["getPageView"]>;
/** The frame moves independently of the caret; pointer capture keeps edge drags reliable. */
export function TextCellControls({view,onStart,onPreview,onCommit,onCancel}:{view:View;onStart:(cell:HTMLElement)=>void;onPreview:(box:Box,resize:boolean)=>void;onCommit:(box:Box,resize:boolean)=>void;onCancel:()=>void}) {
  const drag=useRef<{x:number;y:number;box:DOMRect;edge:string}|null>(null);
  const convert=(rect:DOMRect,edge:string,dx:number,dy:number):Box=>{
    const page=view.div.getBoundingClientRect(),vp=view.viewport;
    let x=rect.left-page.left,y=rect.top-page.top,w=rect.width,h=rect.height;
    if(edge==="move"){x+=dx;y+=dy;}
    else {if(edge.includes("w")){const d=Math.min(dx,w-12);x+=d;w-=d;}if(edge.includes("e"))w=Math.max(12,w+dx);if(edge.includes("n")){const d=Math.min(dy,h-12);y+=d;h-=d;}if(edge.includes("s"))h=Math.max(12,h+dy);}
    const a=vp.convertToPdfPoint(x*vp.width/page.width,y*vp.height/page.height),b=vp.convertToPdfPoint((x+w)*vp.width/page.width,(y+h)*vp.height/page.height);
    return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
  };
  return <>{["move","n","s","e","w","ne","nw","se","sw"].map(edge=><button key={edge}
    className={edge==="move"?"inline-text-move":`inline-image-handle handle-${edge}`}
    aria-label={edge==="move"?"Move text cell":`Resize text cell ${edge}`} title={edge==="move"?"Drag to move text; arrow keys to nudge":"Drag to resize text cell"}
    onPointerDown={event=>{event.preventDefault();event.stopPropagation();drag.current={x:event.clientX,y:event.clientY,box:event.currentTarget.parentElement!.getBoundingClientRect(),edge};onStart(event.currentTarget.parentElement!);event.currentTarget.setPointerCapture(event.pointerId);}}
    onPointerMove={event=>{const start=drag.current;if(start)onPreview(convert(start.box,edge,event.clientX-start.x,event.clientY-start.y),edge!=="move");}}
    onPointerUp={event=>{const start=drag.current;drag.current=null;if(!start)return;if(Math.hypot(event.clientX-start.x,event.clientY-start.y)<2){onCancel();return;}onCommit(convert(start.box,edge,event.clientX-start.x,event.clientY-start.y),edge!=="move");}}
    onPointerCancel={()=>{drag.current=null;onCancel();}}
    onKeyDown={event=>{if(!event.key.startsWith("Arrow"))return;event.preventDefault();event.stopPropagation();const step=event.shiftKey?10:1,box=convert(event.currentTarget.parentElement!.getBoundingClientRect(),edge,event.key==="ArrowLeft"?-step:event.key==="ArrowRight"?step:0,event.key==="ArrowUp"?-step:event.key==="ArrowDown"?step:0);onStart(event.currentTarget.parentElement!);onPreview(box,edge!=="move");onCommit(box,edge!=="move");}}
  >{edge==="move"&&<Icon name="move" size={15}/>}</button>)}</>;
}
