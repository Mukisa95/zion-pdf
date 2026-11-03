interface UpdateStatus {
  state: "idle" | "unsupported" | "checking" | "latest" | "available" | "downloading" | "ready" | "error";
  version?: string;
  percent?: number;
  message?: string;
  checkedAt?: number;
}

// Present only when Zion PDF runs as the desktop app (see electron/preload.cjs).
interface ZionPdfDesktop {
  /** `note` says where a converted Word document's PDF was saved. */
  onOpenFile(callback: (name: string, data: Uint8Array, note?: string, sourceId?:string, sourceKey?:string) => void): () => void;
  onConverting(callback: (name: string) => void): () => void;
  onOpenFailed(callback: (message: string) => void): () => void;
  /** Converts a Word document (.doc, .docx) to PDF; the result arrives through onOpenFile. */
  openDocument(file: File): Promise<void>;
  pickEditorImage(): Promise<{ name: string; data: Uint8Array } | null>;
  ready(): Promise<boolean>;
  fetchPdf(url: string): Promise<{ name: string; data: Uint8Array }>;
  getAppInfo(): Promise<{ version: string; mode: "development" | "portable" | "installed" | "appimage" | "package"; location: string; platform: string;
    /** True when updates are announced with a download link instead of installed (unsigned macOS builds). */
    notifyOnly: boolean }>;
  saveEditedCopy(name: string, data: Uint8Array): Promise<{ saved: boolean;sourceId?:string;sourceKey?:string;name?:string }>;
  openPdfFile(file:File):Promise<{name:string;data:Uint8Array;sourceId:string;sourceKey:string}>;
  reopenPdfSource(sourceId:string):Promise<{name:string;data:Uint8Array;sourceId:string;sourceKey:string}>;
  savePdf(sourceId:string,data:Uint8Array):Promise<{saved:boolean;sourceId:string;name:string}>;
  exportFile(name:string,extension:string,data:Uint8Array):Promise<{saved:boolean}>;
  wordStructure(id:string,data:Uint8Array,options:{pages:number[];password?:string}):Promise<import("./exportWordSemantic").SemanticDocument>;
  cancelWord(id:string):Promise<void>;
  onWordProgress(callback:(event:{id:string;progress:number;message:string})=>void):()=>void;
  /** "win32", "darwin", or "linux". */
  platform: string;
  /** Opens the releases page (macOS, where updates are downloaded manually). */
  openDownload(): Promise<void>;
  openInstallation(): Promise<string>;
  setTheme(theme: string): void;
  installUpdate(): void;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  checkForUpdates(): void;
  getAutoUpdateEnabled(): Promise<boolean>;
  setAutoUpdateEnabled(enabled: boolean): Promise<boolean>;
  ai: ZionPdfAi;
}

interface AiStatus {
  chatgpt: { connected: boolean; email: string; name: string; welcomeSeen: boolean; encrypted: boolean };
  claude: { installed: boolean; loggedIn: boolean; version?: string; subscription?: boolean; authMethod?: string };
}

interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

interface AiEvent {
  id: string;
  type: "delta" | "done" | "error";
  text?: string;
  message?: string;
  code?: string;
  link?: string;
}

interface ZionPdfAi {
  status(): Promise<AiStatus>;
  signInChatGPT(): Promise<{ ok: boolean; status?: AiStatus["chatgpt"]; error?: string }>;
  signOutChatGPT(): Promise<AiStatus["chatgpt"]>;
  chatgptWelcomeSeen(): Promise<boolean>;
  chatgptModels(): Promise<{ ok: boolean; models?: { id: string; name: string }[]; error?: string; code?: string }>;
  recheckClaude(): Promise<AiStatus["claude"]>;
  ask(request: { id: string; provider: "chatgpt" | "claude"; model: string; instructions: string; messages: AiMessage[] }): Promise<boolean>;
  cancel(id: string): Promise<boolean>;
  onEvent(callback: (event: AiEvent) => void): () => void;
}

interface Window {
  zionpdfDesktop?: ZionPdfDesktop;
}
