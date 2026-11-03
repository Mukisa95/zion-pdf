const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const MAX_BYTES = 300 * 1024 * 1024;
const digest = data => createHash("sha256").update(data).digest("hex");
function pdfBytes(data) {
  if (!ArrayBuffer.isView(data) || data.byteLength < 5 || data.byteLength > MAX_BYTES) throw new Error("The PDF is invalid or larger than 300 MB.");
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("The file is not a PDF.");
  return bytes;
}
async function atomicWrite(destination, bytes, beforeReplace) {
  const temp = path.join(path.dirname(destination), `.zionpdf-${randomUUID()}.tmp`);
  let handle;
  try {
    const previous = await fs.stat(destination).catch(error => { if (error.code !== "ENOENT") throw error; });
    if (previous && !previous.isFile()) throw new Error("Choose a file, not a folder.");
    handle = await fs.open(temp, "wx", previous ? previous.mode & 0o777 : 0o600);
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    if (beforeReplace) await beforeReplace();
    await fs.rename(temp, destination);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temp).catch(() => {});
  }
}
class DocumentFiles {
  constructor(indexPath) { this.indexPath = indexPath; this.sources = null; this.queue = Promise.resolve(); this.indexQueue=Promise.resolve(); }
  async load() {
    if (this.sources) return;
    this.loading ??= fs.readFile(this.indexPath, "utf8").then(JSON.parse).catch(() => []).then(saved=>{
      this.sources = new Map((Array.isArray(saved) ? saved : []).filter(item => item&&typeof item.id === "string"&&typeof item.path==="string"&&path.isAbsolute(item.path)&&/^[a-f0-9]{64}$/.test(item.hash || "")).slice(-256).map(item => [item.id,item]));
    });await this.loading;
  }
  async persist() {
    const operation=this.indexQueue.catch(()=>{}).then(async()=>{
      while (this.sources.size > 256) this.sources.delete(this.sources.keys().next().value);
      await fs.mkdir(path.dirname(this.indexPath), {recursive:true});
      await atomicWrite(this.indexPath, Buffer.from(JSON.stringify([...this.sources.values()])));
    });this.indexQueue=operation;await operation;
  }
  async remember(filename, data) {
    await this.load(); const file = await fs.realpath(filename), id = randomUUID();
    this.sources.set(id, {id,path:file,hash:digest(data)}); await this.persist().catch(()=>{});
    return {sourceId:id,sourceKey:digest(Buffer.from(process.platform === "win32" ? file.toLowerCase() : file)),name:path.basename(file)};
  }
  async open(filename) {
    if (typeof filename !== "string" || !path.isAbsolute(filename) || !/\.pdf$/i.test(filename)) throw new Error("Choose a PDF file.");
    const stat = await fs.stat(filename); if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("Choose a PDF smaller than 300 MB.");
    const data = pdfBytes(await fs.readFile(filename)); return {...await this.remember(filename,data),data};
  }
  async reopen(sourceId) {
    await this.load(); const source = this.sources.get(sourceId);
    if (!source) throw new Error("The original file connection is unavailable. Open the PDF from its folder again.");
    return this.open(source.path);
  }
  save(sourceId, data) {
    // Serialize writes so two tabs cannot both overwrite a revision they opened earlier.
    const operation = this.queue.catch(() => {}).then(async () => {
      await this.load(); const source = this.sources.get(sourceId), bytes = pdfBytes(data);
      if (!source) throw new Error("The original file connection is unavailable. Use Save a copy or reopen the PDF.");
      const unchanged = async () => {
        const actual = await fs.realpath(source.path).catch(() => null);
        if (actual !== source.path) throw new Error("The original PDF was moved or replaced. Use Save a copy.");
        const stat = await fs.stat(source.path);
        if (stat.size > MAX_BYTES || digest(await fs.readFile(source.path)) !== source.hash) throw new Error("This PDF changed outside this tab. Reopen it or use Save a copy to keep your edits.");
      };
      await unchanged(); await atomicWrite(source.path,bytes,unchanged);
      source.hash = digest(bytes);
      // A settings-disk failure must not report a successful document write as failed.
      await this.persist().catch(() => {});
      return {saved:true,sourceId,name:path.basename(source.path)};
    });
    this.queue = operation; return operation;
  }
}
module.exports = {DocumentFiles,atomicWrite,pdfBytes};
