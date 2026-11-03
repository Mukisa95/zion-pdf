import { useEffect, useId, useRef, useState } from "react";
import type { LocalFontFace } from "./editor/fonts";
import { Icon } from "./icons";
import {fontFamilyOptions,fontForFamily,fontTraits,sameFontFamily} from "./fontOptions";

export function FontSelect({label,value,faces,original,kind="family",onChange}:{label:string;value:string;faces:LocalFontFace[];original?:string;kind?:"family"|"style";onChange:(value:string)=>void}) {
  const [open,setOpen]=useState(false),[query,setQuery]=useState(""),[highlight,setHighlight]=useState(0);
  const id=useId();
  const root=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null),search=useRef<HTMLInputElement>(null);
  const choices=kind==="family"?fontFamilyOptions(faces):faces;
  const options=choices.filter(face=>(kind==="family"?face.family:face.style).toLowerCase().includes(query.toLowerCase()));
  const selected=faces.find(face=>face.postscriptName===value);
  const appearance=(face?:LocalFontFace)=>{
    if(!face)return undefined;
    const {weight,italic}=fontTraits(face);
    return {fontFamily:JSON.stringify(face.family),fontWeight:weight,fontStyle:italic?"italic" as const:"normal" as const,fontStretch:/condensed|narrow/i.test(face.style)?"condensed":/expanded|extended/i.test(face.style)?"expanded":"normal"};
  };
  const text=(face:LocalFontFace)=>kind==="style"?face.style:face.family;
  useEffect(()=>{if(!open)return;search.current?.focus();const dismiss=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};window.addEventListener("pointerdown",dismiss);return()=>window.removeEventListener("pointerdown",dismiss);},[open]);
  const choose=(value:string)=>{const family=faces.find(face=>face.postscriptName===value);onChange(kind==="family"&&family?fontForFamily(faces,family,selected).postscriptName:value);setOpen(false);setQuery("");button.current?.focus({preventScroll:true});};
  return <div className="font-picker" ref={root}>
    <button ref={button} type="button" role="combobox" aria-label={label} aria-expanded={open} aria-haspopup="listbox" aria-controls={`${id}-list`} className="font-picker-trigger" onClick={()=>{setOpen(!open);setHighlight(0);}} style={appearance(selected)}><span>{selected?text(selected):original || "Original style"}</span><Icon name="chevronDown" size={14}/></button>
    {open && <div className="font-picker-menu" onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();setOpen(false);button.current?.focus({preventScroll:true});}else if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();const next=Math.max(0,Math.min(options.length-1,highlight+(event.key==="ArrowDown"?1:-1)));setHighlight(next);root.current?.querySelector(`[data-font-index="${next}"]`)?.scrollIntoView({block:"nearest"});}else if(event.key==="Enter"&&event.target===search.current&&options[highlight]){event.preventDefault();choose(options[highlight].postscriptName);}}}>
      <input ref={search} aria-label={`Search ${label.toLowerCase()}`} aria-controls={`${id}-list`} aria-activedescendant={options[highlight]?`${id}-${highlight}`:undefined} placeholder="Search" value={query} onChange={event=>{setQuery(event.target.value);setHighlight(0);}} />
      <div id={`${id}-list`} role="listbox" aria-label={`${label} options`} className="font-picker-list">
        {original && !query && <button type="button" role="option" aria-selected={!value} onClick={()=>choose("")}>{original}</button>}
        {options.map((face,index)=><button type="button" role="option" id={`${id}-${index}`} data-font-index={index} className={highlight===index?"highlighted":""} aria-selected={kind==="family"?!!selected&&sameFontFamily(face,selected):value===face.postscriptName} key={face.postscriptName} style={appearance(face)} onMouseMove={()=>setHighlight(index)} onClick={()=>choose(face.postscriptName)}>{text(face)}</button>)}
        {!options.length && <span className="inline-editor-hint">No matching fonts</span>}
      </div>
    </div>}
  </div>;
}
