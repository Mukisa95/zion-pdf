import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {_electron as electron} from 'playwright-core';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {unzipSync,strFromU8} from 'fflate';
const source=path.resolve(process.argv[2]||''),root=path.resolve(import.meta.dirname,'..'),temp=mkdtempSync(path.join(tmpdir(),'zion-word-sample-')),data=new Uint8Array(readFileSync(source));
const out=path.join(root,'release/smoke/word-sample');mkdirSync(out,{recursive:true});
const task=getDocument({data:data.slice()}),pdf=await task.promise;let original='';for(let i=1;i<=pdf.numPages;i++)original+=(await(await pdf.getPage(i)).getTextContent()).items.map(item=>item.str||'').join(' ');await task.destroy();
const env={...process.env,ZIONPDF_TEST_HIDDEN:'1',ZIONPDF_TEST_USER_DATA:path.join(temp,'profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[root,source,...(process.platform==='linux'&&process.getuid?.()===0?['--no-sandbox']:[])],env,timeout:60000});let page;
try{
  page=await app.firstWindow();const scope=page.locator('.document-panel:not([hidden])');await scope.locator('.textLayer span').first().waitFor({timeout:60000});await scope.getByRole('button',{name:'More',exact:true}).click();await scope.getByRole('menuitem',{name:'Export',exact:true}).click();const dialog=scope.getByRole('dialog',{name:'Export PDF',exact:true});
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path.join(out,'sample.docx'));
  await dialog.getByRole('button',{name:'Export',exact:true}).click();await Promise.race([dialog.waitFor({state:'hidden',timeout:240000}),dialog.getByRole('alert').waitFor({timeout:240000}).then(async()=>{throw new Error(await dialog.getByRole('alert').innerText());})]);
  const zip=unzipSync(readFileSync(path.join(out,'sample.docx'))),xml=strFromU8(zip['word/document.xml']),text=[...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m=>m[1].replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>')).join(' ').replace(/\s+/g,' ');
  assert.doesNotMatch(xml,/w:txbxContent|wps:txbx/);const words=original.match(/[\p{L}\p{N}]{3,}/gu)||[],retained=words.filter(word=>text.includes(word));assert.ok(retained.length/words.length>.95,`Only ${retained.length} of ${words.length} source words retained`);assert.deepEqual(new Uint8Array(readFileSync(source)),data);
  console.log(`PASS: ${retained.length}/${words.length} readable source words retained in normal Word text; ${Object.keys(zip).filter(p=>p.startsWith('word/media/')).length} pictures. Source PDF unchanged. Output: ${out}`);
}catch(error){console.error(await page?.getByRole('alert').allTextContents());throw error;}finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>{});await app.close();}
