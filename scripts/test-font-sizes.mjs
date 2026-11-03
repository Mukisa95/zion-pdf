import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
import {init} from '@embedpdf/pdfium';import {PDFDocument,PDFOperator,StandardFonts} from 'pdf-lib';
import {_electron as electron} from 'playwright-core';
import {inspectEditableText,writeTextCell,previewTextCell,renderTextPreview} from '../src/editor/textCells.ts';
import {validFontSize} from '../src/editor/fonts.ts';
const root=path.resolve(import.meta.dirname,'..'),api=await init({wasmBinary:readFileSync(path.join(root,'node_modules/@embedpdf/pdfium/dist/pdfium.wasm'))});api.PDFiumExt_Init();
const close=(actual,wanted)=>assert.ok(Math.abs(actual-wanted)<.002,`${actual} should equal ${wanted}`);
async function fixture(scale){const doc=await PDFDocument.create(),page=doc.addPage([600,500]),font=await doc.embedFont(StandardFonts.Helvetica);page.pushOperators(PDFOperator.of(`q ${scale} 0 0 ${scale} 40 330 cm`));page.drawText('Before after',{x:0,y:0,size:40/scale,font});page.pushOperators(PDFOperator.of('Q'));return doc.save();}
for(const scale of [40,.04,1]){
 const source=await fixture(scale),target=inspectEditableText(api,source,0)[0];close(target.fontSize*target.fontScale,40);
 const raw=22.5/target.fontScale;
 const preview=previewTextCell(api,source,0,target,target.text,undefined,undefined,{fontSize:raw},undefined,600,500,0);assert.ok(preview.carets);
 const result=writeTextCell(api,source,0,target,target.text,undefined,undefined,{fontSize:raw}),changed=inspectEditableText(api,result.bytes,0).find(t=>t.cell?.id===result.cellId);close(changed.fontSize*changed.fontScale,22.5);assert.deepEqual(preview.pixels,renderTextPreview(api,result.bytes,0,600,500,0));
 const again=writeTextCell(api,result.bytes,0,changed,changed.text,undefined,undefined,{...changed.cell.format,color:'#123456'}),reopened=inspectEditableText(api,again.bytes,0).find(t=>t.cell?.id===again.cellId);close(reopened.fontSize*reopened.fontScale,22.5);
 const runs=[{start:0,end:6,fontSize:raw}];const rich=writeTextCell(api,source,0,target,target.text,undefined,undefined,{runs}),richCell=inspectEditableText(api,rich.bytes,0).find(t=>t.cell?.id===rich.cellId);close(richCell.members[0].fontSize*richCell.members[0].fontScale,22.5);close(richCell.members.at(-1).fontSize*richCell.members.at(-1).fontScale,40);
 for(const points of [1,300]){assert.ok(validFontSize(points/target.fontScale,target.fontScale));writeTextCell(api,source,0,target,target.text,undefined,undefined,{fontSize:points/target.fontScale});}
 for(const points of [0,.5,300.5,NaN,Infinity]){
  assert.throws(()=>writeTextCell(api,source,0,target,target.text,undefined,undefined,{fontSize:points/target.fontScale}),/font size/);
  assert.throws(()=>writeTextCell(api,source,0,target,target.text,undefined,undefined,{runs:[{start:0,end:6,fontSize:points/target.fontScale}]}),/character formatting/);
 }
}
console.log('PASS: scaled and unscaled 22.5-point text, live preview, character ranges, saved reopening, later edits and visible-size limits');
const temp=mkdtempSync(path.join(tmpdir(),'zionpdf-font-size-')),source=path.join(temp,'Scaled font.pdf');writeFileSync(source,await fixture(40));
const env={...process.env,ZIONPDF_TEST_HIDDEN:'1',ZIONPDF_TEST_USER_DATA:path.join(temp,'profile')};delete env.ELECTRON_RUN_AS_NODE;
const require=createRequire(import.meta.url),app=await electron.launch({executablePath:require('electron'),args:[root,source,...(process.platform==='linux'&&process.getuid?.()===0?['--no-sandbox']:[])],env,timeout:60000});let page;
try{
 page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(String(e)));const scope=page.locator('.document-panel:not([hidden])');await scope.locator('.textLayer span').first().waitFor();await scope.getByRole('button',{name:'More',exact:true}).click();await scope.getByRole('menuitem',{name:'Edit PDF',exact:true}).click();const panel=scope.getByRole('toolbar',{name:'PDF editor',exact:true});await scope.locator('.inline-pdf-target').first().click();await scope.locator('.inline-text-preview').waitFor();const size=panel.getByLabel('Font size',{exact:true}),input=scope.getByLabel('Edit PDF text on page',{exact:true});close(Number(await size.inputValue()),40);
 await size.fill('22.5');await input.focus();await page.waitForFunction(()=>!document.querySelector('.document-panel:not([hidden]) [data-live-text]'));assert.deepEqual(await panel.getByRole('alert').allTextContents(),[]);close(Number(await size.inputValue()),22.5);
 // Saving commits the current cell and reopening must report its visible size.
 await panel.getByRole('button',{name:'Save',exact:true}).click();await panel.waitFor({state:'hidden',timeout:30000});let saved=inspectEditableText(api,readFileSync(source),0)[0];close(saved.fontSize*saved.fontScale,22.5);
 await scope.getByRole('button',{name:'More',exact:true}).click();await scope.getByRole('menuitem',{name:'Edit PDF',exact:true}).click();await scope.locator('.inline-pdf-target').first().click();await scope.locator('.inline-text-preview').waitFor();close(Number(await size.inputValue()),22.5);
 await input.focus();await input.press('Home');for(let i=0;i<6;i++)await input.press('Shift+ArrowRight');
 await size.fill('');await size.pressSequentially('12.75');assert.equal(await size.inputValue(),'12.75');await input.focus();await page.waitForFunction(()=>!document.querySelector('.document-panel:not([hidden]) [data-live-text]'));assert.deepEqual(await panel.getByRole('alert').allTextContents(),[]);close(Number(await size.inputValue()),12.75);
 await panel.getByRole('button',{name:'Save',exact:true}).click();await panel.waitFor({state:'hidden',timeout:30000});saved=inspectEditableText(api,readFileSync(source),0)[0];close(saved.members[0].fontSize*saved.members[0].fontScale,12.75);close(saved.members.at(-1).fontSize*saved.members.at(-1).fontScale,22.5);assert.deepEqual(errors,[]);
 console.log('PASS: offscreen app accepts 22.5, preserves it on save/reopen, and types 12.75 for one word without resizing the rest');
}finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>{});await app.close();}
