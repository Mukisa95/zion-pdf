import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import converterModule from '../electron/word-converter.cjs';
const root=path.resolve(import.meta.dirname,'..'),converter=new converterModule.WordConverter({root:path.join(root,'conversion/runtime',`${process.platform}-${process.arch}`)}),owner={},data=new Uint8Array(readFileSync(path.join(root,'release/smoke/word-layout/source.pdf')));
let started;
const ready=new Promise(resolve=>{started=resolve;});
const job=converter.convert(owner,randomUUID(),data,{pages:[1]},event=>{if(event.message.startsWith('Understanding page'))started();});
// Attach the rejection check before canceling; cleanup is part of the promise's completion.
const rejected=assert.rejects(job,/Export canceled/);
await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Converter did not start')),90000).unref())]);
await converter.close();await rejected;assert.equal(converter.jobs.size,0);
console.log('PASS: closing during bundled inference cancels the native helper and waits for temporary-file cleanup.');
