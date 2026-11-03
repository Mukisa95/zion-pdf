const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {pdfBytes} = require('./documents.cjs');

// No shell, system Python, Office automation or network services are used by this converter.
class WordConverter {
  constructor({root, packaged = false}) { this.root = root; this.packaged = packaged; this.jobs = new Map(); }
  async convert(owner, id, data, options, progress) {
    if (typeof id !== 'string' || !/^[a-z0-9-]{8,80}$/i.test(id) || this.jobs.has(id)) throw new Error('Invalid conversion job.');
    const bytes = pdfBytes(data);
    if (!options || !Array.isArray(options.pages) || !options.pages.length || options.pages.length > 10000 || options.pages.some(p => !Number.isInteger(p) || p < 1 || p > 10000) || new Set(options.pages).size !== options.pages.length) throw new Error('Choose valid pages to export.');
    if (options.password != null && (typeof options.password !== 'string' || options.password.length > 1024)) throw new Error('Invalid PDF password.');
    const executable = path.join(this.root, 'zion-converter', process.platform === 'win32' ? 'zion-converter.exe' : 'zion-converter');
    if(this.jobs.size)throw new Error('Finish or cancel the current Word export before starting another.');
    let finish;
    const job = {owner, canceled:false, child:null, done:new Promise(resolve=>{finish=resolve;})}; this.jobs.set(id, job);
    let directory;
    try {
      await fs.access(executable).catch(() => { throw new Error('The offline Word converter is missing. Reinstall the complete Zion PDF application.'); });
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zion-word-'));
      await fs.writeFile(path.join(directory, 'input.pdf'), bytes, {mode:0o600});
      await fs.writeFile(path.join(directory, 'request.json'), JSON.stringify(options), {mode:0o600});
      if (job.canceled) throw new Error('Export canceled.');
      await new Promise((resolve, reject) => {
        const child = job.child = spawn(executable, [directory, path.join(this.root, 'models')], {windowsHide:true, stdio:['ignore','pipe','pipe'], env:{...process.env, HF_HUB_OFFLINE:'1', TRANSFORMERS_OFFLINE:'1', DO_NOT_TRACK:'1', TOKENIZERS_PARALLELISM:'false', OMP_NUM_THREADS:'4', MKL_NUM_THREADS:'4', PYTHONUTF8:'1'}});
        let pending = '', errors = '', timedOut = false;
        const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 30 * 60 * 1000);
        child.stdout.on('data', chunk => {
          pending += chunk.toString('utf8');
          if (pending.length > 1024 * 1024) { child.kill(); return reject(new Error('Invalid converter response.')); }
          let end; while ((end = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0,end); pending = pending.slice(end+1);
            try { const event = JSON.parse(line); if (Number.isFinite(event.progress) && typeof event.message === 'string') progress({id, progress:Math.max(0,Math.min(1,event.progress)), message:event.message.slice(0,200)}); } catch {}
          }
        });
        child.stderr.on('data', chunk => { errors = (errors + chunk.toString('utf8')).slice(-8000); });
        child.once('error', error => {clearTimeout(timeout); reject(error);});
        child.once('close', code => {clearTimeout(timeout); if (job.canceled) reject(new Error('Export canceled.')); else if(timedOut)reject(new Error('Word conversion timed out. Try a smaller page range.')); else if (code) reject(new Error('Could not reconstruct this document. ' + (errors.split('\n').findLast(line => line.startsWith('ZION_ERROR:'))?.slice(11,600) || 'Try a smaller page range.'))); else resolve();});
      });
      if (job.canceled) throw new Error('Export canceled.');
      const file = path.join(directory, 'structure.json'), stat = await fs.stat(file);
      if (stat.size > 100 * 1024 * 1024) throw new Error('The converted document is too large. Export fewer pages.');
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } finally {try{if(directory)await fs.rm(directory, {recursive:true, force:true,maxRetries:6,retryDelay:200});}finally{this.jobs.delete(id);finish();}}
  }
  cancel(owner, id) { const job = this.jobs.get(id); if (job?.owner === owner) {job.canceled = true; job.child?.kill();} }
  cancelOwner(owner) { for (const [id,job] of this.jobs) if (job.owner === owner) this.cancel(owner,id); }
  close() { const done=[...this.jobs.values()].map(job=>job.done);for (const [id,job] of this.jobs) this.cancel(job.owner,id);return Promise.all(done); }
}
module.exports = {WordConverter};
