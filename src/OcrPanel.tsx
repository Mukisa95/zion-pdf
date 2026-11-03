import {useEffect,useId,useRef,useState} from "react";
import type {Worker as OcrWorker} from "tesseract.js";
import {createOcrEngine,recognizeFrame} from "./ocrRecognition";
import {removeRecognizedInk,inkRemovalOverlay} from "./editor/ocrAppearance";
import type {OcrLine,OcrBackground} from "./editor/ocrPdf";
export type OcrRaster={pixels:Uint8ClampedArray;width:number;height:number;nativeText?:{box:[number,number,number,number]}[]};

export function canvasFor(frame:OcrRaster){const canvas=document.createElement("canvas");canvas.width=frame.width;canvas.height=frame.height;canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels),frame.width,frame.height),0,0);return canvas;}
export function cleanOcrBackground(frame:OcrRaster,boxes:[number,number,number,number][]){return canvasFor(removeRecognizedInk(frame,boxes));}

export function OcrPanel({raster,onConvert,onClose}:{raster:()=>Promise<OcrRaster>;onConvert:(lines:OcrLine[],background?:OcrBackground)=>Promise<void>;onClose:()=>void}){
  const radioId=useId();
  const [state,setState]=useState<"ready"|"running"|"review"|"converting">("ready"),[progress,setProgress]=useState(0),[status,setStatus]=useState(""),[error,setError]=useState("");
  const [lines,setLines]=useState<OcrLine[]>([]),[frame,setFrame]=useState<OcrRaster|null>(null),[masks,setMasks]=useState<[number,number,number,number][]>([]),[keep,setKeep]=useState<"everything"|"text">("everything"),[layout,setLayout]=useState("auto");
  const worker=useRef<OcrWorker|null>(null),epoch=useRef(0),preview=useRef<HTMLCanvasElement>(null);
  const cancel=()=>{epoch.current++;void worker.current?.terminate();worker.current=null;setState("ready");setStatus("");};
  useEffect(()=>()=>{epoch.current++;void worker.current?.terminate();},[]);
  useEffect(()=>{if(!frame||!preview.current)return;const canvas=keep==="everything"?cleanOcrBackground(frame,masks):document.createElement("canvas"),target=preview.current;target.width=frame.width;target.height=frame.height;const context=target.getContext("2d")!;context.fillStyle="#fff";context.fillRect(0,0,target.width,target.height);if(keep==="everything")context.drawImage(canvas,0,0);for(const line of lines){context.fillStyle=line.color || "#111";const x=line.box[0]*frame.width,y=line.box[3]*frame.height,size=Math.max(5,(line.box[3]-line.box[1])*frame.height);context.font=`${line.bold?"bold ":""}${size}px Arial`;context.fillText(line.text,x,y,(line.box[2]-line.box[0])*frame.width);}},[frame,lines,masks,keep]);
  const start=async()=>{const token=++epoch.current;setState("running");setError("");setStatus("Preparing image");setProgress(0);let instance:OcrWorker|undefined;
    try{const image=await raster();if(token!==epoch.current)return;setFrame(image);instance=await createOcrEngine((status,progress)=>{if(token===epoch.current){setStatus(status);setProgress(progress);}});if(token!==epoch.current){await instance.terminate();return;}worker.current=instance;
      const {lines:detected,masks:boxes}=await recognizeFrame(instance,image,layout);if(token!==epoch.current)return;
      if(!detected.length)throw new Error("No readable text was found. Try a different layout or rotate the image before detecting text.");if(detected.length>500)throw new Error("Select a smaller image region: this selection contains more than 500 text lines.");setLines(detected);setMasks(boxes);setState("review");
    }catch(reason){if(token===epoch.current){setError(reason instanceof Error?reason.message:"Text detection failed.");setState("ready");}}finally{if(instance)await instance.terminate().catch(()=>{});if(worker.current===instance)worker.current=null;}
  };
  const convert=async()=>{if(!frame)return;setState("converting");setError("");try{await onConvert(lines,keep==="everything"?inkRemovalOverlay(frame,masks):undefined);}catch(reason){setError(reason instanceof Error?reason.message:"Couldn't create editable text.");setState("review");}};
  return <section className="ocr-panel" aria-label="Detect text">
    <h3>Detect text</h3><p className="inline-editor-hint">Offline English recognition. Review detected text before converting it into editable PDF text.</p>
    {(state==="ready"||state==="running")&&<fieldset disabled={state==="running"}><legend>Keep</legend><label><input type="radio" name={`ocr-initial-keep-${radioId}`} checked={keep==="everything"} onChange={()=>setKeep("everything")}/> Text with image</label><label><input type="radio" name={`ocr-initial-keep-${radioId}`} checked={keep==="text"} onChange={()=>setKeep("text")}/> Text only</label></fieldset>}
    {state==="ready"&&<><label>Image layout<select aria-label="OCR image layout" value={layout} onChange={event=>setLayout(event.target.value)}><option value="auto">Automatic</option><option value="block">One text block</option><option value="sparse">Scattered text</option></select></label><button className="btn primary" onClick={()=>void start()}>Start text detection</button></>}
    {state==="running"&&<><span role="status">{status} {Math.round(progress*100)}%</span><progress max="1" value={progress}/><button className="btn ghost" onClick={cancel}>Cancel detection</button></>}
    {(state==="review"||state==="converting")&&<><fieldset disabled={state==="converting"}><legend>Keep from the selected image</legend><label><input type="radio" name={`ocr-keep-${radioId}`} checked={keep==="everything"} onChange={()=>setKeep("everything")}/> Text with image</label><label><input type="radio" name={`ocr-keep-${radioId}`} checked={keep==="text"} onChange={()=>setKeep("text")}/> Text only</label></fieldset><p className="inline-editor-hint">Text colour and size are estimated from the original. Only detected ink is replaced; check decorations and photographs. Low-confidence words remain in the image; Text only includes confident detected words.</p><canvas ref={preview} className="ocr-preview" aria-label="Detected text conversion preview"/><span>{lines.length} text lines detected</span><div className="ocr-results">{lines.map((line,index)=><label key={index}>Line {index+1} · {Math.round(line.confidence)}% confidence<textarea aria-label={`Detected text line ${index+1}`} value={line.text} disabled={state==="converting"} onChange={event=>setLines(previous=>previous.map((item,i)=>i===index?{...item,text:event.target.value.replace(/\r?\n/g," ")}:item))}/></label>)}</div><button className="btn primary" disabled={state==="converting"||!lines.some(line=>line.text.trim())} onClick={()=>void convert()}>{state==="converting"?"Creating editable text…":"Create editable text"}</button><button className="btn ghost" disabled={state==="converting"} onClick={()=>setState("ready")}>Detect again</button></>}
    {error&&<p role="alert" className="inline-editor-error">{error}</p>}
    <button className="btn ghost" disabled={state==="converting"} onClick={()=>{cancel();onClose();}}>Close text detection</button>
  </section>;
}
