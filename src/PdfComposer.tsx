import {useEffect,useRef,useState,type CSSProperties,type ReactNode} from "react";
import {Icon} from "./icons";
import {loadPdf,renderThumbnail,type PDFDocumentProxy} from "./pdf";
import {buildPdf,imagePdf,type ImagePaper} from "./composePdf";
import "./pdf-composer.css";

type Item={id:string;name:string;kind:"pdf"|"image";bytes:Uint8Array;pages:number[];pdf?:PDFDocumentProxy;url?:string;password?:string;status:"loading"|"ready"|"locked"|"error";error?:string;current?:boolean};
type Props={mode:"images"|"merge";current?:{name:string;password?:string;prepare:()=>Promise<Uint8Array>};onClose:()=>void;onComplete:(name:string,bytes:Uint8Array)=>Promise<void>};
const IMAGE_TYPES=".jpg,.jpeg,.png,.webp,.bmp,.gif";
export function moveEntry<T>(entries:T[],from:number,to:number){if(from<0||to<0||from>=entries.length||to>=entries.length||from===to)return entries;const result=entries.slice(),[entry]=result.splice(from,1);result.splice(to,0,entry);return result;}

function PageCanvas({pdf,page,width}:{pdf:PDFDocumentProxy;page:number;width:number}){
  const canvas=useRef<HTMLCanvasElement>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{const element=canvas.current;if(!element)return;const abort=new AbortController();let started=false;
    const draw=()=>{if(started)return;started=true;void renderThumbnail(pdf,page,element,width,0,abort.signal).catch(()=>{if(!abort.signal.aborted)setFailed(true);});};
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();draw();}},{rootMargin:"500px"});observer.observe(element);
    return()=>{observer.disconnect();abort.abort();};
  },[pdf,page,width]);
  return failed?<span className="compose-render-error">Preview unavailable</span>:<canvas ref={canvas} aria-label={`Page ${page} preview`}/>;
}
function Action({label,disabled,onClick,children}:{label:string;disabled?:boolean;onClick:()=>void;children:ReactNode}){return <button type="button" className="pill-btn" title={label} aria-label={label} disabled={disabled} onClick={onClick}>{children}</button>;}

export function PdfComposer({mode,current,onClose,onComplete}:Props){
  const [items,setItems]=useState<Item[]>([]),itemsRef=useRef<Item[]>([]),[adding,setAdding]=useState(!!current),addingRef=useRef(!!current),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[error,setError]=useState("");
  const [size,setSize]=useState(()=>{try{return Math.max(120,Math.min(300,Number(localStorage.getItem("zionpdf:gallery-size"))||180));}catch{return 180;}});
  const [preview,setPreview]=useState<string|null>(null),[selected,setSelected]=useState(1),[lead,setLead]=useState("follow"),leadRef=useRef("follow");
  const [paper,setPaper]=useState<ImagePaper>("a4"),[name,setName]=useState(current?`${current.name.replace(/\.pdf$/i,"")} merged.pdf`:mode==="images"?"Images.pdf":"Combined.pdf"),[passwords,setPasswords]=useState<Record<string,string>>({}),[undoCount,setUndoCount]=useState(0);
  const history=useRef<Item[][]>([]),alive=useRef(true),controller=useRef<AbortController|null>(null),dialog=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),previousFocus=useRef(document.activeElement as HTMLElement|null);
  const resources=useRef(new Map<string,ReturnType<typeof loadPdf>>()),urls=useRef(new Map<string,string>()),currentRef=useRef(current),drag=useRef<{kind:"file"|"page";id:string;page?:number}|null>(null);
  const base=currentRef.current;
  const scrollFrame=useRef(0);
  const update=(next:Item[])=>{itemsRef.current=next;if(alive.current)setItems(next);};
  const commit=(change:(entries:Item[])=>Item[])=>{const before=itemsRef.current,next=change(before);if(next===before)return;history.current=[...history.current.slice(-29),before];setUndoCount(history.current.length);update(next);};
  const resetHistory=()=>{history.current=[];setUndoCount(0);const retained=new Set(itemsRef.current.map(i=>i.id));for(const [id,task]of resources.current)if(!retained.has(id)){void task.destroy().catch(()=>{});resources.current.delete(id);}for(const [id,url]of urls.current)if(!retained.has(id)){URL.revokeObjectURL(url);urls.current.delete(id);}};
  const patch=(id:string,change:Partial<Item>)=>update(itemsRef.current.map(item=>item.id===id?{...item,...change}:item));
  const load=async(item:Item,password?:string)=>{
    const task=loadPdf(item.bytes,password);resources.current.set(item.id,task);
    try{const pdf=await task.promise;if(!alive.current)return;patch(item.id,{pdf,password,status:"ready",error:undefined,pages:Array.from({length:pdf.numPages},(_,i)=>i+1)});}
    catch(reason){if(alive.current){const protectedPdf=(reason as {name?:string}).name==="PasswordException";patch(item.id,{status:protectedPdf?"locked":"error",error:protectedPdf?(reason as {code?:number}).code===2?"Incorrect password. Try again.":"Enter the PDF password.":"Couldn't read this PDF. Remove it or add another file."});}resources.current.delete(item.id);await task.destroy().catch(()=>{});}
  };
  useEffect(()=>{
    alive.current=true;dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    if(currentRef.current)void(async()=>{try{const source=currentRef.current!,bytes=await source.prepare();if(!alive.current)return;const item:Item={id:"current",name:source.name,kind:"pdf",bytes,pages:[],status:"loading",current:true};update([item]);await load(item,source.password);}catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:"Couldn't prepare the open PDF.");}finally{addingRef.current=false;if(alive.current)setAdding(false);}})();
    return()=>{alive.current=false;cancelAnimationFrame(scrollFrame.current);controller.current?.abort();for(const task of resources.current.values())void task.destroy().catch(()=>{});for(const url of urls.current.values())URL.revokeObjectURL(url);previousFocus.current?.focus({preventScroll:true});};
  },[]);
  useEffect(()=>{dialog.current?.querySelector<HTMLButtonElement>(".compose-toolbar button")?.focus();},[preview]);
  const add=async(files:File[])=>{
    if(addingRef.current||busy||!files.length)return;
    if(itemsRef.current.length+files.length>100){setError("Use up to 100 files at a time.");return;}
    if(itemsRef.current.reduce((n,i)=>n+i.bytes.length,0)+files.reduce((n,f)=>n+f.size,0)>300*1024*1024){setError("Choose files with a combined size below 300 MB.");return;}
    setError("");resetHistory();addingRef.current=true;setAdding(true);
    try{for(const file of files){
      if(!alive.current)return;
      const kind=/\.pdf$/i.test(file.name)||file.type==="application/pdf"?"pdf":/\.(jpe?g|png|webp|bmp|gif)$/i.test(file.name)?"image":null;
      if(!kind){setError(`“${file.name}” isn't a supported PDF or image.`);continue;}
      const bytes=new Uint8Array(await file.arrayBuffer());if(!alive.current)return;
      const item:Item={id:crypto.randomUUID(),name:file.name,kind,bytes,pages:kind==="image"?[1]:[],status:kind==="image"?"ready":"loading"};
      if(kind==="image"){item.url=URL.createObjectURL(file);urls.current.set(item.id,item.url);}
      const before=itemsRef.current,at=leadRef.current==="lead"?before.findIndex(i=>i.current):-1;
      update(at>=0?[...before.slice(0,at),item,...before.slice(at)]:[...before,item]);
      if(kind==="pdf")await load(item);
    }}catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:"Couldn't add the files.");}
    finally{addingRef.current=false;if(alive.current)setAdding(false);}
  };
  const pick=(type:"pdf"|"image")=>{if(!input.current)return;input.current.accept=type==="pdf"?"application/pdf,.pdf":IMAGE_TYPES;input.current.click();};
  const changeLead=(value:string)=>{setLead(value);leadRef.current=value;commit(entries=>{const base=entries.find(i=>i.current);if(!base)return entries;const others=entries.filter(i=>!i.current);return value==="lead"?[...others,base]:[base,...others];});};
  const syncPlacement=(entries:Item[])=>{if(!base||entries.length<2)return;const at=entries.findIndex(i=>i.current),placement=at===0?"follow":at===entries.length-1?"lead":"custom";leadRef.current=placement;setLead(placement);};
  const moveFile=(id:string,to:number)=>commit(entries=>{const next=moveEntry(entries,entries.findIndex(i=>i.id===id),to);syncPlacement(next);return next;});
  const active=items.find(i=>i.id===preview),selectedIndex=active?.pages.indexOf(selected)??-1;
  useEffect(()=>{if(active&&!active.pages.includes(selected))setSelected(active.pages[0]);},[active,selected]);
  const movePage=(item:Item,page:number,to:number)=>commit(entries=>entries.map(i=>i.id===item.id?{...i,pages:moveEntry(i.pages,i.pages.indexOf(page),to)}:i));
  const removePage=(item:Item,page:number)=>{if(item.pages.length<=1)return;const pages=item.pages.filter(p=>p!==page);commit(entries=>entries.map(i=>i.id===item.id?{...i,pages}:i));setSelected(pages[Math.min(item.pages.indexOf(page),pages.length-1)]);};
  const canBuild=items.length>0&&items.every(i=>i.status==="ready"&&i.pages.length)&&!adding&&!busy&&(!base||items.some(i=>i.current));
  const build=async()=>{
    if(!canBuild)return;const abort=new AbortController();controller.current=abort;setBusy(true);setError("");setProgress(0);
    try{
      const sources=[];for(const [index,item]of items.entries()){abort.signal.throwIfAborted();sources.push({bytes:item.kind==="image"?await imagePdf(item.bytes,paper,abort.signal):item.bytes,pages:item.pages,password:item.password});if(alive.current)setProgress(.4*(index+1)/items.length);}
      const bytes=await buildPdf(sources,abort.signal,n=>{if(alive.current)setProgress(.4+n*.6);});abort.signal.throwIfAborted();
      const filename=(name.trim()||"Combined.pdf").replace(/\.pdf$/i,"")+".pdf";await onComplete(filename,bytes);if(alive.current)onClose();
    }catch(reason){if(alive.current&&!abort.signal.aborted)setError(reason instanceof Error?reason.message:"Couldn't create the PDF.");}
    finally{if(alive.current)setBusy(false);}
  };
  const stopDrop=(event:React.DragEvent)=>{event.preventDefault();event.stopPropagation();};
  const total=items.reduce((n,i)=>n+i.pages.length,0);
  return <div className="modal-backdrop compose-backdrop" onDragOver={stopDrop} onDrop={event=>{stopDrop(event);if(event.dataTransfer.files.length)void add(Array.from(event.dataTransfer.files));}}>
    <div ref={dialog} className="pdf-composer" role="dialog" aria-modal="true" aria-label={mode==="images"?"Create PDF from images":"Merge PDFs"} onKeyDown={event=>{
      if(event.key==="Escape"){event.preventDefault();event.stopPropagation();if(preview)setPreview(null);else onClose();}
      if(event.key==="Tab"){const all=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')||[]).filter(e=>e.offsetParent!==null),first=all[0],last=all.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    }}>
      <header className="compose-head"><div><h2>{active?active.name:mode==="images"?"Create PDF from images":"Merge PDFs"}</h2><span>{active?active.kind==="pdf"?`${active.pages.length} ${active.pages.length===1?"page":"pages"} · drag pages to reorder`:"Image preview":`${items.length} ${items.length===1?"file":"files"} · ${total} ${total===1?"page":"pages"}`}</span></div><Action label="Close PDF workspace" onClick={onClose}><Icon name="close" size={19}/></Action></header>
      <div className="compose-toolbar">
        {preview?<button className="btn ghost" onClick={()=>setPreview(null)}><span className="compose-back-arrow"><Icon name="chevronRight" size={16}/></span> Back to files</button>:<><button className="btn primary" disabled={adding||busy} onClick={()=>pick(mode==="images"?"image":"pdf")}><Icon name={mode==="images"?"image":"plus"} size={16}/>{mode==="images"?"Add images":"Add PDFs"}</button><button className="btn ghost" disabled={adding||busy} onClick={()=>pick(mode==="images"?"pdf":"image")}><Icon name={mode==="images"?"file":"image"} size={16}/>{mode==="images"?"Add PDFs":"Add images"}</button></>}
        <Action label="Undo arrangement" disabled={!undoCount||adding||busy} onClick={()=>{const previous=history.current.pop();if(previous){update(previous);syncPlacement(previous);setUndoCount(history.current.length);}}}><Icon name="undo" size={17}/></Action>
        <div className="compose-toolbar-end">{!preview&&base&&<label className="compose-placement">Added files<select aria-label="Merge placement" value={lead} disabled={adding||busy} onChange={e=>changeLead(e.target.value)}><option value="lead">Lead — before current PDF</option><option value="follow">Follow — after current PDF</option>{lead==="custom"&&<option value="custom" disabled>Custom file order</option>}</select></label>}
        {!preview&&<label className="compose-size"><Icon name="grid" size={15}/><input aria-label="Gallery thumbnail size" type="range" min="120" max="300" step="10" value={size} onChange={e=>{const value=Number(e.target.value);setSize(value);try{localStorage.setItem("zionpdf:gallery-size",String(value));}catch{/* The gallery still resizes when settings cannot be saved. */}}}/></label>}</div>
      </div>
      <input ref={input} type="file" multiple hidden onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value="";void add(files);}}/>
      {error&&<p role="alert" className="compose-error">{error}</p>}
      {active?<div className={active.kind==="pdf"?"compose-pdf-preview":"compose-expanded-image"} key={active.id}>
        {active.kind==="pdf"&&<nav className="compose-page-index" aria-label="PDF preview pages">{active.pages.map((page,index)=><button key={page} data-page={page} aria-label={`Go to preview page ${index+1}`} aria-current={selected===page?"page":undefined} draggable={!busy} onClick={()=>{setSelected(page);dialog.current?.querySelector<HTMLElement>(`.compose-document-page[data-page="${page}"]`)?.scrollIntoView({block:"start"});}} onDragStart={e=>{drag.current={kind:"page",id:active.id,page};e.dataTransfer.setData("application/x-zion-page",String(page));e.dataTransfer.effectAllowed="move";}} onDragEnd={()=>{drag.current=null;}} onDragOver={e=>{if(drag.current?.kind==="page")stopDrop(e);}} onDrop={e=>{if(drag.current?.kind!=="page"||drag.current.id!==active.id)return;stopDrop(e);movePage(active,drag.current.page!,index);drag.current=null;}}>{active.pdf&&<PageCanvas pdf={active.pdf} page={page} width={120}/>}<span>{index+1}</span></button>)}</nav>}
        <div className="compose-preview-scroll" onScroll={event=>{const view=event.currentTarget;cancelAnimationFrame(scrollFrame.current);scrollFrame.current=requestAnimationFrame(()=>{const bounds=view.getBoundingClientRect();let best=0,page=0;for(const item of view.querySelectorAll<HTMLElement>(".compose-document-page")){const rect=item.getBoundingClientRect(),visible=Math.max(0,Math.min(rect.bottom,bounds.bottom)-Math.max(rect.top,bounds.top+52));if(visible>best){best=visible;page=Number(item.dataset.page);}}if(page&&alive.current)setSelected(page);});}}>
        {active.kind==="image"?<img className="compose-image-preview" src={active.url} alt={active.name}/>:<>
          <div className="compose-page-toolbar"><span>Page {selectedIndex+1} of {active.pages.length}</span><Action label="Move selected page earlier" disabled={busy||selectedIndex<=0} onClick={()=>movePage(active,selected,selectedIndex-1)}><Icon name="chevronUp" size={17}/></Action><Action label="Move selected page later" disabled={busy||selectedIndex<0||selectedIndex===active.pages.length-1} onClick={()=>movePage(active,selected,selectedIndex+1)}><Icon name="chevronDown" size={17}/></Action><Action label="Delete selected page" disabled={busy||active.pages.length<=1||selectedIndex<0} onClick={()=>removePage(active,selected)}><Icon name="trash" size={17}/></Action></div>
          <div className="compose-document-pages">{active.pages.map((page,index)=><article key={page} className={`compose-document-page ${selected===page?"selected":""}`} draggable={!busy} data-page={page} onDragStart={e=>{drag.current={kind:"page",id:active.id,page};e.dataTransfer.setData("application/x-zion-page",String(page));e.dataTransfer.effectAllowed="move";}} onDragEnd={()=>{drag.current=null;}} onDragOver={e=>{if(drag.current?.kind==="page")stopDrop(e);}} onDrop={e=>{if(drag.current?.kind!=="page"||drag.current.id!==active.id)return;stopDrop(e);movePage(active,drag.current.page!,index);drag.current=null;}}>
            <button className="compose-page-select" aria-label={`Select page ${index+1}`} aria-pressed={selected===page} onClick={()=>setSelected(page)}>{active.pdf&&<PageCanvas pdf={active.pdf} page={page} width={760}/>}<span className="compose-page-badge">{index+1}</span></button>
          </article>)}</div>
        </>}
      </div></div>:<div className="compose-gallery-scroll">
        {!items.length?<div className="compose-empty"><Icon name={mode==="images"?"image":"merge"} size={40}/><h3>{mode==="images"?"Turn your images into a PDF":"Bring your documents together"}</h3><p>Drop images or PDFs here, or add files above.</p></div>:<div className="compose-gallery" style={{"--compose-tile":`${size}px`} as CSSProperties}>{items.map((item,index)=><article key={item.id} className={`compose-file ${item.status!=="ready"?"pending":""}`} draggable={!adding&&!busy} data-file-id={item.id} onDragStart={e=>{drag.current={kind:"file",id:item.id};e.dataTransfer.setData("application/x-zion-file",item.id);e.dataTransfer.effectAllowed="move";}} onDragEnd={()=>{drag.current=null;}} onDragOver={e=>{if(drag.current?.kind==="file")stopDrop(e);}} onDrop={e=>{if(drag.current?.kind!=="file")return;stopDrop(e);moveFile(drag.current.id,index);drag.current=null;}}>
          <button className="compose-file-preview" aria-label={`Preview ${item.name}`} disabled={item.status!=="ready"||busy} onClick={()=>{setPreview(item.id);setSelected(item.pages[0]);}}>{item.kind==="image"?<img src={item.url} alt="" loading="lazy" decoding="async" draggable={false} onError={()=>patch(item.id,{status:"error",error:"Couldn't read this image. Remove it and choose another."})}/>:item.pdf?<PageCanvas pdf={item.pdf} page={item.pages[0]} width={300}/>:<Icon name="file" size={32}/>}<span className="compose-file-order">{index+1}</span>{item.current&&<span className="compose-current">Current PDF</span>}</button>
          <div className="compose-file-info"><strong title={item.name}>{item.name}</strong><span>{item.status==="loading"?"Loading…":item.kind==="image"?"Image":`${item.pages.length} pages`}</span></div>
          {item.error&&<p className="compose-file-error">{item.error}</p>}
          {item.status==="locked"&&<form className="compose-unlock" onSubmit={e=>{e.preventDefault();patch(item.id,{status:"loading",error:undefined});addingRef.current=true;setAdding(true);resetHistory();void load(item,passwords[item.id]).finally(()=>{addingRef.current=false;if(alive.current)setAdding(false);});}}><input aria-label={`Password for ${item.name}`} type="password" value={passwords[item.id]||""} onChange={e=>setPasswords(p=>({...p,[item.id]:e.target.value}))}/><button className="btn ghost" disabled={adding||busy}>Unlock</button></form>}
          <div className="compose-file-actions"><Icon name="grip" size={15}/><Action label={`Move ${item.name} earlier`} disabled={adding||busy||index===0} onClick={()=>moveFile(item.id,index-1)}><Icon name="chevronUp" size={15}/></Action><Action label={`Move ${item.name} later`} disabled={adding||busy||index===items.length-1} onClick={()=>moveFile(item.id,index+1)}><Icon name="chevronDown" size={15}/></Action><Action label={`Remove ${item.name}`} disabled={adding||busy||item.current} onClick={()=>commit(entries=>entries.filter(i=>i.id!==item.id))}><Icon name="trash" size={15}/></Action></div>
        </article>)}</div>}
      </div>}
      <footer className="compose-footer"><div className="compose-output"><label>PDF name<input aria-label="Output PDF name" value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label>{items.some(i=>i.kind==="image")&&<label>Image pages<select aria-label="Image page size" value={paper} disabled={busy} onChange={e=>setPaper(e.target.value as ImagePaper)}><option value="a4">A4 · fit image</option><option value="letter">Letter · fit image</option><option value="original">Match image size</option></select></label>}</div><div className="compose-finish">{busy&&<progress aria-label="Creating PDF" max="1" value={progress}/>}<button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!canBuild} onClick={()=>void build()}>{busy?"Creating…":mode==="images"?"Create PDF":"Merge and open"}</button></div></footer>
    </div>
  </div>;
}

