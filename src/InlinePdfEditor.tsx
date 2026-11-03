import { useEffect, useRef, useState } from "react";
import type { PageCommand } from "./Sidebar";
import { styleRange, shiftStyles } from "./editor/richText";
import {OcrPanel,canvasFor,type OcrRaster} from "./OcrPanel";
import type {OcrTarget,OcrLine,OcrBackground} from "./editor/ocrPdf";
import {DocumentOcrPanel} from "./DocumentOcrPanel";
import {PixelCanvas,ObjectGhost,LiveText,type ObjectLayers} from "./EditorVisuals";
import { FontSelect } from "./FontSelect";
import {fontStyleOptions,fontTraits} from "./fontOptions";
import { TextCellControls } from "./TextCellControls";
import { textCellBounds } from "./editor/textCells";
import { hasFontCharacters } from "./editor/fonts";
import { Icon,type IconName } from "./icons";
import { createPortal } from "react-dom";
import { loadPdf, type PDFDocumentProxy } from "./pdf";
import type { EventBus, PDFViewer } from "./viewer";
import type { PdfTextObject, PdfImageObject, PdfGraphicObject, TextFormatting, TextStyleRun, ImageTransform } from "./editor/pdfium";
import { listLocalFonts, matchLocalFont, readEditableFont, type LocalFontFace } from "./editor/fonts";

type Box=[number,number,number,number];
function ActionIcon({icon,label,onClick,disabled,pressed}:{icon:IconName;label:string;onClick:()=>void;disabled?:boolean;pressed?:boolean}){return <button type="button" className="btn ghost editor-icon" aria-label={label} title={label} disabled={disabled} aria-pressed={pressed} onMouseDown={event=>event.preventDefault()} onClick={onClick}><Icon name={icon} size={18}/></button>;}
type Preview={pixels:Uint8ClampedArray;foreground?:Uint8ClampedArray;bounds?:Box;width:number;height:number;carets:[number,number,number][]|null;text:string;key?:string};
type Gesture={key:string;kind:"text"|"objects";bounds:Box;destination:Box;fallback:HTMLCanvasElement|null;layers:ObjectLayers|null;awaitVersion?:number};
type WorkerResult = { layers?:Omit<ObjectLayers,"key">;raster?:OcrRaster;cellId?:string; fontBytes?:Uint8Array; preview?:Preview; id: number; objects?: PdfTextObject[]; images?: PdfImageObject[]; graphics?:PdfGraphicObject[]; nested?: { text: number; images: number }; bytes?: Uint8Array; error?: string };

function closestCaret(positions:[number,number,number][], viewport:ReturnType<PDFViewer["getPageView"]>["viewport"], rect:DOMRect, x:number, y:number) {
  let best=0,distance=Infinity;
  positions.forEach((p,i)=>{const a=viewport.convertToViewportPoint(p[0],p[1]),b=viewport.convertToViewportPoint(p[0],p[2]);const vx=b[0]-a[0],vy=b[1]-a[1];const t=Math.max(0,Math.min(1,((x-rect.left-a[0])*vx+(y-rect.top-a[1])*vy)/(vx*vx+vy*vy || 1)));const d=Math.hypot(x-rect.left-a[0]-t*vx,y-rect.top-a[1]-t*vy);if(d<distance){distance=d;best=i;}});
  return best;
}

function TextPreview({frame}:{frame:Preview}) {
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{if(!canvas.current)return;canvas.current.width=frame.width;canvas.current.height=frame.height;canvas.current.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels),frame.width,frame.height),0,0);},[frame]);
  return <canvas ref={canvas} className="inline-text-preview" aria-label="PDF text appearance preview"/>;
}

function EditedPage({ pdf, page, viewport,version,onPaint }: { pdf: PDFDocumentProxy; page: number; viewport: ReturnType<PDFViewer["getPageView"]>["viewport"];version:number;onPaint:(version:number)=>void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const painted=useRef(onPaint);painted.current=onPaint;
  useEffect(() => {
    let cancelled = false;
    let render: { cancel: () => void } | undefined;
    void (async () => {
      const pdfPage = await pdf.getPage(page);
      const target = canvas.current;
      if (!target || cancelled) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const staging = document.createElement("canvas");
      staging.width = Math.ceil(viewport.width * ratio); staging.height = Math.ceil(viewport.height * ratio);
      const task = pdfPage.render({ canvas: staging, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      render = task;
      await task.promise;
      if (cancelled) return;
      target.width = staging.width; target.height = staging.height;
      target.getContext("2d")?.drawImage(staging, 0, 0);
      painted.current(version);
    })().catch(() => {});
    return () => { cancelled = true; render?.cancel(); };
  }, [pdf, page, viewport,version]);
  return <canvas className="inline-pdf-preview" ref={canvas} aria-hidden="true" />;
}

/** Edits operate on a private PDF revision; controls are attached to the existing page views. */
export function InlinePdfEditor({ active = true, pdf, viewer, bus, page, container, overlayRoot, panelRoot, command, ocrCommand=0, prepare, onSave, onExport, snapshotRef, saveRef, isCurrentDocument, navigation, onClose, onDirtyChange, onPreviewPdf }: {
  active?: boolean; pdf: PDFDocumentProxy; viewer: PDFViewer; bus: EventBus; page: number; container: HTMLElement; overlayRoot: HTMLElement; panelRoot: HTMLElement;
  command: PageCommand | null;
  ocrCommand?:number;
  prepare: () => Promise<Uint8Array>; onSave: (bytes: Uint8Array, changedPages: number[], mode:"save"|"copy") => Promise<boolean>;
  onExport:()=>void;snapshotRef:{current:(()=>Promise<Uint8Array>)|null};
  saveRef:{current:((mode:"save"|"copy")=>Promise<void>)|null};
  isCurrentDocument:()=>boolean;
  navigation:{current:{id:number;page:number}};
  onClose: () => void; onDirtyChange: (dirty: boolean) => void;
  onPreviewPdf: (pdf: PDFDocumentProxy | null) => void;
}) {
  const worker = useRef<Worker | null>(null);
  const bytes = useRef<Uint8Array | null>(null), original = useRef<Uint8Array | null>(null);
  const snapshots = useRef<Uint8Array[]>([]), cursor = useRef(0), request = useRef(0);
  const structureSnapshots = useRef<number[]>([0]), nextStructure = useRef(0), currentStructure = useRef(0), displayedStructure = useRef(0), structureChange = useRef(false);
  const structureNavigation=useRef(0);
  const activePage = useRef(page), visiblePage = useRef(page), lastChangedPage = useRef(page);
  const [objects, setObjects] = useState<PdfTextObject[]>([]);
  const [images, setImages] = useState<PdfImageObject[]>([]), [selectedImage, setSelectedImage] = useState<PdfImageObject | null>(null);
  const [graphics,setGraphics]=useState<PdfGraphicObject[]>([]),[selectedGraphics,setSelectedGraphics]=useState<PdfGraphicObject[]>([]);
  const [ocrTarget,setOcrTarget]=useState<OcrTarget|null>(null);
  const [documentOcr,setDocumentOcr]=useState(false),handledOcr=useRef(0),ocrChangedPages=useRef<number[]|null>(null);
  useEffect(()=>{if(ocrTarget?.image && ocrTarget.image.index!==selectedImage?.index || ocrTarget?.graphic && !selectedGraphics.some(item=>item.index===ocrTarget.graphic!.index))setOcrTarget(null);},[selectedImage,selectedGraphics,ocrTarget]);
  const graphicDrag=useRef<{x:number;y:number;graphics:PdfGraphicObject[];images:PdfImageObject[]}|null>(null);
  const [mode, setMode] = useState<"text" | "image">("text");
  const [granularity, setGranularity] = useState<"word" | "line" | "paragraph">("paragraph"), granularityRef = useRef<"word" | "line" | "paragraph">("paragraph");
  const [nested, setNested] = useState({ text: 0, images: 0 });
  const drag = useRef<{ x: number; y: number; image: PdfImageObject; edge?: string; graphics?:PdfGraphicObject[] } | null>(null);
  const [selected, setSelected] = useState<PdfTextObject | null>(null);
  const initialText=useRef("");
  const [fontChanged,setFontChanged]=useState(false);
  const [pendingBounds,setPendingBounds]=useState<{bounds:Box;resize:boolean}|null>(null);
  const [editFontFamily,setEditFontFamily]=useState("");
  const [previewError,setPreviewError]=useState("");
  const [livePreview,setLivePreview]=useState<Preview|null>(null);
  const [objectLayers,setObjectLayers]=useState<ObjectLayers|null>(null),[gesture,setGesture]=useState<Gesture|null>(null),gestureRef=useRef<Gesture|null>(null),gestureFrame=useRef<number|null>(null);
  const previewFlight=useRef<number|null>(null),pendingPreview=useRef<Record<string,unknown>|null>(null),previewVersion=useRef("");
  const sendPreview=()=>{if(previewFlight.current!==null||!pendingPreview.current||!worker.current)return;const data=pendingPreview.current;pendingPreview.current=null;previewFlight.current=data.id as number;const version=data.previewRevision as string;if(previewVersion.current===version)delete data.bytes;else previewVersion.current=version;worker.current.postMessage(data);};
  const auxId=useRef(0),previewId=useRef(0);
  const aux=useRef(new Map<number,(result:WorkerResult)=>void>());
  const selectionPending=useRef<{cellId?:string;text?:string;bounds:Box;image?:boolean}|null>(null);
  const selectCurrent=useRef<(object:PdfTextObject)=>void>(()=>{});
  const lastCellId=useRef<string|undefined>(undefined);
  const importedFaces=useRef<FontFace[]>([]);
  const fontCache=useRef(new WeakMap<LocalFontFace,Promise<Uint8Array>>());
  const [text, setText] = useState("");
  const [styleRuns,setStyleRuns]=useState<TextStyleRun[]>([]);
  const [caret,setCaret]=useState(0);
  const [inputFocused,setInputFocused]=useState(false);
  const [cellFrame,setCellFrame]=useState(false);
  const [typingRedo,setTypingRedo]=useState(false);
  const [selection,setSelection]=useState<[number,number]>([0,0]);
  const selectionDrag=useRef<number|null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [revision, setRevision] = useState(0), [layout, setLayout] = useState(0);
  const [history, setHistory] = useState({ index: 0, length: 1 });
  const [changedPages, setChangedPages] = useState<number[]>([]);
  const [workingPdf, setWorkingPdf] = useState<PDFDocumentProxy | null>(null);
  const [workingVersion,setWorkingVersion]=useState(0);
  const [fonts, setFonts] = useState<LocalFontFace[]>([]), [fontName, setFontName] = useState("");
  const [fontSize, setFontSize] = useState(""), [color, setColor] = useState("#000000"), [changeColor, setChangeColor] = useState(false);
  const [fontSizeDraft,setFontSizeDraft]=useState<string|null>(null);
  const [adding,setAdding] = useState<"text" | File | null>(null);
  const [formatChanged, setFormatChanged] = useState(false);
  const [alignment,setAlignment] = useState<TextFormatting["alignment"]>("left"), [lineHeight,setLineHeight] = useState("1.2"), [paragraphSpacing,setParagraphSpacing] = useState("0");
  const [horizontalScale,setHorizontalScale] = useState("100"), [tracking,setTracking] = useState("0"), [underline,setUnderline] = useState(false);
  const [spacingChanged,setSpacingChanged] = useState(false), [underlineChanged,setUnderlineChanged] = useState(false), [link,setLink] = useState<string | null>(null);
  const structuralUpdating = useRef(false);
  const structural = useRef(false), handledCommand = useRef(0);
  const previewTasks = useRef<ReturnType<typeof loadPdf>[]>([]);
  const completion = useRef<((ok: boolean) => void) | null>(null);
  const latestObjects = useRef<PdfTextObject[]>([]), latestImages = useRef<PdfImageObject[]>([]);
  const input = useRef<HTMLTextAreaElement>(null);
  const previewFont = fonts.find(face => face.postscriptName === fontName);
  const unapplied = !!selected && (text !== initialText.current || formatChanged);
  const previewKey=JSON.stringify([selected?.index,text,fontName,fontChanged,fontSize,color,changeColor,alignment,lineHeight,paragraphSpacing,horizontalScale,tracking,underline,link,styleRuns,pendingBounds?.bounds,pendingBounds?.resize,revision]);
  const exactPreview=livePreview?.key===previewKey;
  const selectionIndices=selected?(selected.members || [selected]).map(item=>item.index):[...selectedGraphics.map(item=>item.index),...(selectedImage?[selectedImage.index]:[])];
  const layerKey=`${activePage.current}:${revision}:${[...selectionIndices].sort((a,b)=>a-b).join(",")}`;
  const dirty = bytes.current !== original.current || unapplied;
  const dirtyRef = useRef(dirty), pendingRef = useRef(unapplied);
  dirtyRef.current = dirty; pendingRef.current = unapplied;
  if (!structuralUpdating.current) visiblePage.current = page;
  const clearGesture=()=>{gestureRef.current=null;if(gestureFrame.current!==null)cancelAnimationFrame(gestureFrame.current);gestureFrame.current=null;setGesture(null);};
  const showGesture=(next:Gesture)=>{gestureRef.current=next;if(gestureFrame.current===null)gestureFrame.current=requestAnimationFrame(()=>{gestureFrame.current=null;setGesture(gestureRef.current);});};
  const beginGesture=(bounds:Box,indices:number[],kind:"text"|"objects",layer:HTMLElement)=>{const key=`${activePage.current}:${revision}:${[...indices].sort((a,b)=>a-b).join(",")}`,view=viewer.getPageView(activePage.current-1);let layers=objectLayers?.key===key?objectLayers:null;if(kind==="text"&&layers&&livePreview?.foreground&&livePreview.text===text){layers={...layers,foreground:livePreview.foreground,width:livePreview.width,height:livePreview.height};bounds=livePreview.bounds || bounds;}gestureRef.current={key,kind,bounds:[...bounds],destination:[...bounds],layers,fallback:layer.querySelector<HTMLCanvasElement>(".inline-text-preview") || layer.querySelector<HTMLCanvasElement>(".inline-pdf-preview") || (view.div.querySelector(".canvasWrapper canvas") as HTMLCanvasElement|null)};};
  const moveGesture=(destination:Box)=>{if(gestureRef.current)showGesture({...gestureRef.current,destination});};
  const dragGesture=(dx:number,dy:number)=>{const view=viewer.getPageView(activePage.current-1),vp=view.viewport,rect=view.div.getBoundingClientRect(),a=vp.convertToPdfPoint(0,0),b=vp.convertToPdfPoint(dx*vp.width/rect.width,dy*vp.height/rect.height),box=gestureRef.current?.bounds;if(box)moveGesture([box[0]+b[0]-a[0],box[1]+b[1]-a[1],box[2]+b[0]-a[0],box[3]+b[1]-a[1]]);};
  const settleGesture=()=>{if(gestureRef.current){const next={...gestureRef.current,awaitVersion:revision+1};gestureRef.current=next;setGesture(next);}};

  const inspect = (target: number, data: Uint8Array) => {
    if (!worker.current) return;
    activePage.current = target;
    setBusy(true); setError(""); setObjects([]); setImages([]); setGraphics([]);setSelectedGraphics([]);setOcrTarget(null);setNested({ text: 0, images: 0 });
    worker.current.postMessage({ id: ++request.current, kind: "inspect", bytes: data, page: target - 1, granularity: granularityRef.current });
  };
  useEffect(() => {
    onDirtyChange(dirty);
    const before = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", before);
    return () => { window.removeEventListener("beforeunload", before); onDirtyChange(false); };
  }, [dirty]);
  useEffect(() => {
    let cancelled = false;
    const instance = new Worker(new URL("./editor/worker.ts", import.meta.url), { type: "module" });
    worker.current = instance;
    instance.onerror = () => { if (!cancelled) { setError("Couldn't start the PDF editor."); setBusy(false); } };
    instance.onmessage = (event: MessageEvent<WorkerResult>) => {
      if(cancelled)return;
      const result=event.data;
      const callback=aux.current.get(result.id);if(callback){aux.current.delete(result.id);callback(result);return;}
      if(result.id===previewFlight.current){previewFlight.current=null;if(result.id===previewId.current){if(result.preview){setLivePreview(result.preview);setPreviewError("");}else if(result.error)setPreviewError(result.error);}sendPreview();return;}
      if(result.id!==request.current)return;
      if (result.error) {clearGesture();ocrChangedPages.current=null;structureChange.current=false;selectionPending.current=null;setPendingBounds(null);setError(result.error); setBusy(false); structuralUpdating.current = false; completion.current?.(false); completion.current = null; return; }
      if (result.nested) setNested(result.nested);
      if (result.objects) {
        latestObjects.current=result.objects;setObjects(result.objects);latestImages.current=result.images || [];setImages(latestImages.current);setGraphics(result.graphics || []);setBusy(false);
        const anchor=selectionPending.current;selectionPending.current=null;
        if(anchor?.image){const image=latestImages.current.find(item=>item.bounds.every((v,i)=>Math.abs(v-anchor.bounds[i])<.2));if(image){setSelectedImage(image);setMode("image");}}
        else if(anchor){const object=result.objects.find(item=>anchor.cellId&&item.cell?.id===anchor.cellId)||result.objects.find(item=>item.text===anchor.text&&item.bounds.every((v,i)=>Math.abs(v-anchor.bounds[i])<.2));if(object)selectCurrent.current(object);}
        completion.current?.(true);completion.current=null;return;
      }
      if (result.images) { setImages(result.images); setBusy(false); return; }
      if (result.bytes) {
        lastCellId.current=result.cellId;if(result.cellId&&selectionPending.current)selectionPending.current.cellId=result.cellId;
        previewId.current=--auxId.current;setLivePreview(null);setPendingBounds(null);
        const next = snapshots.current.slice(0, cursor.current + 1);
        next.push(result.bytes);
        const structures=structureSnapshots.current.slice(0,cursor.current+1);
        if(structureChange.current)currentStructure.current=++nextStructure.current;
        structureChange.current=false;structures.push(currentStructure.current);
        while (next.length > 6 || (next.length > 2 && next.reduce((sum, value) => sum + value.byteLength, 0) > 128 * 1024 * 1024)) {next.shift();structures.shift();}
        structureSnapshots.current=structures;
        snapshots.current = next; cursor.current = next.length - 1;
        setHistory({ index: cursor.current, length: next.length });
        bytes.current = result.bytes;
        const convertedPages=ocrChangedPages.current;ocrChangedPages.current=null;
        setChangedPages(pages => convertedPages?[...new Set([...pages,...convertedPages])]:structural.current ? Array.from({length: pdf.numPages}, (_,i) => i+1) : pages.includes(lastChangedPage.current) ? pages : [...pages, lastChangedPage.current]);
        setFormatChanged(false); setSelected(null); setSelectedImage(null); setText(""); setFontName(""); setFontSize(""); setChangeColor(false);
        setRevision(value => value + 1);
        inspect(Math.max(1,visiblePage.current), result.bytes);
      }
    };
    void prepare().then(data => {
      if (cancelled) return;
      bytes.current = data; original.current = data; snapshots.current = [data];
      inspect(visiblePage.current, data);
    }).catch(reason => { if (!cancelled) { setError(reason instanceof Error ? reason.message : "Couldn't prepare this document."); setBusy(false); } });
    return () => { cancelled = true; instance.terminate(); worker.current = null;if(gestureFrame.current!==null)cancelAnimationFrame(gestureFrame.current); for(const face of importedFaces.current)document.fonts.delete(face); for(const [id,resolve] of aux.current)resolve({id});aux.current.clear(); };
  }, []);
  useEffect(() => {
    if (!bytes.current || pendingRef.current || busy || structuralUpdating.current || page === activePage.current) return;
    setFormatChanged(false); setSelected(null); setSelectedImage(null); setText(""); setFontName(""); setFontSize(""); setChangeColor(false);
    inspect(page, bytes.current);
  }, [page, busy, selected, text, fontName, fontSize, changeColor]);
  useEffect(() => {
    if (!revision || !bytes.current) return;
    let cancelled = false;
    const previewRequest=request.current;
    const task = loadPdf(bytes.current); previewTasks.current.push(task);
    void task.promise.then(document => { if (cancelled) {previewTasks.current=previewTasks.current.filter(item=>item!==task);void task.destroy();return;} { setWorkingPdf(document);setWorkingVersion(revision); onPreviewPdf(document);
      if (currentStructure.current !== displayedStructure.current) {
        displayedStructure.current=currentStructure.current;
        structuralUpdating.current=true;
        const inspected=activePage.current;
        const desired=()=>Math.max(1,Math.min(navigation.current.id!==structureNavigation.current?navigation.current.page:visiblePage.current,document.numPages));
        const target = desired();
        visiblePage.current = target; activePage.current = target;
        const scale = viewer.currentScaleValue;
        viewer.setDocument(document); void viewer.firstPagePromise.then(() => { if (cancelled) return;const latest=desired();viewer.currentScaleValue = scale; viewer.currentPageNumber = latest;visiblePage.current=latest; structuralUpdating.current = false;if(latest!==inspected&&bytes.current&&request.current===previewRequest)inspect(latest,bytes.current);setLayout(value => value+1); }).catch(() => {});
      } } }).catch(() => { if (!cancelled) setError("Couldn't preview the edited PDF."); });
    return () => { cancelled = true; };
  }, [revision]);
  useEffect(() => () => {
    if (structural.current&&isCurrentDocument()) {
      const top=container.scrollTop,left=container.scrollLeft,scale=viewer.currentScaleValue;
      viewer.setDocument(pdf);
      void viewer.firstPagePromise.then(()=>{if(viewer.pdfDocument!==pdf)return;viewer.currentScaleValue=scale;container.scrollTop=top;container.scrollLeft=left;}).catch(()=>{});
    }
    onPreviewPdf(null);
    for (const task of previewTasks.current) void task.destroy();
  }, []);
  useEffect(() => {
    if (!command || handledCommand.current === command.id || busy || !bytes.current || !worker.current) return;
    handledCommand.current = command.id;
    void (async () => {
      if (unapplied && !await apply()) return;
      structural.current = true; structureChange.current = true;structureNavigation.current=navigation.current.id; structuralUpdating.current = true; clearSelection(); setBusy(true); lastChangedPage.current = command.page;
      const target = command.action === "delete" ? Math.min(command.page, (workingPdf ?? pdf).numPages-1) : command.action === "reorder" ? command.target! : command.page;
      visiblePage.current = Math.max(1,target);
      worker.current?.postMessage({ id: ++request.current, kind: "page", bytes: bytes.current, page: command.page-1, action: command.action, target: command.target === undefined ? undefined : command.target-1 });
    })();
  }, [command, busy]);
  useEffect(() => {
    const update = () => setLayout(value => value + 1);
    for (const name of ["pagerendered", "scalechanging", "rotationchanging"]) bus.on(name, update);
    const observer = new ResizeObserver(update); observer.observe(container);
    return () => { observer.disconnect(); for (const name of ["pagerendered", "scalechanging", "rotationchanging"]) bus.off(name, update); };
  }, [bus, container]);
  useEffect(() => { if (selected) input.current?.focus({preventScroll:true}); }, [selected]);

  const clearSelection = () => {setOcrTarget(null);setFormatChanged(false); setSelected(null); setSelectedImage(null);setSelectedGraphics([]); setText(""); setFontName(""); setFontSize(""); setChangeColor(false); setError(""); };
  const editImage = (image: PdfImageObject, action: "move-image" | "delete-image" | "transform-image" | "duplicate-image", dx = 0, dy = 0, operation?: ImageTransform) => {
    if (!bytes.current || !worker.current || busy) return;
    if (image.unsupported && action!=="delete-image") { setError(image.unsupported); return; }
    setBusy(true); setError(""); lastChangedPage.current = activePage.current;
    worker.current.postMessage({ id: ++request.current, kind: action, bytes: bytes.current, page: activePage.current - 1, image, dx, dy, operation });
  };
  const replaceImage = async (image: PdfImageObject, file: File) => {
    if (!bytes.current || !worker.current || busy) return;
    if (image.unsupported) { setError(image.unsupported); return; }
    if (file.size > 25 * 1024 * 1024) { setError("Choose a PNG or JPEG image smaller than 25 MB."); return; }
    setBusy(true); setError(""); lastChangedPage.current = activePage.current;
    try {
      const imageBytes = new Uint8Array(await file.arrayBuffer());
      worker.current?.postMessage({ id: ++request.current, kind: "replace-image", bytes: bytes.current, page: activePage.current - 1, image, imageBytes });
    } catch { setError("Couldn't read the replacement image."); setBusy(false); }
  };
  const copyImage = async (image: PdfImageObject) => {
    try {
      const document = workingPdf ?? pdf, page = await document.getPage(activePage.current);
      const viewport = page.getViewport({ scale: 2 });
      const a = viewport.convertToViewportPoint(image.bounds[0], image.bounds[1]), b = viewport.convertToViewportPoint(image.bounds[2], image.bounds[3]);
      const canvas = window.document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const crop = window.document.createElement("canvas"); crop.width = Math.ceil(Math.abs(b[0]-a[0])); crop.height = Math.ceil(Math.abs(b[1]-a[1]));
      crop.getContext("2d")!.drawImage(canvas, Math.min(a[0],b[0]),Math.min(a[1],b[1]),crop.width,crop.height,0,0,crop.width,crop.height);
      const blob = await new Promise<Blob>((resolve,reject) => crop.toBlob(blob => blob ? resolve(blob) : reject(new Error("Couldn't copy this image.")),"image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't copy this image."); }
  };
  const ocrRaster=async(target=ocrTarget)=>{if(!target||!worker.current||!bytes.current)throw new Error("Select the image again.");const id=--auxId.current;return new Promise<OcrRaster>((resolve,reject)=>{aux.current.set(id,result=>result.raster?resolve(result.raster):reject(new Error(result.error || "Couldn't prepare this image.")));worker.current!.postMessage({id,kind:"ocr-render",bytes:bytes.current,page:activePage.current-1,ocrTarget:target});});};
  const convertOcr=async(ocrLines:OcrLine[],background?:OcrBackground,target=ocrTarget)=>{if(!target||!worker.current||!bytes.current||busy)throw new Error("Select the image again.");const face=matchLocalFont(fonts,"ArialMT");const fontBytes=face?(await readEditableFont(face)).bytes:undefined;setBusy(true);setError("");lastChangedPage.current=activePage.current;const finished=new Promise<boolean>(resolve=>{completion.current=resolve;});worker.current.postMessage({id:++request.current,kind:"ocr-convert",bytes:bytes.current,page:activePage.current-1,ocrTarget:target,ocrLines,background,fontBytes});if(!await finished)throw new Error("Couldn't convert this selection. See the editor message.");};
  const renderOcrPage=async(page:number,backgroundOnly=false)=>{if(!worker.current||!bytes.current)throw new Error("The document is unavailable.");const id=--auxId.current;return new Promise<OcrRaster>((resolve,reject)=>{aux.current.set(id,result=>result.raster?resolve(result.raster):reject(new Error(result.error||"Couldn't render this page.")));worker.current!.postMessage({id,kind:"ocr-render",bytes:bytes.current,page:page-1,ocrTarget:{page:true,backgroundOnly}});});};
  const convertOcrDraft=async(data:Uint8Array|undefined,page:number,ocrLines:OcrLine[],background?:OcrBackground)=>{if(!worker.current||!bytes.current)throw new Error("The document is unavailable.");const face=matchLocalFont(fonts,"ArialMT");let fontBytes:Uint8Array|undefined;if(face){let cached=fontCache.current.get(face);if(!cached){cached=readEditableFont(face).then(result=>result.bytes);fontCache.current.set(face,cached);}fontBytes=await cached;}const id=--auxId.current;return new Promise<Uint8Array>((resolve,reject)=>{aux.current.set(id,result=>result.bytes?resolve(result.bytes):reject(new Error(result.error||"Couldn't convert this page.")));worker.current!.postMessage({id,kind:"ocr-convert",bytes:data||bytes.current,page:page-1,ocrTarget:{page:true,keepImage:!!background},ocrLines,background,fontBytes});});};
  const applyOcrDraft=async(data:Uint8Array,pages:number[])=>{if(!worker.current||busy)throw new Error("Wait for the current operation.");ocrChangedPages.current=pages;setBusy(true);const done=new Promise<boolean>(resolve=>{completion.current=resolve;});worker.current.postMessage({id:++request.current,kind:"ocr-adopt",bytes:data,page:activePage.current-1});if(!await done)throw new Error("Couldn't apply the OCR document.");};
  useEffect(()=>{if(!ocrCommand||handledOcr.current===ocrCommand||busy||!bytes.current)return;handledOcr.current=ocrCommand;void(async()=>{if(unapplied&&!await apply())return;clearSelection();setDocumentOcr(true);})();},[ocrCommand,busy]);
  const pick = async (object: PdfTextObject) => {
    if (busy) return;
    if (unapplied && !await apply()) return;
    const next = latestObjects.current.find(item => item.text === object.text && Math.abs(item.bounds[0]-object.bounds[0]) < .1 && Math.abs(item.bounds[1]-object.bounds[1]) < .1);
    if (!next) return;
    selectCurrent.current(next);
  };
  selectCurrent.current=(object:PdfTextObject)=>{
    const logical=object.cell?object.text:object.granularity==="paragraph"?object.text.replace(/\n/g," "):object.text;
    initialText.current=logical;setStyleRuns(object.cell?.format?.runs || []);setCellFrame(false);setTypingRedo(false);setPreviewError("");setMode("text");setSelectedImage(null);setSelectedGraphics([]);setSelected(object);setText(logical);setPendingBounds(null);setLivePreview(null);setFontChanged(false);setFontSizeDraft(null);
    setFontName(matchLocalFont(fonts,object.fontName)?.postscriptName || "");
    const size=(object.fontSize || 12)*(object.fontScale || 1);
    setFontSize(String(Math.abs(size-Math.round(size*2)/2)<.025?Math.round(size*2)/2:Math.round(size*100)/100));setColor(object.color || "#000000");setChangeColor(false);setFormatChanged(false);
    setAlignment(object.cell?.format?.alignment || "left");setHorizontalScale(String(Math.round((object.fontScaleX || object.fontScale || 1)/(object.fontScale || 1)*10000)/100));
    setTracking(String(object.cell?.format?.tracking || 0));setUnderline(!!object.underline);setUnderlineChanged(false);setSpacingChanged(false);setLink(object.cell?.format?.link || null);setParagraphSpacing(String(object.cell?.format?.paragraphSpacing || 0));
    setLineHeight(String(object.cell?.format?.lineHeight || (object.lines&&object.lines.length>1?Math.round(Math.abs(object.lines[0].bounds[3]-object.lines[1].bounds[3])/size*100)/100:1.2)));setError("");
    const panel=panelRoot.querySelector(".inline-editor-content");if(panel)panel.scrollTop=0;
  };
  const editData=async()=>{
    if(!selected)throw new Error("Select text to edit.");
    const face=fonts.find(item=>item.postscriptName===fontName)||matchLocalFont(fonts,selected.fontName);
    const read=(face:LocalFontFace)=>{let cached=fontCache.current.get(face);if(!cached){cached=readEditableFont(face).then(result=>result.bytes);fontCache.current.set(face,cached);}return cached;};
    let fontBytes:Uint8Array|undefined,fallbackFont:Uint8Array|undefined;
    if(fontChanged){if(!face)throw new Error("Choose the font again.");fontBytes=await read(face);}
    else if(face){try{fallbackFont=await read(face);}catch{}}
    const originalScale=(selected.fontScaleX || selected.fontScale || 1)/(selected.fontScale || 1)*100;
    const formatting:TextFormatting={
      ...selected.cell?.format,
      runs:await Promise.all(styleRuns.map(async run=>{const face=fonts.find(face=>face.postscriptName===run.fontName);return {...run,...(face?{fontBytes:await read(face)}:{})};})),
      fontSize:fontSize&&Math.abs(Number(fontSize)-(selected.fontSize || 12)*(selected.fontScale || 1))>.01?Number(fontSize)/(selected.fontScale || 1):undefined,
      color:changeColor?color:undefined,alignment,
      lineHeight:spacingChanged?Number(lineHeight):selected.cell?.format?.lineHeight,
      paragraphSpacing:spacingChanged?Number(paragraphSpacing):selected.cell?.format?.paragraphSpacing,
      horizontalScale:Math.abs(Number(horizontalScale)-originalScale)>.01?Number(horizontalScale)/originalScale*100:undefined,
      tracking:Number(tracking)||undefined,underline:underlineChanged?underline:selected.cell?.format?.underline,link:link||undefined
    };
    return {fontBytes,fallbackFont,formatting};
  };
  const apply = async () => {
    if (!selected || !bytes.current || !worker.current || busy) return false;
    setBusy(true); setError("");
    try {
      const {fontBytes,fallbackFont,formatting}=await editData();
      lastChangedPage.current = activePage.current;
      const finished = new Promise<boolean>(resolve => { completion.current = resolve; });
      worker.current?.postMessage({ id: ++request.current, kind: "replace-cell", bytes: bytes.current, page: activePage.current - 1, expected: selected, replacement: text, fontBytes, fallbackFont, formatting });
      return await finished;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't load this font."); setBusy(false); return false; }
  };
  useEffect(() => {
    let cancelled=false;
    const refresh=()=>{void listLocalFonts().then(found=>{if(cancelled)return;setFonts(previous=>{const next=[...found,...previous.filter(face=>face.postscriptName.startsWith("file:"))];return next.length===previous.length&&next.every((face,i)=>face.postscriptName===previous[i].postscriptName)?previous:next;});}).catch(()=>{});};
    refresh();window.addEventListener("focus",refresh);return()=>{cancelled=true;window.removeEventListener("focus",refresh);};
  }, []);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!active) return;
      const target = event.target as HTMLElement;
      if (target.closest(".inline-text-cell, .inline-pdf-input, .inline-pdf-target, .inline-image-target, .inline-image-controls, .inline-graphic-target, .inline-add-target, .inline-editor-panel")) return;
      if (unapplied && !busy) void apply();
      else if (!busy) clearSelection();
    };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  });
  useEffect(()=>{
    if(!selected||!worker.current||!bytes.current)return;
    let cancelled=false,face:FontFace|undefined;
    const load=async()=>{
      const installed=fonts.find(item=>item.postscriptName===fontName)||matchLocalFont(fonts,selected.fontName);
      let data:Uint8Array|undefined;
      if(!fontChanged){const id=--auxId.current;data=await new Promise<Uint8Array|undefined>(resolve=>{aux.current.set(id,result=>resolve(result.fontBytes));worker.current?.postMessage({id,kind:"font",bytes:bytes.current,page:activePage.current-1,expected:selected});});}
      if(!data||!hasFontCharacters(data,text.replace(/\s/g,"")))data=installed?new Uint8Array(await (await installed.blob()).arrayBuffer()):undefined;
      if(!data||cancelled)return;
      const name=`ZionPdfText_${crypto.randomUUID().replaceAll("-","")}`;
      face=await new FontFace(name,data.slice().buffer).load();if(cancelled)return;
      document.fonts.add(face);setEditFontFamily(name);
    };
    setEditFontFamily("");void load().catch(()=>{});
    return()=>{cancelled=true;if(face)document.fonts.delete(face);};
  },[selected,fontName,fontChanged,fonts]);
  useEffect(()=>{
    if(!selectionIndices.length||!active){setObjectLayers(null);return;}
    if(busy||!bytes.current||!worker.current)return;
    let canceled=false;const key=layerKey,view=viewer.getPageView(activePage.current-1),vp=view?.viewport;if(!vp)return;
    const ratio=Math.min(window.devicePixelRatio || 1,1.5,Math.sqrt(2200000/(vp.width*vp.height))),id=--auxId.current;
    aux.current.set(id,result=>{if((canceled&&gestureRef.current?.key!==key)||!result.layers)return;const layers={...result.layers,key};setObjectLayers(layers);if(gestureRef.current?.key===key){const next={...gestureRef.current,layers};gestureRef.current=next;setGesture(current=>current?next:current);}});
    worker.current.postMessage({id,kind:"object-layers",bytes:bytes.current,page:activePage.current-1,indices:selectionIndices,width:Math.max(1,Math.floor(vp.width*ratio)),height:Math.max(1,Math.floor(vp.height*ratio)),rotation:vp.rotation});
    return()=>{canceled=true;};
  },[layerKey,active,layout,busy]);
  useEffect(()=>{
    if(!selected||busy||!active||!bytes.current||!worker.current){previewId.current=--auxId.current;pendingPreview.current=null;if(!selected)setLivePreview(null);return;}
    if(pendingBounds&&!pendingBounds.resize)return;
    let cancelled=false;const id=--auxId.current;previewId.current=id;
    const frame=requestAnimationFrame(()=>{void(async()=>{
      const view=viewer.getPageView(activePage.current-1),vp=view?.viewport;if(!vp||cancelled)return;
      const ratio=Math.min(window.devicePixelRatio || 1,1.5,Math.sqrt(2200000/(vp.width*vp.height)));
      const data=unapplied||pendingBounds?.resize?await editData():{};if(cancelled)return;
      pendingPreview.current={id,kind:"preview-cell",key:previewKey,previewRevision:`${revision}:${activePage.current}`,logicalText:text,bytes:bytes.current,page:activePage.current-1,expected:selected,replacement:unapplied?text:undefined,bounds:pendingBounds?.bounds,resize:pendingBounds?.resize,...data,width:Math.max(1,Math.floor(vp.width*ratio)),height:Math.max(1,Math.floor(vp.height*ratio)),rotation:vp.rotation};sendPreview();
    })().catch(reason=>{if(!cancelled)setPreviewError(reason instanceof Error?reason.message:"Couldn't render this text.");});});
    return()=>{cancelled=true;cancelAnimationFrame(frame);if(pendingPreview.current?.id===id)pendingPreview.current=null;};
  },[previewKey,busy,active,layout]);
  const transformText=async(bounds:Box,resize:boolean)=>{
    if(!selected||busy||!bytes.current||!worker.current)return;
    moveGesture(bounds);settleGesture();
    setBusy(true);setError("");lastChangedPage.current=activePage.current;
    try{
      const data=unapplied||resize?await editData():{};
      selectionPending.current={cellId:selected.cell?.id,text:selected.text,bounds:selected.bounds};
      worker.current.postMessage({id:++request.current,kind:"transform-text",bytes:bytes.current,page:activePage.current-1,expected:selected,bounds,resize,replacement:unapplied?text:undefined,...data});
    }catch(reason){setError(reason instanceof Error?reason.message:"Couldn't move this text cell.");setBusy(false);setPendingBounds(null);}
  };
  const move = (offset: number) => {
    if(selected && ((offset<0 && text!==initialText.current) || (offset>0 && typingRedo))){
      input.current?.focus({preventScroll:true});
      if(document.execCommand(offset<0?"undo":"redo")){setTypingRedo(offset<0);return;}
    }
    const next = cursor.current + offset;
    if (busy || next < 0 || next >= snapshots.current.length) return;
    if (unapplied && !confirm("Discard the un-applied text change?")) return;
    cursor.current = next; currentStructure.current=structureSnapshots.current[next]; setHistory({ index: next, length: snapshots.current.length });
    structureNavigation.current=navigation.current.id;if(currentStructure.current!==displayedStructure.current)structuralUpdating.current=true;
    bytes.current = snapshots.current[next]; clearSelection(); setRevision(value => value + 1);
    inspect(visiblePage.current, bytes.current);
  };
  const close = () => { if (dirtyRef.current && !confirm("Discard the edits in this session?")) return; onClose(); };
  const snapshotState=useRef({busy,pending:unapplied,apply});snapshotState.current={busy,pending:unapplied,apply};
  const snapshot=async()=>{
    const deadline=Date.now()+60000;
    const ready=async()=>{while(snapshotState.current.busy){if(!worker.current||Date.now()>deadline)throw new Error("Wait for the current edit to finish, then export again.");await new Promise(resolve=>setTimeout(resolve,25));}};
    await ready();if(!bytes.current)throw new Error("The document is unavailable.");
    if(snapshotState.current.pending&&!await snapshotState.current.apply())throw new Error("The current text edit could not be applied.");
    await ready();return bytes.current!.slice();
  };
  useEffect(()=>{snapshotRef.current=snapshot;return()=>{snapshotRef.current=null;};});
  const save = async (mode:"save"|"copy"="save") => {
    if (!bytes.current || busy) return;
    if (unapplied && !await apply()) return;
    if (bytes.current === original.current) return;
    setBusy(true); setError("");
    try { if (await onSave(bytes.current, changedPages,mode)) { original.current = bytes.current; onClose(); } else setBusy(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't save the edited copy."); setBusy(false); }
  };
  useEffect(()=>{saveRef.current=save;return()=>{saveRef.current=null;};});
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!active || container.closest(".app")?.querySelector(".modal-backdrop")) return;
      if (event.key === "Escape" && (event.target as HTMLElement | null)?.closest(".font-picker-menu")) return;
      const mod = event.ctrlKey || event.metaKey;
      const typing = (event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable=true]");
      if (event.key === "Escape" && (selected || selectedImage)) { event.preventDefault(); event.stopPropagation(); if (!unapplied || confirm("Discard the un-applied text change?")) clearSelection(); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      else if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && selected && unapplied) { event.preventDefault(); void apply(); }
      else if (mod && event.key.toLowerCase() === "s") { event.preventDefault();event.stopImmediatePropagation();void save(event.shiftKey?"copy":"save"); }
      else if (mod && !typing && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
        event.preventDefault(); move(event.shiftKey || event.key.toLowerCase() === "y" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });

  const addAt = async (point: [number,number]) => {
    if (!adding || !worker.current || !bytes.current || busy) return;
    const content=adding; setAdding(null);
    if (unapplied && !await apply()) return;
    setBusy(true); lastChangedPage.current=activePage.current;
    try {
      const face=matchLocalFont(fonts,"ArialMT") || fonts.find(face=>/regular/i.test(face.style));
      let fontBytes: Uint8Array | undefined;
      if (content === "text" && face) { try {fontBytes=(await readEditableFont(face)).bytes;} catch {} }
      const imageBytes=content instanceof File ? new Uint8Array(await content.arrayBuffer()) : undefined;
      worker.current?.postMessage({id:++request.current,kind:"insert",bytes:bytes.current,page:activePage.current-1,point,imageBytes,fontBytes});
    } catch {setError("Couldn't add this content.");setBusy(false);}
  };
  const currentRun=styleRuns.find(run=>selection[0]>=run.start && selection[0]<run.end);
  const selectedFace = fonts.find(face=>face.postscriptName===currentRun?.fontName) || previewFont || matchLocalFont(fonts,selected?.fontName);
  const styles = selectedFace?fontStyleOptions(fonts,selectedFace.family,selectedFace):[];
  const traits=selectedFace?fontTraits(selectedFace):{bold:/bold|heavy|black|semibold/i.test(selected?.fontName || ""),italic:/italic|oblique/i.test(selected?.fontName || "")};
  const canBold=styles.some(face=>fontTraits(face).bold!==traits.bold&&fontTraits(face).italic===traits.italic);
  const canItalic=styles.some(face=>fontTraits(face).bold===traits.bold&&fontTraits(face).italic!==traits.italic);
  const rangeFormat=(patch:Partial<TextStyleRun>)=>{if(selection[0]===selection[1]){setStyleRuns([]);return false;}setStyleRuns(runs=>styleRange(runs,selection[0],selection[1],patch));setFormatChanged(true);setError("");return true;};
  const chooseStyle = (bold: boolean, italic: boolean) => {
    const face=styles.find(face => /bold|black|heavy|semibold/i.test(face.style) === bold && /italic|oblique/i.test(face.style) === italic);
    if (!face) { setError("That font style is not installed. Choose another font family or import its font file."); return; }
    if(rangeFormat({fontName:face.postscriptName}))return;
    setFontName(face.postscriptName); setFontChanged(true); setFormatChanged(true); setError("");
  };
  const arrange = (order: "front"|"forward"|"backward"|"back") => {
    if (!bytes.current || !worker.current || busy) return;
    void (async()=>{
      let target=selected;
      if (unapplied) {
        if (!await apply()) return;
        target=latestObjects.current.find(item=>item.cell?.id===lastCellId.current)||latestObjects.current.find(item=>item.text.replace(/\s+/g," ").trim()===text.replace(/\s+/g," ").trim() && Math.abs(item.bounds[0]-(selected?.bounds[0] || 0))<1) || null;
        if (!target) {setError("Select the updated text again to arrange it.");return;}
      }
      const indices=selectedImage ? [selectedImage.index] : (target?.members || (target ? [target] : [])).map(item=>item.index);
      if (!indices.length) return;
      selectionPending.current=selectedImage?{bounds:selectedImage.bounds,image:true}:{cellId:target?.cell?.id,text:target?.text,bounds:target!.bounds};
      setBusy(true); lastChangedPage.current=activePage.current;
      worker.current?.postMessage({id:++request.current,kind:"order",bytes:bytes.current,page:activePage.current-1,indices,order});
    })();
  };
  // `layout` changes when PDF.js changes a page viewport or replaces its rendered layers.
  void layout;
  const pages = [...new Set([activePage.current, ...changedPages])].filter(number => number >= 1 && number <= (workingPdf ?? pdf).numPages);
  return <>
    {createPortal(<aside className="inline-editor-panel" role="toolbar" aria-label="PDF editor" onMouseDownCapture={event=>{if((event.target as HTMLElement).closest('button'))event.preventDefault();}}>
      <div className="inline-editor-head"><span className="inline-editor-title" onClick={() => { if (unapplied) void apply(); else clearSelection(); }}>Edit PDF {dirty && "\u2022"}</span><div className="inline-editor-actions"><ActionIcon icon="undo" label="Undo" disabled={busy || history.index === 0 && !(selected && text!==initialText.current)} onClick={() => move(-1)}/><ActionIcon icon="redo" label="Redo" disabled={busy || history.index >= history.length - 1 && !typingRedo} onClick={() => move(1)}/><ActionIcon icon="check" label="Done" onClick={close}/></div></div>
      <div className="inline-editor-content">
      {documentOcr?<DocumentOcrPanel key={`ocr-pages-${revision}`} count={(workingPdf??pdf).numPages} current={activePage.current} raster={renderOcrPage} convert={convertOcrDraft} apply={applyOcrDraft} onWorking={setBusy} onClose={()=>setDocumentOcr(false)}/>:<>
      {mode === "text" && <section className="editor-section"><h3><Icon name="cursor" size={15}/> Selection</h3><label className="editor-field">Group text by<select aria-label="Text selection size" value={granularity} disabled={busy} onChange={event => {
        const next = event.target.value as "word" | "line" | "paragraph";
        if (unapplied) { void apply(); return; }
        clearSelection(); granularityRef.current = next; setGranularity(next);
        if (bytes.current) inspect(visiblePage.current, bytes.current);
      }}><option value="paragraph">Paragraphs</option><option value="word">Words</option><option value="line">Lines</option></select></label></section>}
      {selectedGraphics.length>0&&<section className="editor-section"><h3><Icon name="layers" size={15}/> Drawing<span className="editor-selection-count">{selectedGraphics.length} selected</span></h3>{!selectedImage&&selectedGraphics.length===1&&selectedGraphics[0].type===5&&!ocrTarget&&<div className="inline-editor-actions"><button className="btn ghost" disabled={busy} onClick={()=>setOcrTarget({graphic:selectedGraphics[0]})} aria-label="Detect text in group" title="Detect text in group"><Icon name="scanText" size={18}/></button><button className="btn ghost" disabled={busy} onClick={()=>void(async()=>{try{const target={graphic:selectedGraphics[0]},frame=await ocrRaster(target),canvas=canvasFor(frame),blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Couldn't prepare the group image.")),"image/png"));await convertOcr([],new Uint8Array(await blob.arrayBuffer()),target);}catch(reason){setError(reason instanceof Error?reason.message:"Couldn't convert the group.");}})()} aria-label="Convert group to image" title="Convert group to image"><Icon name="image" size={18}/></button></div>}</section>}
      {selected && <>
        <section className="editor-section"><h3><Icon name="text" size={15}/> Font formatting</h3><div className="inline-editor-actions editor-font-fields">
        <FontSelect label="Text font" value={selectedFace?.postscriptName || ""} faces={fonts} original={!selectedFace?selected.fontName || "Original font":undefined} onChange={value=>{if(rangeFormat({fontName:value}))return;setFontName(value);setFontChanged(true);setFormatChanged(true);}} />
        {styles.length>1&&<FontSelect label="Font style" kind="style" value={selectedFace?.postscriptName || ""} faces={styles} onChange={value=>{if(rangeFormat({fontName:value}))return;setFontName(value);setFontChanged(true);setFormatChanged(true);}} />}
        <label className="editor-field">Font size<input aria-label="Font size" type="number" min="1" max="300" step="any" placeholder="Size" value={fontSizeDraft ?? (currentRun?.fontSize?String(currentRun.fontSize*(selected?.fontScale || 1)):fontSize)} onFocus={event=>setFontSizeDraft(event.currentTarget.value)} onBlur={()=>setFontSizeDraft(null)} onChange={event => { const value=event.target.value;setFontSizeDraft(value);if(!value)return;if(rangeFormat({fontSize:Number(value)/(selected.fontScale || 1)}))return;setFontSize(value); setFormatChanged(true); }} /></label>

        <label className="editor-field">Color<input aria-label="Text color" type="color" value={currentRun?.color || color} onChange={event => { if(rangeFormat({color:event.target.value}))return;setColor(event.target.value); setChangeColor(true); setFormatChanged(true); }} /></label>
        <div className="format-buttons" role="group" aria-label="Text style">
          {canBold&&<button className="btn ghost" title="Bold" aria-label="Bold" aria-pressed={traits.bold} onClick={()=>chooseStyle(!traits.bold,traits.italic)}><Icon name="bold" size={18}/></button>}
          {canItalic&&<button className="btn ghost" title="Italic" aria-label="Italic" aria-pressed={traits.italic} onClick={()=>chooseStyle(traits.bold,!traits.italic)}><Icon name="italic" size={18}/></button>}
          <button className="btn ghost" title="Underline" aria-label="Underline" aria-pressed={currentRun?.underline ?? underline} onClick={()=>{if(rangeFormat({underline:!(currentRun?.underline ?? underline)}))return;setUnderline(!underline);setUnderlineChanged(true);setFormatChanged(true);}}><Icon name="underline" size={18}/></button>
        </div>
        <label className="inline-editor-file" title="Import font file"><Icon name="fontFile" size={18}/><span className="sr-only">Import font file</span><input aria-label="Choose a font file" type="file" accept=".ttf,.otf,font/ttf,font/otf" onChange={async event => {
          const file = event.target.files?.[0]; if (!file) return;
          try {
            if(file.size>64*1024*1024)throw new Error("The selected font is too large.");
            const loaded=await new FontFace(file.name,await file.arrayBuffer()).load();document.fonts.add(loaded);importedFaces.current.push(loaded);
            const id = `file:${file.name}`, face: LocalFontFace = { family: file.name, fullName: file.name, style: "Font file", postscriptName: id, blob: async () => file };
            setFonts(existing => [...existing.filter(item => item.postscriptName !== id), face]); setFontName(id); setFontChanged(true); setFormatChanged(true);
          }catch(reason){setError(reason instanceof Error?reason.message:"Couldn't load that font.");}
        }} /></label>

        </div></section><section className="editor-section"><h3><Icon name="alignLeft" size={15}/> Paragraph</h3><div className="inline-editor-actions">
        <div className="format-buttons" role="group" aria-label="Paragraph alignment">{(["left","center","right","justify"] as const).map(value=><button key={value} className="btn ghost" title={`Align ${value}`} aria-label={`Align ${value}`} aria-pressed={alignment===value} onClick={()=>{setAlignment(value);setFormatChanged(true);}}><Icon name={({left:"alignLeft",center:"alignCenter",right:"alignRight",justify:"alignJustify"} as const)[value]} size={18}/></button>)}</div>
        <div className="format-buttons" role="group" aria-label="Lists">
          <button className="btn ghost" onClick={()=>setText(text.split("\n").map(row=>/^[•] /.test(row)?row.slice(2):`• ${row}`).join("\n"))} aria-label="Bulleted list" title="Bulleted list"><Icon name="bulletList" size={18}/></button>
          <button className="btn ghost" onClick={()=>setText(text.split("\n").map((row,i)=>/^\d+\. /.test(row)?row.replace(/^\d+\. /,""):`${i+1}. ${row}`).join("\n"))} aria-label="Numbered list" title="Numbered list"><Icon name="numberList" size={18}/></button>
        </div>
        <div className="format-grid">
          <label>Line spacing<input aria-label="Line spacing" type="number" min=".5" max="4" step=".1" value={lineHeight} onChange={e=>{setLineHeight(e.target.value);setSpacingChanged(true);setFormatChanged(true);}} /></label>
          <label>Paragraph spacing<input aria-label="Paragraph spacing" type="number" min="0" max="40" step="1" value={paragraphSpacing} onChange={e=>{setParagraphSpacing(e.target.value);setSpacingChanged(true);setFormatChanged(true);}} /></label>
          <label>Horizontal scale (%)<input aria-label="Horizontal scale" type="number" min="10" max="300" value={horizontalScale} onChange={e=>{setHorizontalScale(e.target.value);setFormatChanged(true);}} /></label>
          <label>Character spacing (pt)<input aria-label="Character spacing" type="number" min="-20" max="20" step=".01" value={tracking} onChange={e=>{setTracking(e.target.value);setFormatChanged(true);}} /></label>
        </div>
        <button className="btn ghost" title="Add link" aria-label="Add link" onClick={()=>setLink(link === null ? "https://" : null)}><Icon name="link" size={18}/><span className="sr-only">Add link</span></button>
        {link !== null && <input className="format-link" aria-label="Text link URL" type="url" value={link} placeholder="https://example.com" onChange={e=>{setLink(e.target.value);setFormatChanged(true);}}/>}
        <button className="btn ghost" title="Cancel text" aria-label="Cancel text" onClick={() => { if (!unapplied || confirm("Discard the un-applied text change?")) clearSelection(); }}><Icon name="close" size={18}/></button>
        </div></section>
      </>}
      {(selected || selectedImage) && <section className="editor-section"><h3><Icon name="layers" size={15}/> Object order</h3><div className="inline-editor-actions">{([["front","Bring to front"],["forward","Bring forward"],["backward","Send backward"],["back","Send to back"]] as const).map(([order,label])=><ActionIcon key={order} icon={order} label={label} disabled={busy} onClick={()=>arrange(order)}/>)}</div></section>}
      {mode === "image" && selectedImage && <>
        <section className="editor-section"><h3><Icon name="image" size={15}/> Image</h3>
        {!ocrTarget&&<button className="btn ghost" disabled={busy} onClick={()=>setOcrTarget({image:selectedImage})} aria-label="Detect text" title="Detect text"><Icon name="scanText" size={18}/></button>}
        <div className="inline-editor-actions">
        <button className="btn ghost" disabled={busy} onClick={() => editImage(selectedImage, "transform-image", 0, 0, "rotate-right")} aria-label="Rotate" title="Rotate"><Icon name="rotate" size={18}/></button>
        <button className="btn ghost" disabled={busy} onClick={() => editImage(selectedImage, "transform-image", 0, 0, "flip-horizontal")} aria-label="Flip" title="Flip"><Icon name="flip" size={18}/></button>
        <button className="btn ghost" disabled={busy} onClick={() => editImage(selectedImage, "duplicate-image")} aria-label="Duplicate" title="Duplicate"><Icon name="duplicate" size={18}/></button>
        <button className="btn ghost" disabled={busy} onClick={() => void copyImage(selectedImage)} aria-label="Copy image" title="Copy image"><Icon name="clipboard" size={18}/></button>
        <label className="inline-editor-file" title="Replace image"><Icon name="replaceImage" size={18}/><span className="sr-only">Replace image</span><input aria-label="Replace image" type="file" accept="image/png,image/jpeg" disabled={busy} onChange={event => {
          const file = event.target.files?.[0]; if (file && selectedImage) void replaceImage(selectedImage, file); event.target.value = "";
        }} /></label>
        </div></section>
      </>}
      {ocrTarget&&<OcrPanel key={`${ocrTarget.image?"image":"group"}-${(ocrTarget.image || ocrTarget.graphic)!.index}-${revision}`} raster={()=>ocrRaster()} onConvert={convertOcr} onClose={()=>setOcrTarget(null)}/>}

      <section className="editor-section"><h3><Icon name="plus" size={15}/> Add content</h3><div className="inline-editor-actions">
        <button className="btn ghost" disabled={busy} title="Add text" aria-label="Add text" onClick={()=>setAdding(adding === "text" ? null : "text")}><Icon name="text" size={18}/><span className="sr-only">Add text</span></button>
        {window.zionpdfDesktop ? <button className="btn ghost" disabled={busy} onClick={()=>void window.zionpdfDesktop!.pickEditorImage().then(result=>{if(result)setAdding(new File([new Uint8Array(result.data)],result.name));}).catch(reason=>setError(reason instanceof Error?reason.message:"Couldn't open the image picker."))} aria-label="Add image" title="Add image"><Icon name="image" size={18}/></button> : <label className="inline-editor-file" title="Add image"><Icon name="image" size={18}/><span className="sr-only">Add image</span><input aria-label="Add image" type="file" accept="image/png,image/jpeg" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)setAdding(file);e.target.value="";}}/></label>}
      </div></section>
      {adding && <span className="inline-editor-hint">Click on the page to place {adding === "text" ? "new text" : "the image"}. <button className="btn ghost" onClick={()=>setAdding(null)}>Cancel placement</button></span>}
      {busy && <span role="status">Preparing…</span>}
      {selected && livePreview?.text===text && livePreview.carets===null && <span className="inline-editor-hint">Precise cursor positioning is unavailable for this text. The editing font is shown as an approximation.</span>}
      {(error || previewError) && <span className="inline-editor-error" role="alert">{error || previewError}</span>}
      {pendingRef.current && page !== activePage.current && <span className="inline-editor-hint">Finish the text change before editing another page.</span>}
      </>}
      </div>
      <div className="inline-editor-footer"><button className="btn primary" disabled={busy || !dirty} onClick={() => void save()} title="Save" aria-label="Save"><Icon name="save" size={18}/></button><button className="btn ghost" disabled={busy || !dirty} onClick={() => void save("copy")} title="Save copy" aria-label="Save copy"><Icon name="copy" size={18}/></button><button className="btn ghost" disabled={busy} onClick={onExport} title="Export" aria-label="Export"><Icon name="upload" size={18}/></button></div>
    </aside>, panelRoot)}
    {pages.map(number => {
      const view = viewer.getPageView(number - 1);
      if (!view?.div || !view.viewport) return null;
      const viewport = view.viewport;
      const active = number === activePage.current;
      const draftText=active&&selected&&!!(unapplied||pendingBounds?.resize)&&!exactPreview;
      const rect = view.div.getBoundingClientRect(), host = container.getBoundingClientRect();
      return createPortal(<div className="inline-pdf-layer" data-inline-page={number} data-object-ready={active&&objectLayers?.key===layerKey || undefined} data-live-drag={active&&gesture?.kind==="objects" || undefined} style={{ left: rect.left - host.left + container.scrollLeft,
        top: rect.top - host.top + container.scrollTop, width: rect.width, height: rect.height }}>
        {workingPdf && changedPages.includes(number) && <EditedPage key={number} pdf={workingPdf} page={number} viewport={viewport} version={workingVersion} onPaint={version=>{if(gestureRef.current?.awaitVersion&&version>=gestureRef.current.awaitVersion)clearGesture();}}/>}
        {active && livePreview && selected && !draftText && <TextPreview frame={livePreview}/>}
        {draftText&&objectLayers?.key===layerKey&&<PixelCanvas className="editor-object-background" frame={{pixels:objectLayers.background,width:objectLayers.width,height:objectLayers.height}}/>}
        {active&&gesture&&!(gesture.kind==="text"&&(pendingBounds?.resize||draftText)&&selected&&!busy)&&<ObjectGhost layers={gesture.layers} fallback={gesture.fallback} bounds={gesture.bounds} destination={gesture.destination} viewport={viewport}/>}
        {active && !busy && !documentOcr && adding && <button className="inline-add-target" aria-label="Place new content on page" onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();const point=viewport.convertToPdfPoint((event.clientX-rect.left)*viewport.width/rect.width,(event.clientY-rect.top)*viewport.height/rect.height);void addAt([point[0],point[1]]);}}/>}
        {active && !busy && !documentOcr && objects.map(object => {
          const hit=object.cell?.bounds || object.bounds;
          const a = viewport.convertToViewportPoint(hit[0], hit[1]), b = viewport.convertToViewportPoint(hit[2], hit[3]);
          const left = Math.min(a[0], b[0]), top = Math.min(a[1], b[1]), width = Math.abs(b[0] - a[0]), height = Math.abs(b[1] - a[1]);
          const position = { left: `${100 * left / viewport.width}%`, top: `${100 * top / viewport.height}%`, width: `${Math.max(0.6, 100 * width / viewport.width)}%`, height: `${Math.max(0.8, 100 * height / viewport.height)}%` };
          if(selected?.index===object.index){
            const bounds=pendingBounds?.bounds || (exactPreview?livePreview?.bounds:undefined) || textCellBounds(object),a=viewport.convertToViewportPoint(bounds[0],bounds[1]),b=viewport.convertToViewportPoint(bounds[2],bounds[3]);
            const sx=Number(horizontalScale)/100;
            const current=livePreview?.text===text?livePreview.carets?.[caret]:null;
            const cellLeft=Math.min(a[0],b[0]),cellTop=Math.min(a[1],b[1]);
            const point=current?viewport.convertToViewportPoint(current[0],current[1]):null,topPoint=current?viewport.convertToViewportPoint(current[0],current[2]):null;
            return <div key={object.index} className="inline-text-cell" style={{left:Math.min(a[0],b[0]),top:Math.min(a[1],b[1]),width:Math.abs(b[0]-a[0]),height:Math.abs(b[1]-a[1]),background:draftText&&objectLayers?.key!==layerKey?"#fff":undefined}}>
              {draftText&&<LiveText text={text} runs={styleRuns} faces={fonts} fontFamily={!fontChanged&&editFontFamily?`"${editFontFamily}"`:previewFont?.family || matchLocalFont(fonts,object.fontName)?.family || "serif"} fontSize={(Number(fontSize)||(object.fontSize || 12)*(object.fontScale || 1))*viewport.scale} unitScale={(object.fontScale || 1)*viewport.scale} color={color} scaleX={sx} lineHeight={Number(lineHeight)} tracking={Number(tracking)*viewport.scale} alignment={alignment || "left"} underline={underline} bold={/bold|heavy|black|semibold/i.test(previewFont?.style || object.fontName || "")} italic={/italic|oblique/i.test(previewFont?.style || object.fontName || "")}/>}
              <textarea ref={input} data-caret-fallback={livePreview?.text===text && livePreview.carets===null || undefined} aria-label="Edit PDF text on page" className="inline-pdf-input" value={text} onChange={event=>{if(!((event.nativeEvent as InputEvent).inputType || "").startsWith("history"))setTypingRedo(false);setStyleRuns(runs=>shiftStyles(runs,text,event.target.value));setCellFrame(false);setText(event.target.value);setCaret(event.target.selectionStart);setSelection([event.target.selectionStart,event.target.selectionEnd]);}} onFocus={event=>{setInputFocused(true);setCaret(event.target.selectionEnd);setSelection([event.target.selectionStart,event.target.selectionEnd]);}} onBlur={()=>setInputFocused(false)} onSelect={event=>{const el=event.currentTarget;setCaret(el.selectionDirection==="backward"?el.selectionStart:el.selectionEnd);setSelection([el.selectionStart,el.selectionEnd]);}}
                onPointerDown={event=>{setCellFrame(false);event.stopPropagation();const positions=livePreview?.text===text?livePreview.carets:null;if(!positions){if(draftText)return;if(!(livePreview?.text===text && livePreview.carets===null))event.preventDefault();return;}const bestOffset=closestCaret(positions,viewport,view.div.getBoundingClientRect(),event.clientX,event.clientY);let best=bestOffset;event.preventDefault();const el=event.currentTarget;el.focus({preventScroll:true});let anchor=event.shiftKey?el.selectionStart:best;
                  if(event.detail===2){let start=best,end=best;while(start>0&&!/\s/.test(text[start-1]))start--;while(end<text.length&&!/\s/.test(text[end]))end++;anchor=start;best=end;}
                  el.setSelectionRange(Math.min(anchor,best),Math.max(anchor,best),best<anchor?"backward":"forward");setCaret(best);setSelection([Math.min(anchor,best),Math.max(anchor,best)]);selectionDrag.current=anchor;el.setPointerCapture(event.pointerId);}}
                onPointerMove={event=>{const anchor=selectionDrag.current,positions=livePreview?.text===text?livePreview.carets:null;if(anchor===null||!positions)return;const bestOffset=closestCaret(positions,viewport,view.div.getBoundingClientRect(),event.clientX,event.clientY);let best=bestOffset;event.currentTarget.setSelectionRange(Math.min(anchor,best),Math.max(anchor,best),best<anchor?"backward":"forward");setCaret(best);setSelection([Math.min(anchor,best),Math.max(anchor,best)]);}}
                onPointerUp={()=>{selectionDrag.current=null;}} onPointerCancel={()=>{selectionDrag.current=null;}}
                onKeyDown={event=>{if(event.ctrlKey||event.metaKey||event.altKey||!["ArrowUp","ArrowDown","Home","End"].includes(event.key))return;const positions=livePreview?.text===text?livePreview.carets:null;if(!positions)return;const el=event.currentTarget,current=el.selectionDirection==="backward"?el.selectionStart:el.selectionEnd,origin=positions[current];if(!origin)return;const p=viewport.convertToViewportPoint(origin[0],origin[1]);let best=current,score=Infinity;positions.forEach((candidate,index)=>{const q=viewport.convertToViewportPoint(candidate[0],candidate[1]),dx=q[0]-p[0],dy=q[1]-p[1];let value=Infinity;if(event.key==="ArrowUp"&&dy<-.5)value=Math.abs(dy)*1000+Math.abs(dx);else if(event.key==="ArrowDown"&&dy>.5)value=Math.abs(dy)*1000+Math.abs(dx);else if((event.key==="Home"||event.key==="End")&&(event.key==="Home"?index<current:index>current)){const top=viewport.convertToViewportPoint(origin[0],origin[2]),vx=top[0]-p[0],vy=top[1]-p[1];const cross=Math.abs(dx*vx+dy*vy)/Math.max(1,Math.hypot(vx,vy));if(cross<1)value=event.key==="Home"?index:-index;}if(value<score){score=value;best=index;}});event.preventDefault();event.stopPropagation();const anchor=event.shiftKey?(el.selectionDirection==="backward"?el.selectionEnd:el.selectionStart):best;el.setSelectionRange(Math.min(anchor,best),Math.max(anchor,best),best<anchor?"backward":"forward");setCaret(best);setSelection([Math.min(anchor,best),Math.max(anchor,best)]);}}
                style={{inset:0,width:`${100/sx}%`,height:"100%",minWidth:0,minHeight:0,top:0,left:0,padding:0,border:0,background:livePreview?.text===text && livePreview.carets===null?"#fff":"transparent",color:livePreview?.text===text && livePreview.carets===null?color:"transparent",caretColor:draftText?color:livePreview?.text===text && livePreview.carets===null?color:"transparent",
                  fontFamily:editFontFamily?`"${editFontFamily}"`:previewFont?.family || matchLocalFont(fonts,object.fontName)?.family,
                  fontSize:`${(Number(fontSize)||(object.fontSize || 12)*(object.fontScale || 1))*viewport.scale}px`,fontSynthesis:"none",fontWeight:"normal",fontStyle:"normal",
                  transform:`scaleX(${sx})`,transformOrigin:"top left",lineHeight:Number(lineHeight),textAlign:alignment,letterSpacing:`${Number(tracking)*viewport.scale}px`}}/>
              {!cellFrame && livePreview?.text===text && livePreview.carets && selection[0]!==selection[1] && livePreview.carets.slice(selection[0],selection[1]).map((p,i)=>{const next=livePreview.carets![selection[0]+i+1];if(!next)return null;const start=viewport.convertToViewportPoint(p[0],p[1]),end=viewport.convertToViewportPoint(next[0],next[1]),top=viewport.convertToViewportPoint(p[0],p[2]),endTop=viewport.convertToViewportPoint(next[0],next[2]);const vx=top[0]-start[0],vy=top[1]-start[1];if(Math.abs((end[0]-start[0])*vx+(end[1]-start[1])*vy)>(vx*vx+vy*vy)*.6)return null;const xs=[start[0],end[0],top[0],endTop[0]],ys=[start[1],end[1],top[1],endTop[1]];return <span key={i} className="pdf-text-selection" style={{left:Math.min(...xs)-cellLeft,top:Math.min(...ys)-cellTop,width:Math.max(2,Math.max(...xs)-Math.min(...xs)),height:Math.max(2,Math.max(...ys)-Math.min(...ys))}}/>;})}
              {!draftText && !cellFrame && inputFocused && selection[0]===selection[1] && point && topPoint && <span className="pdf-text-caret" style={{left:Math.min(point[0],topPoint[0])-cellLeft,top:Math.min(point[1],topPoint[1])-cellTop,width:Math.max(2,Math.abs(point[0]-topPoint[0])),height:Math.max(2,Math.abs(point[1]-topPoint[1])),background:color}}/>}
              {!cellFrame && (["top","right","bottom","left"] as const).map(edge=><button key={edge} className={`inline-text-frame-activate frame-${edge}`} aria-label={`Select text cell ${edge} border`} title="Select the border to move or resize" onPointerDown={event=>{event.preventDefault();event.stopPropagation();setCellFrame(true);}}/>)}
              {cellFrame && <TextCellControls view={view} onStart={cell=>beginGesture(bounds,(object.members || [object]).map(item=>item.index),"text",cell.closest<HTMLElement>(".inline-pdf-layer")!)} onPreview={(bounds,resize)=>{setPendingBounds({bounds,resize});moveGesture(bounds);}} onCommit={(bounds,resize)=>void transformText(bounds,resize)} onCancel={()=>{setPendingBounds(null);clearGesture();}}/>}
            </div>;
          }
          return <button key={object.index} className="inline-pdf-target" aria-label={`Edit text: ${object.text}`} title={object.text} onClick={() => void pick(object)} style={position} />;
        })}
        {active && !busy && !documentOcr && graphics.map(graphic=>{
          const matrix=viewport.transform.join(" "),box=graphic.bounds;
          const shape=graphic.path || `M ${box[0]} ${box[1]} L ${box[2]} ${box[1]} L ${box[2]} ${box[3]} L ${box[0]} ${box[3]} Z`;
          const chosen=selectedGraphics.some(item=>item.index===graphic.index);
          return <svg key={`graphic-${graphic.index}`} className="inline-graphic-layer" width={viewport.width} height={viewport.height} aria-label={`Drawing ${graphic.index+1}`}>
            <path className={`inline-graphic-target${chosen?" selected":""}`} d={shape} transform={`matrix(${matrix})`} vectorEffect="non-scaling-stroke" fill="none" stroke="transparent" strokeWidth="8" aria-label={`Select drawing ${graphic.index+1}`}
              onPointerDown={event=>{event.preventDefault();event.stopPropagation();if(unapplied){setError("Click outside the text to keep the text change before selecting a drawing.");return;}
                const next=event.shiftKey?(chosen?selectedGraphics.filter(item=>item.index!==graphic.index):[...selectedGraphics,graphic]):chosen?selectedGraphics:[graphic];
                const image=event.shiftKey||chosen?selectedImage:null;setSelected(null);setSelectedImage(image);setSelectedGraphics(next);setMode("image");setError("");
                graphicDrag.current={x:event.clientX,y:event.clientY,graphics:next,images:image?[image]:[]};const boxes=[...next.map(item=>item.bounds),...(image?[image.bounds]:[])];if(boxes.length)beginGesture([Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))],[...next.map(item=>item.index),...(image?[image.index]:[])],"objects",event.currentTarget.closest<HTMLElement>(".inline-pdf-layer")!);event.currentTarget.setPointerCapture(event.pointerId);}}
              onPointerMove={event=>{const start=graphicDrag.current;if(start)dragGesture(event.clientX-start.x,event.clientY-start.y);}}
              onPointerUp={event=>{const start=graphicDrag.current;graphicDrag.current=null;if(!start||Math.hypot(event.clientX-start.x,event.clientY-start.y)<4||!worker.current||!bytes.current){clearGesture();return;}settleGesture();
                const rect=view.div.getBoundingClientRect(),from=viewport.convertToPdfPoint((start.x-rect.left)*viewport.width/rect.width,(start.y-rect.top)*viewport.height/rect.height),to=viewport.convertToPdfPoint((event.clientX-rect.left)*viewport.width/rect.width,(event.clientY-rect.top)*viewport.height/rect.height);
                setBusy(true);lastChangedPage.current=activePage.current;worker.current.postMessage({id:++request.current,kind:"move-graphics",bytes:bytes.current,page:activePage.current-1,graphics:start.graphics,images:start.images,dx:to[0]-from[0],dy:to[1]-from[1]});}}
              onPointerCancel={()=>{graphicDrag.current=null;clearGesture();}} />
          </svg>;
        })}
        {active && !busy && !documentOcr && images.map(image => {
          const a = viewport.convertToViewportPoint(image.bounds[0], image.bounds[1]), b = viewport.convertToViewportPoint(image.bounds[2], image.bounds[3]);
          const left = Math.min(a[0], b[0]), top = Math.min(a[1], b[1]), width = Math.abs(b[0] - a[0]), height = Math.abs(b[1] - a[1]);
          return <div key={image.index} className="inline-image-cell"><button className={`inline-image-target ${selectedImage?.index === image.index ? "selected" : ""}`}
            aria-label={`Select image ${image.index + 1}`} title={image.unsupported || "Drag to move image"} style={{ left: `${100 * left / viewport.width}%`, top: `${100 * top / viewport.height}%`,
              width: `${Math.max(1, 100 * width / viewport.width)}%`, height: `${Math.max(1, 100 * height / viewport.height)}%` }}
            onClick={() => { if (!unapplied && !busy) { setMode("image"); setSelectedImage(image); } }}
            onPointerDown={async event => { event.preventDefault(); event.stopPropagation(); if (unapplied) { if (await apply()) { const next = latestImages.current.find(item => item.bounds.every((v,i) => Math.abs(v-image.bounds[i]) < .1)); if (next) { setMode("image"); setSelectedImage(next); } } return; } const group=event.shiftKey || selectedImage?.index===image.index ? selectedGraphics : [];if(!group.length)setSelectedGraphics([]);setMode("image"); setSelected(null); setSelectedImage(image); drag.current = { x: event.clientX, y: event.clientY, image, graphics:group };const boxes=[image.bounds,...group.map(item=>item.bounds)];beginGesture([Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))],[image.index,...group.map(item=>item.index)],"objects",event.currentTarget.closest<HTMLElement>(".inline-pdf-layer")!);event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={event => { const start = drag.current; if (!start || start.edge) return;dragGesture(event.clientX-start.x,event.clientY-start.y); event.currentTarget.style.transform = `translate(${event.clientX-start.x}px, ${event.clientY-start.y}px)`; const controls = event.currentTarget.parentElement?.querySelector<HTMLElement>(".inline-image-controls"); if (controls) controls.style.transform = event.currentTarget.style.transform; }}
            onPointerUp={event => {
              event.currentTarget.style.transform = "";
              const start = drag.current; drag.current = null;
              if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4) {clearGesture();return;}settleGesture();
              const rect = view.div.getBoundingClientRect();
              const from = viewport.convertToPdfPoint((start.x - rect.left) * viewport.width / rect.width, (start.y - rect.top) * viewport.height / rect.height);
              const to = viewport.convertToPdfPoint((event.clientX - rect.left) * viewport.width / rect.width, (event.clientY - rect.top) * viewport.height / rect.height);
              if(start.graphics?.length && worker.current && bytes.current){setBusy(true);lastChangedPage.current=activePage.current;worker.current.postMessage({id:++request.current,kind:"move-graphics",bytes:bytes.current,page:activePage.current-1,graphics:start.graphics,images:[start.image],dx:to[0]-from[0],dy:to[1]-from[1]});}
              else editImage(start.image, "move-image", to[0] - from[0], to[1] - from[1]);
            }} onPointerCancel={event => { drag.current = null;event.currentTarget.style.transform="";const controls=event.currentTarget.parentElement?.querySelector<HTMLElement>(".inline-image-controls");if(controls)controls.style.transform="";clearGesture(); }} />
            {selectedImage?.index === image.index && <div className="inline-image-controls" style={{ left, top, width, height }}>
              <button className="inline-image-delete" aria-label="Delete selected image" title="Delete image" onClick={() => editImage(image, "delete-image")}><Icon name="trash" size={16} /></button>
              {["n", "s", "e", "w", "ne", "nw", "se", "sw"].map(edge => <button key={edge} className={`inline-image-handle handle-${edge}`} aria-label={`Resize image ${edge}`}
                onPointerDown={event => { event.preventDefault(); event.stopPropagation(); drag.current = { x: event.clientX, y: event.clientY, image, edge };beginGesture(image.bounds,[image.index],"objects",event.currentTarget.closest<HTMLElement>(".inline-pdf-layer")!); event.currentTarget.setPointerCapture(event.pointerId); }}
                onPointerMove={event => { const start = drag.current; if (!start) return; const cell = event.currentTarget.parentElement!; const dx = event.clientX-start.x, dy = event.clientY-start.y;
                  cell.style.left = `${left + (edge.includes("w") ? dx : 0)}px`; cell.style.top = `${top + (edge.includes("n") ? dy : 0)}px`;
                  cell.style.width = `${Math.max(10, width + (edge.includes("w") ? -dx : edge.includes("e") ? dx : 0))}px`;
                  cell.style.height = `${Math.max(10, height + (edge.includes("n") ? -dy : edge.includes("s") ? dy : 0))}px`;
                  const a=viewport.convertToPdfPoint(parseFloat(cell.style.left),parseFloat(cell.style.top)),b=viewport.convertToPdfPoint(parseFloat(cell.style.left)+parseFloat(cell.style.width),parseFloat(cell.style.top)+parseFloat(cell.style.height));moveGesture([Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])]); }}
                onPointerUp={event => { const start = drag.current; drag.current = null; if (!start || !worker.current || !bytes.current) return;
                  const dx = event.clientX-start.x, dy = event.clientY-start.y;
                  const x1 = left+(edge.includes("w") ? dx : 0), y1 = top+(edge.includes("n") ? dy : 0);
                  const x2 = left+width+(edge.includes("e") ? dx : 0), y2 = top+height+(edge.includes("s") ? dy : 0);
                  const a = viewport.convertToPdfPoint(x1,y1), b = viewport.convertToPdfPoint(x2,y2);
                  setBusy(true); lastChangedPage.current = activePage.current;
                  settleGesture();worker.current.postMessage({ id: ++request.current, kind: "resize-image", bytes: bytes.current, page: activePage.current-1, image, bounds: [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])] });
                }} onPointerCancel={event => { drag.current = null;const cell=event.currentTarget.parentElement!;Object.assign(cell.style,{left:`${left}px`,top:`${top}px`,width:`${width}px`,height:`${height}px`});clearGesture(); }} />)}
            </div>}
          </div>;
        })}
      </div>, overlayRoot, `page-${number}`);
    })}
  </>;
}
