import {_electron as electron} from 'playwright-core';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..'),temp=mkdtempSync(path.join(tmpdir(),'zion-toolbar-'));
const env={...process.env,ZIONPDF_TEST_HIDDEN:'1',ZIONPDF_TEST_USER_DATA:path.join(temp,'profile')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[root,path.join(root,'public/sample.pdf'),...(process.platform==='linux'&&process.getuid?.()===0?['--no-sandbox']:[])],env,timeout:60000});
try {
 const page=await app.firstWindow(),scope=page.locator('.document-panel:not([hidden])'),right=scope.locator('.topbar-right');await scope.locator('.textLayer span').first().waitFor({timeout:30000});
 const labels=await right.locator(':scope > button, :scope > .more > button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')));
 const info=labels.indexOf('Document info');assert.ok(info>0&&labels[info-1].startsWith('Search')&&labels[info+1]==='Save'&&labels[info+2].startsWith('Print')&&labels[info+3]==='Focus mode');
 await right.getByRole('button',{name:'Save',exact:true}).click();const saveMenu=right.getByRole('menu',{name:'Save'});assert.deepEqual(await saveMenu.locator('.menu-label').allTextContents(),['Save','Save a copy','Export']);
 await page.keyboard.press('Escape');await right.getByRole('button',{name:'Document info'}).click();await scope.getByRole('dialog',{name:'Document info'}).waitFor();await page.keyboard.press('Escape');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(520,300));await right.getByRole('button',{name:'More',exact:true}).click();const more=right.getByRole('menu',{name:'More'});await more.waitFor();
 const dim=await more.evaluate(e=>({height:e.clientHeight,scroll:e.scrollHeight,bottom:e.getBoundingClientRect().bottom,window:innerHeight}));assert.ok(dim.scroll>dim.height && dim.bottom<=dim.window,'More must scroll within a short window');
 for(const name of ['Search','Save','Save a copy','Export','Print','Document info','Focus mode'])assert.equal(await more.getByRole('menuitem',{name,exact:true}).count(),0);
 await more.getByRole('menuitem',{name:'About Zion PDF'}).scrollIntoViewIfNeeded();await more.getByRole('menuitem',{name:'About Zion PDF'}).click();await scope.getByRole('dialog',{name:'About Zion PDF'}).waitFor();await page.keyboard.press('Escape');
 mkdirSync(path.join(root,'release/smoke'),{recursive:true});await page.screenshot({path:path.join(root,'release/smoke/toolbar-short.png')});
 console.log('PASS: toolbar order, Save menu, document info, uncluttered More menu and scrolling in a short window');
} finally {await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>{});await app.close();}
function expectText(label){return label + (process.platform==='darwin' ? (label==='Save'?'⌘S':'⌘⇧S') : (label==='Save'?'Ctrl S':'Ctrl Shift S'));}
