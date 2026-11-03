// Minimal bridge between the Zion PDF page and the desktop shell.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("zionpdfDesktop", {
  /** Called with (name, data, note?) whenever a PDF is opened from Explorer, or a Word document has been converted. */
  onOpenFile(callback) {
    const listener = (_e, file) => callback(file.name, new Uint8Array(file.data), file.note ?? undefined, file.sourceId, file.sourceKey);
    ipcRenderer.on("zionpdf:open-file", listener);
    return () => ipcRenderer.removeListener("zionpdf:open-file", listener);
  },
  /** Called with the file name when a Word document starts converting, and with a message if it fails. */
  onConverting(callback) {
    const listener = (_e, file) => callback(file.name);
    ipcRenderer.on("zionpdf:converting", listener);
    return () => ipcRenderer.removeListener("zionpdf:converting", listener);
  },
  onOpenFailed(callback) {
    const listener = (_e, failure) => callback(failure.message);
    ipcRenderer.on("zionpdf:open-failed", listener);
    return () => ipcRenderer.removeListener("zionpdf:open-failed", listener);
  },
  /** Converts a picked or dropped Word document; it arrives through onOpenFile. */
  openDocument: (file) => ipcRenderer.invoke("zionpdf:open-document", webUtils.getPathForFile(file)),
  pickEditorImage: () => ipcRenderer.invoke("zionpdf:pick-editor-image"),
  ready: () => ipcRenderer.invoke("zionpdf:ready"),
  platform: process.platform,
  openDownload: () => ipcRenderer.invoke("zionpdf:open-download"),
  /** Downloads a PDF from an http(s) link; resolves to { name, data: Uint8Array }. */
  async fetchPdf(url) {
    const file = await ipcRenderer.invoke("zionpdf:fetch-pdf", url);
    if (file.error) throw new Error(file.error);
    return { name: file.name, data: new Uint8Array(file.data) };
  },
  getAppInfo: () => ipcRenderer.invoke("zionpdf:app-info"),
  saveEditedCopy: (name, data) => ipcRenderer.invoke("zionpdf:save-edited-copy", name, data),
  openPdfFile: async file => {const opened=await ipcRenderer.invoke("zionpdf:open-pdf-file",webUtils.getPathForFile(file));return {...opened,data:new Uint8Array(opened.data)};},
  reopenPdfSource: async sourceId => {const opened=await ipcRenderer.invoke("zionpdf:reopen-pdf-source",sourceId);return {...opened,data:new Uint8Array(opened.data)};},
  savePdf: (sourceId,data) => ipcRenderer.invoke("zionpdf:save-pdf",sourceId,data),
  exportFile: (name,extension,data) => ipcRenderer.invoke("zionpdf:export-file",name,extension,data),
  wordStructure: (id,data,options) => ipcRenderer.invoke("zionpdf:word-structure",id,data,options),
  cancelWord: id => ipcRenderer.invoke("zionpdf:cancel-word",id),
  onWordProgress(callback) {
    const listener=(_event,event)=>callback(event);
    ipcRenderer.on("zionpdf:word-progress",listener);
    return ()=>ipcRenderer.removeListener("zionpdf:word-progress",listener);
  },
  openInstallation: () => ipcRenderer.invoke("zionpdf:open-installation"),
  setTheme: (theme) => ipcRenderer.send("zionpdf:theme", theme),
  installUpdate: () => ipcRenderer.send("zionpdf:install-update"),
  /** Called with the updater state ({ state, version?, percent?, message? }) now and whenever it changes. */
  onUpdateStatus(callback) {
    const listener = (_e, status) => callback(status);
    ipcRenderer.on("zionpdf:update-status-changed", listener);
    ipcRenderer.invoke("zionpdf:update-state").then(callback);
    return () => ipcRenderer.removeListener("zionpdf:update-status-changed", listener);
  },
  checkForUpdates: () => ipcRenderer.send("zionpdf:check-update"),
  getAutoUpdateEnabled: () => ipcRenderer.invoke("zionpdf:auto-update-setting"),
  setAutoUpdateEnabled: (enabled) => ipcRenderer.invoke("zionpdf:set-auto-update-setting", enabled),
  ai: {
    status: () => ipcRenderer.invoke("zionpdf:ai-status"),
    signInChatGPT: () => ipcRenderer.invoke("zionpdf:ai-chatgpt-signin"),
    signOutChatGPT: () => ipcRenderer.invoke("zionpdf:ai-chatgpt-signout"),
    chatgptWelcomeSeen: () => ipcRenderer.invoke("zionpdf:ai-chatgpt-welcome-seen"),
    chatgptModels: () => ipcRenderer.invoke("zionpdf:ai-chatgpt-models"),
    recheckClaude: () => ipcRenderer.invoke("zionpdf:ai-claude-recheck"),
    ask: (request) => ipcRenderer.invoke("zionpdf:ai-ask", request),
    cancel: (id) => ipcRenderer.invoke("zionpdf:ai-cancel", id),
    /** Called with { id, type: "delta" | "done" | "error", text?, message?, code?, link? } for every answer. */
    onEvent(callback) {
      const listener = (_e, event) => callback(event);
      ipcRenderer.on("zionpdf:ai-event", listener);
      return () => ipcRenderer.removeListener("zionpdf:ai-event", listener);
    },
  },
});
