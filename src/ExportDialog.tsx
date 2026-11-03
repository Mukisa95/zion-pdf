import {useEffect,useRef,useState} from "react";
import {Modal} from "./Dialogs";
import {loadPdf} from "./pdf";
import {parseOcrPages} from "./editor/ocrPages";
import type {ExportFormat} from "./exportDocument";
export function ExportDialog({name,password,count,current,prepare,onClose,onSaved}:{name:string;password?:string;count:number;current:number;prepare:()=>Promise<Uint8Array>;onClose:()=>void;onSaved:()=>void}){
  const [format,setFormat]=useState<ExportFormat>("docx"),[scope,setScope]=useState("all"),[ranges,setRanges]=useState(String(current)),[dpi,setDpi]=useState(150),[wordMode,setWordMode]=useState<"layout"|"text"|"appearance">("layout");
  const [running,setRunning]=useState(false),[progress,setProgress]=useState(0),[status,setStatus]=useState(""),[error,setError]=useState("");
  const controller=useRef<AbortController|null>(null),alive=useRef(true);
  useEffect(()=>()=>{alive.current=false;controller.current?.abort();},[]);
  const close=()=>{controller.current?.abort();onClose();};
  const run=async()=>{let pages:number[];try{pages=scope==="all"?Array.from({length:count},(_,i)=>i+1):scope==="current"?[current]:parseOcrPages(ranges,count);}catch(reason){setError((reason as Error).message);return;}
    const abort=new AbortController();controller.current=abort;setRunning(true);setError("");setProgress(0);setStatus("Preparing current edits");let task:ReturnType<typeof loadPdf>|undefined;
    try{const bytes=await prepare();abort.signal.throwIfAborted();task=loadPdf(bytes,password);const pdf=await task.promise;abort.signal.throwIfAborted();const {exportDocument}=await import("./exportDocument");const result=await exportDocument(pdf,name,{format,pages,dpi,wordMode,password},abort.signal,(amount,message)=>{if(alive.current){setProgress(amount);setStatus(message);}});abort.signal.throwIfAborted();
      const filename=`${name.replace(/\.pdf$/i,"")}.${result.extension}`;
      if(window.zionpdfDesktop){const saved=await window.zionpdfDesktop.exportFile(filename,result.extension,result.data);if(!saved.saved){setStatus("Export canceled; your PDF has not changed.");return;}}
      else{const url=URL.createObjectURL(new Blob([result.data as Uint8Array<ArrayBuffer>],{type:result.mime})),link=document.createElement("a");link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
      if(alive.current){onSaved();onClose();}
    }catch(reason){if(alive.current&&!abort.signal.aborted)setError(reason instanceof Error?reason.message:"Couldn't export this PDF.");}
    finally{await task?.destroy().catch(()=>{});if(alive.current)setRunning(false);}
  };
  return <Modal title="Export PDF" onClose={close}><div className="export-options"><p>Export the current document, including unsaved edits. Your PDF stays unchanged.</p>
    <fieldset disabled={running}><label>Format<select aria-label="Export format" value={format} onChange={event=>setFormat(event.target.value as ExportFormat)}><option value="docx">Word document (.docx)</option><option value="png">PNG images</option><option value="jpg">JPEG images</option><option value="txt">Plain text (.txt)</option><option value="html">Webpage (.html)</option></select></label>
    <label>Pages<select aria-label="Export pages" value={scope} onChange={event=>setScope(event.target.value)}><option value="all">Whole document</option><option value="current">Current page</option><option value="range">Specific pages</option></select></label>{scope==="range"&&<label>Page ranges<input aria-label="Export page ranges" value={ranges} placeholder="1, 3-5" onChange={event=>setRanges(event.target.value)}/></label>}
    {format==="docx"&&<label>Word content<select aria-label="Word export mode" value={wordMode} onChange={event=>setWordMode(event.target.value as "layout"|"text"|"appearance")}><option value="layout">Editable paragraphs and tables</option><option value="appearance">Page images (not editable)</option><option value="text">Text only</option></select></label>}
    {(format==="png"||format==="jpg"||format==="docx"&&wordMode!=="text")&&<label>Image resolution<select aria-label="Export image resolution" value={dpi} onChange={event=>setDpi(Number(event.target.value))}><option value={96}>96 dpi - smaller files</option><option value={150}>150 dpi - standard</option><option value={300}>300 dpi - high quality</option></select></label>}</fieldset>
    {format==="docx"&&<p className="search-hint">{wordMode==="text"?"Exports text without pictures, shapes or table layout.":wordMode==="layout"?"Reconstructs flowing paragraphs and Word tables, and keeps pictures and drawings. Text reflows when edited, so pagination may change. Scanned pages need OCR first.":"Keeps every page exactly as an image in Word. Text in this mode is not editable."}</p>}
    {(format==="png"||format==="jpg")&&<p className="search-hint">One page exports as an image. Multiple pages are saved together in a ZIP file. Very large pages are limited to 24 megapixels.</p>}
    {running&&<><progress aria-label="Export progress" max="1" value={progress}/><span role="status">{status}</span></>}{!running&&status&&<p role="status">{status}</p>}{error&&<p role="alert" className="form-error">{error}</p>}
    <div className="form-actions"><button className="btn ghost" onClick={close}>{running?"Cancel export":"Cancel"}</button><button className="btn primary" disabled={running} onClick={()=>void run()}>Export</button></div></div></Modal>;
}
