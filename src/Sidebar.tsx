import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { renderThumbnail, type OutlineItem, type PDFDocumentProxy } from "./pdf";
import { Icon } from "./icons";

export type PageCommand = { id: number; page: number; action: "delete" | "rotate" | "flip" | "reorder"; target?: number };
interface Props {
  onPageAction?: (page: number, action: PageCommand["action"], target?: number) => void;
  pdf: PDFDocumentProxy;
  page: number;
  rotation: number;
  onSelectPage: (n: number) => void;
  onSelectDest: (dest: unknown) => void;
  tab: SidebarTab;
  onTab: (tab: SidebarTab) => void;
  notes: ReactNode;
  noteCount: number;
  disableNotes?: boolean;
  viewerContainer: HTMLElement | null;
}
type VisibleArea={left:number;top:number;width:number;height:number};

export type SidebarTab = "pages" | "outline" | "notes";

export function Sidebar({ pdf, page, rotation, onSelectPage, onSelectDest, tab, onTab: setTab, notes, noteCount, disableNotes, onPageAction, viewerContainer }: Props) {
  const [outline, setOutline] = useState<OutlineItem[] | null>(null);

  useEffect(() => {
    setOutline(null);
    let cancelled = false;
    pdf.getOutline().then((o) => { if (!cancelled) setOutline((o as OutlineItem[] | null) ?? []); }).catch(() => {});
    return () => { cancelled = true; };
  }, [pdf]);

  return (
    <aside className={`sidebar tab-${tab}`} onDragOver={event=>{if(event.dataTransfer.types.includes("application/x-zionpdf-page"))event.stopPropagation();}} onDrop={event=>{if(event.dataTransfer.types.includes("application/x-zionpdf-page"))event.stopPropagation();}}>
      <div className="sidebar-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "pages"} className={tab === "pages" ? "on" : ""} onClick={() => setTab("pages")}>
          Pages
        </button>
        <button role="tab" aria-selected={tab === "outline"} className={tab === "outline" ? "on" : ""} onClick={() => setTab("outline")}>
          Outline
        </button>
        <button role="tab" disabled={disableNotes} title={disableNotes ? "Finish editing the PDF to change notes" : undefined} aria-selected={tab === "notes"} className={tab === "notes" ? "on" : ""} onClick={() => setTab("notes")}>
          Notes{noteCount > 0 && <span className="tab-count">{noteCount}</span>}
        </button>
      </div>
      <div className="sidebar-scroll">
        {tab === "notes" ? (
          notes
        ) : tab === "pages" ? (
          <Thumbnails pdf={pdf} page={page} rotation={rotation} onSelect={onSelectPage} onPageAction={onPageAction} viewerContainer={viewerContainer} />
        ) : outline === null ? null : outline.length === 0 ? (
          <div className="empty-outline">
            <Icon name="list" size={22} />
            <p>This document has no outline.</p>
          </div>
        ) : (
          <ul className="outline">
            {outline.map((item, i) => (
              <OutlineNode key={i} item={item} onSelect={onSelectDest} depth={0} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function OutlineNode({ item, onSelect, depth }: { item: OutlineItem; onSelect: (d: unknown) => void; depth: number }) {
  const [open, setOpen] = useState(depth === 0 && item.items.length < 12);
  const hasKids = item.items.length > 0;
  return (
    <li>
      <div className="outline-row" style={{ paddingLeft: 8 + depth * 14 }}>
        <button className={`outline-toggle ${hasKids ? "" : "hidden"} ${open ? "open" : ""}`} onClick={() => setOpen(!open)} tabIndex={hasKids ? 0 : -1} aria-label="Expand">
          <Icon name="chevronRight" size={13} />
        </button>
        <button
          className="outline-title"
          onClick={() => (item.url ? window.open(item.url, "_blank", "noopener") : item.dest && onSelect(item.dest))}
          title={item.title}
        >
          {item.title}
        </button>
      </div>
      {hasKids && open && (
        <ul>
          {item.items.map((child, i) => (
            <OutlineNode key={i} item={child} onSelect={onSelect} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Thumbnails({ pdf, page, rotation, onSelect, onPageAction, viewerContainer }: { onPageAction?: Props["onPageAction"]; pdf: PDFDocumentProxy; page: number; rotation: number; onSelect: (n: number) => void; viewerContainer:HTMLElement|null }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(1.294);
  const [range, setRange] = useState({ start: 0, end: 12 });
  const [visibleAreas,setVisibleAreas]=useState<Record<number,VisibleArea>>({});
  const rowHeight = Math.ceil(THUMB_W * ratio) + 48;
  const extra = onPageAction ? 30 : 0;
  const offset = (index: number) => index * rowHeight + (index > page - 1 ? extra : 0);

  useEffect(()=>{
    if(!viewerContainer)return;
    const viewer=viewerContainer.querySelector<HTMLElement>(".pdfViewer");if(!viewer)return;
    let frame=0;const visible=new Set<HTMLElement>();
    const measure=()=>{frame=0;const outer=viewerContainer.getBoundingClientRect(),left=outer.left+viewerContainer.clientLeft,top=outer.top+viewerContainer.clientTop,right=left+viewerContainer.clientWidth,bottom=top+viewerContainer.clientHeight;
      const next:Record<number,VisibleArea>={};
      for(const element of visible){const n=Number(element.dataset.pageNumber),rect=(element.querySelector<HTMLElement>(".canvasWrapper") || element).getBoundingClientRect();if(!n||!rect.width||!rect.height)continue;
        const x0=Math.max(rect.left,left),y0=Math.max(rect.top,top),x1=Math.min(rect.right,right),y1=Math.min(rect.bottom,bottom);if(x1<=x0||y1<=y0)continue;
        next[n]={left:(x0-rect.left)/rect.width,top:(y0-rect.top)/rect.height,width:(x1-x0)/rect.width,height:(y1-y0)/rect.height};
      }
      setVisibleAreas(previous=>{const before=Object.keys(previous),after=Object.keys(next);if(before.length===after.length&&after.every(key=>{const a=previous[Number(key)],b=next[Number(key)];return a&&Math.abs(a.left-b.left)<.0001&&Math.abs(a.top-b.top)<.0001&&Math.abs(a.width-b.width)<.0001&&Math.abs(a.height-b.height)<.0001;}))return previous;return next;});
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
    const intersections=new IntersectionObserver(entries=>{for(const entry of entries){const target=entry.target as HTMLElement;if(entry.isIntersecting)visible.add(target);else visible.delete(target);}schedule();},{root:viewerContainer});
    const observed=new Set<Element>();
    const refresh=()=>{const pages=new Set(viewer.querySelectorAll<HTMLElement>(":scope > .page[data-page-number]"));for(const node of observed)if(!pages.has(node as HTMLElement)){intersections.unobserve(node);visible.delete(node as HTMLElement);observed.delete(node);}for(const node of pages)if(!observed.has(node)){observed.add(node);intersections.observe(node);}schedule();};
    const mutations=new MutationObserver(refresh);mutations.observe(viewer,{childList:true});
    const resize=new ResizeObserver(schedule);resize.observe(viewerContainer);resize.observe(viewer);
    viewerContainer.addEventListener("scroll",schedule,{passive:true});refresh();
    return()=>{cancelAnimationFrame(frame);viewerContainer.removeEventListener("scroll",schedule);mutations.disconnect();intersections.disconnect();resize.disconnect();};
  },[viewerContainer,pdf,rotation]);

  useEffect(() => {
    let cancelled = false;
    pdf.getPage(1).then((p) => {
      const vp = p.getViewport({ scale: 1, rotation: (p.rotate + rotation) % 360 });
      if (!cancelled) setRatio(vp.height / vp.width);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [pdf, rotation]);

  useEffect(() => {
    const scroll = listRef.current!.parentElement!;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const start = Math.min(pdf.numPages - 1, Math.max(0, Math.floor((scroll.scrollTop - extra) / rowHeight) - 4));
      const end = Math.min(pdf.numPages, Math.ceil((scroll.scrollTop + scroll.clientHeight) / rowHeight) + 4);
      setRange(previous => previous.start === start && previous.end === end ? previous : { start, end });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(scroll);
    scroll.addEventListener("scroll", schedule, { passive: true });
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scroll.removeEventListener("scroll", schedule);
    };
  }, [pdf, rowHeight, page, extra]);

  // Keep the active thumbnail in view as the reader scrolls.
  useEffect(() => {
    const scroll = listRef.current!.parentElement!;
    const top = offset(page - 1), height = rowHeight + extra;
    if (top < scroll.scrollTop || top + height > scroll.scrollTop + scroll.clientHeight) {
      scroll.scrollTop = Math.max(0, top - (scroll.clientHeight - height) / 2);
      scroll.dispatchEvent(new Event("scroll"));
    }
  }, [pdf, page, rowHeight, extra]);

  return (
    <div className="thumbs" ref={listRef} style={{ gap: 0 }}>
      <div aria-hidden="true" style={{ height: offset(range.start), flexShrink: 0 }} />
      {Array.from({ length: Math.max(0, range.end - range.start) }, (_, index) => (
        <Thumb onPageAction={onPageAction} key={`${range.start + index}-${rotation}`} pdf={pdf} n={range.start + index + 1} ratio={ratio} rotation={rotation} active={page === range.start + index + 1} onSelect={onSelect} visibleArea={visibleAreas[range.start+index+1]} />
      ))}
      <div aria-hidden="true" style={{ height: Math.max(0, offset(pdf.numPages) - offset(range.end)), flexShrink: 0 }} />
    </div>
  );
}

const THUMB_W = 132;

const Thumb = memo(function Thumb({
  pdf,
  n,
  ratio,
  rotation,
  active,
  onSelect,
  onPageAction,
  visibleArea,
}: {
  onPageAction?: Props["onPageAction"];
  pdf: PDFDocumentProxy;
  n: number;
  ratio: number;
  rotation: number;
  active: boolean;
  onSelect: (n: number) => void;
  visibleArea?:VisibleArea;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [pageRatio,setPageRatio]=useState(ratio);

  useEffect(() => {
    const el = ref.current!;
    let cancelled = false;
    const controller = new AbortController();
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        const stagingFrame = document.createElement("div"), staging = document.createElement("canvas");
        stagingFrame.append(staging);
        renderThumbnail(pdf, n, staging, THUMB_W, rotation, controller.signal)
          .then(() => {
            const target=canvasRef.current,host=target?.parentElement;
            if(cancelled || !target || !host)return;
            target.width=staging.width;target.height=staging.height;
            if(staging.width)setPageRatio(staging.height/staging.width);
            target.style.width=staging.style.width;target.style.height=staging.style.height;
            target.getContext("2d")?.drawImage(staging,0,0);
            host.querySelector(":scope > canvas.zionpdf-image-overlay")?.remove();
            const overlay=stagingFrame.querySelector("canvas.zionpdf-image-overlay");if(overlay)host.append(overlay);
            setReady(true);
          }).catch(() => {});
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      controller.abort();
      io.disconnect();
    };
  }, [pdf, n, rotation]);

  return (
    <div className="thumb-cell" draggable={!!onPageAction}
      onDragStart={event => { event.dataTransfer.setData("application/x-zionpdf-page", String(n)); event.dataTransfer.effectAllowed = "move"; }}
      onDragOver={event => { if (event.dataTransfer.types.includes("application/x-zionpdf-page")) { event.preventDefault(); event.currentTarget.classList.add("drag-over"); } }}
      onDragLeave={event => event.currentTarget.classList.remove("drag-over")}
      onDrop={event => { event.preventDefault(); event.currentTarget.classList.remove("drag-over"); const from = Number(event.dataTransfer.getData("application/x-zionpdf-page")); if (Number.isInteger(from) && from > 0 && from !== n) onPageAction?.(from,"reorder",n); }}>
    <button ref={ref} data-page={n} className={`thumb ${active ? "on" : ""}`} style={{ height: Math.ceil(THUMB_W * ratio) + (onPageAction && active ? 78 : 48), flexShrink: 0 }} onClick={() => onSelect(n)} aria-label={`Page ${n}`}>
      <div className="thumb-frame" style={{ width: THUMB_W, height: THUMB_W * ratio, flexShrink: 0 }}>
        <canvas ref={canvasRef} style={{ opacity: ready ? 1 : 0 }} />
        {visibleArea && (()=>{const w=Math.min(1,ratio/pageRatio),h=Math.min(1,pageRatio/ratio),left=(1-w)/2,top=(1-h)/2;return <span className="thumb-visible-area" aria-hidden="true" style={{left:`${100*(left+w*visibleArea.left)}%`,top:`${100*(top+h*visibleArea.top)}%`,width:`${100*w*visibleArea.width}%`,height:`${100*h*visibleArea.height}%`}}/>;})()}
      </div>
      <span className="thumb-num">{n}</span>
    </button>
    {onPageAction && active && <div className="thumb-actions" aria-label={`Page ${n} actions`}>
      <button aria-label={`Rotate page ${n}`} title="Rotate page" onClick={() => onPageAction(n,"rotate")}><Icon name="rotate" size={14} /></button>
      <button aria-label={`Flip page ${n}`} title="Flip page horizontally" onClick={() => onPageAction(n,"flip")}>↔</button>
      <button aria-label={`Move page ${n} up`} title="Move page up" disabled={n === 1} onClick={() => onPageAction(n,"reorder",n-1)}>↑</button>
      <button aria-label={`Move page ${n} down`} title="Move page down" disabled={n === pdf.numPages} onClick={() => onPageAction(n,"reorder",n+1)}>↓</button>
      <button aria-label={`Delete page ${n}`} title="Delete page" disabled={pdf.numPages === 1} onClick={() => { if (confirm(`Delete page ${n} from the working copy?`)) onPageAction(n,"delete"); }}><Icon name="trash" size={14} /></button>
    </div>}
    </div>
  );
});
