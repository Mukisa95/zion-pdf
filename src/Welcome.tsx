import { useEffect, useRef, useState } from "react";
import { clearRecent, listRecent, removeRecent, recentDocument, type RecentFile } from "./recent";
import { Icon } from "./icons";
import { keys } from "./platform";
import { formatBytes } from "./Dialogs";
import { updateSummary } from "./updates";

function timeAgo(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function UpdateLine({ status }: { status: UpdateStatus }) {
  const desktop = window.zionpdfDesktop!;
  const check = (
    <button className="link version-action" onClick={() => desktop.checkForUpdates()}>
      Check for updates
    </button>
  );
  switch (status.state) {
    case "ready":
      return (
        <>
          {" · "}
          <button className="link version-action" onClick={() => desktop.installUpdate()}>
            Restart to update to {status.version}
          </button>
        </>
      );
    case "latest":
      return <> · Up to date · {check}</>;
    case "error":
      return (
        <>
          <span title={status.message}> · Couldn't check for updates</span> · {check}
        </>
      );
    case "available":
      return (
        <>
          {" · "}
          <button className="link version-action" onClick={() => void desktop.openDownload()}>
            Download Zion PDF {status.version}
          </button>
        </>
      );
    case "idle":
      return <> · {check}</>;
    default:
      return <> · {updateSummary(status)}</>;
  }
}

interface Props {
  onPick: () => void;
  onOpenUrl: () => void;
  onOpenBytes: (name: string, data: Uint8Array, password?:string, sourceId?:string, replace?:boolean, sourceKey?:string) => void;
  onError: (message: string) => void;
  onCompose: (mode:"images"|"merge") => void;
  loading: boolean;
}

export function Welcome({ onPick, onOpenUrl, onOpenBytes, onError, onCompose, loading }: Props) {
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [version, setVersion] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const createRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!createOpen) return;
    const outside = (event: MouseEvent) => { if (!createRef.current?.contains(event.target as Node)) setCreateOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setCreateOpen(false); createRef.current?.querySelector<HTMLButtonElement>(".create-trigger")?.focus(); } };
    window.addEventListener("mousedown", outside);
    window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("mousedown", outside); window.removeEventListener("keydown", escape, true); };
  }, [createOpen]);

  const [update, setUpdate] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    window.zionpdfDesktop?.getAppInfo().then((info) => setVersion(info.version)).catch(() => {});
    return window.zionpdfDesktop?.onUpdateStatus?.(setUpdate);
  }, []);

  useEffect(() => {
    listRecent().then(setRecent);
  }, []);

  // A stored blob that can't be read back is dead weight: drop the entry so it doesn't keep failing.
  const reopen = async (f: RecentFile) => {
    try {
      const opened=await recentDocument(f);onOpenBytes(opened.name,opened.data,undefined,opened.sourceId,false,opened.sourceKey);if("note" in opened&&opened.note)onError(opened.note);
    } catch {
      await forget(f.id);
      onError(`Couldn't reopen “${f.name}”. It was removed from Recent.`);
    }
  };

  const forget = async (id: string) => {
    await removeRecent(id);
    setRecent((r) => r.filter((f) => f.id !== id));
  };

  return (
    <div className={`welcome${recent.length ? " has-recents" : ""}`}>
      <div className="welcome-inner">
        {!recent.length && <div className="hero">
          <h1>Read beautifully.</h1>
          <p>A calm, fast PDF reader. Your files never leave this device.</p>
        </div>}

        <div className="library-actions">
        <button className="dropzone" onClick={onPick} disabled={loading}>
          <div className="dropzone-icon">
            <Icon name={loading ? "file" : "upload"} size={26} />
          </div>
          <div className="dropzone-text">
            <strong>{loading ? "Opening…" : "Open a PDF"}</strong>
          </div>
          <kbd>{keys("Ctrl O")}</kbd>
        </button>

        <div className="welcome-links">
          <button className="link" onClick={onOpenUrl} disabled={loading}>
            <Icon name="link" size={15} /> Open from URL
          </button>
        </div>
        <div className="library-create-actions" ref={createRef}>
          <button className="btn ghost create-trigger" disabled={loading} aria-haspopup="menu" aria-expanded={createOpen} onClick={()=>setCreateOpen(value=>!value)}><Icon name="plus" size={17}/> Create <Icon name="chevronDown" size={14}/></button>
          {createOpen && <div className="menu dropdown create-menu" role="menu" onKeyDown={event=>{if(event.key!=="ArrowDown"&&event.key!=="ArrowUp")return;event.preventDefault();const items=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));const index=items.indexOf(document.activeElement as HTMLButtonElement);items[(index+(event.key==="ArrowDown"?1:items.length-1))%items.length]?.focus();}}>
            <button role="menuitem" onClick={()=>{setCreateOpen(false);onCompose("images");}}><Icon name="image" size={17}/> Create PDF from images</button>
            <button role="menuitem" onClick={()=>{setCreateOpen(false);onCompose("merge");}}><Icon name="merge" size={17}/> Merge PDFs</button>
          </div>}
        </div>
        </div>

        {recent.length > 0 && (
          <section className="recent">
            <div className="recent-head">
              <h3>Recent</h3>
              <button
                className="link"
                onClick={async () => {
                  if (!confirm("Remove all recent files from Zion PDF? The original files aren't affected.")) return;
                  await clearRecent();
                  setRecent([]);
                }}
              >
                Clear all
              </button>
            </div>
            <div className="recent-grid">
              {recent.map((f) => (
                <div key={f.id} className="recent-card" onClick={() => void reopen(f)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && void reopen(f)}>
                  <div className="recent-thumb">
                    {f.thumb ? <img src={f.thumb} alt="" /> : <Icon name="file" size={28} />}
                    {f.lastPage > 1 && (
                      <span className="recent-progress" style={{ width: `${(f.lastPage / f.pages) * 100}%` }} />
                    )}
                  </div>
                  <div className="recent-meta">
                    <strong title={f.name}>{f.name.replace(/\.pdf$/i, "")}</strong>
                    <span>
                      {timeAgo(f.openedAt)} · Page {f.lastPage || 1} of {f.pages} · {formatBytes(f.size)}
                    </span>
                  </div>
                  <button
                    className="recent-remove"
                    title="Remove from recent"
                    onClick={(e) => {
                      e.stopPropagation();
                      forget(f.id);
                    }}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {version && (
          <p className="version">
            Zion PDF {version}
            {update && <UpdateLine status={update} />}
          </p>
        )}
      </div>
    </div>
  );
}
