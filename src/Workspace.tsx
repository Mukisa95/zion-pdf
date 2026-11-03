import { useCallback, useEffect, useRef, useState } from "react";
import App from "./App";
import { Icon } from "./icons";
import { keys } from "./platform";
import { contentKey } from "./recent";
export interface DocumentRequest { name: string; data: Uint8Array;sourceId?:string;sourceKey?:string }
type Tab = { id: string; name: string; dirty: boolean; request?: DocumentRequest; initial?: boolean };
export default function Workspace() {
  const [tabs, setTabs] = useState<Tab[]>([{id:"initial",name:"Library",dirty:false,initial:true}]);
  const [active, setActive] = useState("initial");
  const guards = useRef(new Map<string, () => boolean>());
  const documents = useRef(new Map<string, string>());
  const identify = useCallback(async (id: string, request: DocumentRequest, claim: boolean) => {
    const key = request.sourceKey ? `source:${request.sourceKey}` : `content:${request.name}:${await contentKey(request.data)}`;
    const existing = [...documents.current].find(([, value]) => value === key)?.[0];
    if (existing) { setActive(existing); return true; }
    if (claim) documents.current.set(id, key);
    return false;
  }, []);
  const open = useCallback((request?: DocumentRequest) => {
    const id = crypto.randomUUID();
    setTabs(previous => [...previous,{id,name:request?.name || "Library",dirty:false,request}]); setActive(id);
  }, []);
  const close = (id: string) => {
    if (guards.current.get(id)?.() === false) return;
    guards.current.delete(id);
    documents.current.delete(id);
    const index = tabs.findIndex(tab => tab.id === id), next = tabs.filter(tab => tab.id !== id);
    if (!next.length) { const id = crypto.randomUUID(); next.push({id,name:"Library",dirty:false}); }
    setTabs(next); if (active === id) setActive(next[Math.min(index,next.length-1)].id);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if(document.querySelector('.document-panel:not([hidden]) .modal-backdrop'))return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "t") { event.preventDefault(); event.stopImmediatePropagation(); open(); }
      else if (event.key.toLowerCase() === "w") { event.preventDefault(); event.stopImmediatePropagation(); close(active); }
      else if (event.key === "Tab") { event.preventDefault(); event.stopImmediatePropagation(); const index = tabs.findIndex(tab => tab.id === active); setActive(tabs[(index+(event.shiftKey ? tabs.length-1 : 1))%tabs.length].id); }
    };
    window.addEventListener("keydown",key,true); return () => window.removeEventListener("keydown",key,true);
  });
  return <div className="workspace">
    <header className="document-tabs">
      <button className="brand" title="New library tab" onClick={() => open()}><img className="brand-mark" src={`${import.meta.env.BASE_URL}app-icon.png`} alt=""/><span className="brand-name">Zion PDF</span></button>
      <div className="document-tab-list" role="tablist" aria-label="Open documents" onKeyDown={event=>{
        if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
        event.preventDefault(); const index=tabs.findIndex(tab=>tab.id===active);
        const next=event.key==="Home"?0:event.key==="End"?tabs.length-1:(index+(event.key==="ArrowLeft"?tabs.length-1:1))%tabs.length;
        setActive(tabs[next].id); document.getElementById(`tab-${tabs[next].id}`)?.focus();
      }}>
        {tabs.map(tab => <div className={`document-tab ${tab.id === active ? "on" : ""}`} key={tab.id}>
          <button role="tab" aria-label={tab.name.replace(/\.pdf$/i,"")} aria-description={tab.dirty ? "Unsaved changes" : undefined} id={`tab-${tab.id}`} tabIndex={tab.id === active ? 0 : -1} aria-selected={tab.id === active} aria-controls={`panel-${tab.id}`} title={tab.name} onClick={() => setActive(tab.id)}>{tab.name.replace(/\.pdf$/i,"")}{tab.dirty && <span className="dirty-dot" title="Unsaved changes"/>}</button>
          <button className="document-tab-close" aria-label={`Close ${tab.name}`} onClick={() => close(tab.id)}><Icon name="close" size={13}/></button>
        </div>)}
      </div>
      <button className="new-document-tab" title={keys("New tab (Ctrl+T)")} aria-label="New tab" onClick={() => open()}><Icon name="plus" size={16}/></button>
    </header>
    <div className="document-panels">{tabs.map(tab => <div key={tab.id} id={`panel-${tab.id}`} role="tabpanel" aria-labelledby={`tab-${tab.id}`} className="document-panel" hidden={tab.id !== active} inert={tab.id !== active}>
      <App active={tab.id === active} request={tab.request} restoreSession={!!tab.initial} onNewDocument={open}
        onIdentifyDocument={(request,claim) => identify(tab.id,request,claim)} onReleaseDocument={() => documents.current.delete(tab.id)}
        onTabState={(name,dirty) => setTabs(previous => previous.map(item => item.id !== tab.id || item.name === name && item.dirty === dirty ? item : {...item,name,dirty,request:undefined}))}
        onCanClose={guard => { if (guard) guards.current.set(tab.id,guard); else guards.current.delete(tab.id); }}/>
    </div>)}</div>
  </div>;
}
