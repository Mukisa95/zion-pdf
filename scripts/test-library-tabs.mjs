import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {_electron as electron} from 'playwright-core';
const root=path.resolve(import.meta.dirname,'..'), temp=mkdtempSync(path.join(tmpdir(),'zion-library-'));
for(const folder of ['one','two']) { mkdirSync(path.join(temp,folder)); copyFileSync(path.join(root,'public/sample.pdf'),path.join(temp,folder,'Same.pdf')); }
const env={...process.env,ZIONPDF_TEST_HIDDEN:'1',ZIONPDF_TEST_USER_DATA:path.join(temp,'profile')}; delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[root,...(process.platform==='linux'&&process.getuid?.()===0?['--no-sandbox']:[])],env,timeout:60000});
try {
 const page=await app.firstWindow(), scope=page.locator('.document-panel:not([hidden])');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1100,800));
 const create=scope.getByRole('button',{name:'Create',exact:true}); await create.waitFor();
 const buttons=await scope.locator('.library-actions > *').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top)); assert.ok(Math.max(...buttons)-Math.min(...buttons)<12,'library controls should share a row');
 await create.click(); await scope.getByRole('menuitem',{name:'Merge PDFs'}).waitFor(); await page.keyboard.press('Escape'); assert.equal(await create.getAttribute('aria-expanded'),'false');
 const pick=async file=>{ const [chooser]=await Promise.all([page.waitForEvent('filechooser'),scope.getByRole('button',{name:/Open a PDF/}).click()]); await chooser.setFiles(file); };
 await pick(path.join(temp,'one','Same.pdf')); await page.getByRole('tab',{name:'Same',exact:true}).waitFor(); await scope.locator('.page').first().waitFor();
 await page.getByRole('button',{name:'New tab',exact:true}).click(); await pick(path.join(temp,'one','Same.pdf')); await page.waitForFunction(()=>document.querySelectorAll('[role=tab][aria-label="Same"]').length===1&&document.querySelector('[role=tab][aria-label="Same"]').getAttribute('aria-selected')==='true');
 await page.getByRole('button',{name:'New tab',exact:true}).click(); await pick(path.join(temp,'two','Same.pdf')); await page.waitForFunction(()=>document.querySelectorAll('[role=tab][aria-label="Same"]').length===2); await scope.locator('.page').first().waitFor();
 console.log('PASS: compact single-row controls, Create menu and Escape, existing file switches tabs, separate same-name files open independently');
} finally {await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>{}); await app.close();}
