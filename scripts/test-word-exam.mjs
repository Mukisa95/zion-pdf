import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {_electron as electron} from 'playwright-core';
import {unzipSync,strFromU8} from 'fflate';

// The exam is supplied locally, not checked into the repository.
const source=path.resolve(process.argv[2]||''),root=path.resolve(import.meta.dirname,'..'),temp=mkdtempSync(path.join(tmpdir(),'zion-word-exam-'));
const original=readFileSync(source),out=path.join(root,'release/smoke/word-exam');mkdirSync(out,{recursive:true});
const env={...process.env,ZIONPDF_TEST_HIDDEN:'1',ZIONPDF_TEST_USER_DATA:path.join(temp,'profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[root,source,...(process.platform==='linux'&&process.getuid?.()===0?['--no-sandbox']:[])],env,timeout:60000});
try{
 const page=await app.firstWindow(),scope=page.locator('.document-panel:not([hidden])');await scope.locator('.textLayer span').first().waitFor({timeout:60000});
 // Optional saved recognition result makes geometry iterations reproducible. Omit it for the full offline pipeline.
 if(process.argv[3])await app.evaluate(({ipcMain},structure)=>{ipcMain.removeHandler('zionpdf:word-structure');ipcMain.handle('zionpdf:word-structure',()=>structure);},JSON.parse(readFileSync(process.argv[3],'utf8')));
 await scope.getByRole('button',{name:'More',exact:true}).click();await scope.getByRole('menuitem',{name:'Export',exact:true}).click();
 const dialog=scope.getByRole('dialog',{name:'Export PDF',exact:true});await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path.join(out,'improved.docx'));
 await dialog.getByRole('button',{name:'Export',exact:true}).click();await Promise.race([dialog.waitFor({state:'hidden',timeout:300000}),dialog.getByRole('alert').waitFor({timeout:300000}).then(async()=>{throw new Error(await dialog.getByRole('alert').innerText());})]);
 const zip=unzipSync(readFileSync(path.join(out,'improved.docx'))),xml=strFromU8(zip['word/document.xml']);
 assert.doesNotMatch(xml,/w:txbxContent|wps:txbx|<w:numPr/,'Do not invent bullets or drawing text boxes');
 assert.equal((xml.match(/<w:sectPr[ >]/g)||[]).length,9);
 assert.ok((xml.match(/<w:tbl[ >]/g)||[]).length>=2,'Examiner and timetable must be native tables');
 assert.match(xml,/w:gridSpan/,'Merged table headings must remain merged');
 const paragraphs=[...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(m=>m[0].replace(/<[^>]*>/g,''));
 assert.ok(paragraphs.some(p=>/33\./.test(p)&&p.includes('Immediately we saw the accident')),'Question 33 must retain its label');
 assert.ok(!paragraphs.some(p=>p.includes('Answer all Answer all')),'Do not duplicate extraction fragments');
 assert.ok([...xml.matchAll(/<w:tc[ >][\s\S]*?<\/w:tc>/g)].some(m=>m[0].includes('Soroti 4.00am')&&m[0].includes('Kumi 5.45 am')),'Timetable entries must remain together');
 assert.ok([...xml.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)].some(m=>m[0].includes('(offloading goods)')&&m[0].includes('w:sz w:val="24"')),'The smaller 12-point text must retain its size');
 assert.match(xml,/<w:position /,'Raised date suffixes must retain their position without creating extra lines');
 assert.deepEqual(readFileSync(source),original);
 console.log(`PASS: editable native tables, merged cells, correct question labels, no invented bullets or duplicate instructions. Output: ${out}`);
}finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>{});await app.close();}
