import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),build=path.join(root,'.converter-build'),runtime=path.join(root,'conversion/runtime',`${process.platform}-${process.arch}`);
const python=process.env.ZIONPDF_BUILD_PYTHON || (process.platform==='win32'?'python':'python3');
const venv=path.join(build,'venv'),py=path.join(venv,process.platform==='win32'?'Scripts/python.exe':'bin/python');
const run=(exe,args)=>new Promise((resolve,reject)=>{const child=spawn(exe,args,{cwd:root,stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('exit',code=>code?reject(new Error(`${path.basename(exe)} exited ${code}`)):resolve());});
mkdirSync(build,{recursive:true});mkdirSync(runtime,{recursive:true});
if(!existsSync(py))await run(python,['-m','venv',venv]);
if(!process.argv.includes('--reuse-dependencies')){
  // Intel macOS wheels ended with Torch 2.2.2; keep that architecture supported.
  const intelMac=process.platform==='darwin'&&process.arch==='x64';
  await run(py,['-m','pip','install',...(intelMac?['torch==2.2.2','torchvision==0.17.2','numpy==1.26.4']:['torch==2.15.0','torchvision==0.29.2']),...(process.platform==='darwin'?[]:['--index-url','https://download.pytorch.org/whl/cpu'])]);
  await run(py,['-m','pip','install','-r','conversion/requirements.txt',...(intelMac?['transformers==4.57.6','numpy==1.26.4','pandas==2.3.3','scipy==1.16.3','opencv-python-headless==4.11.0.86']:[])]);
}
await run(py,['conversion/download_models.py',path.join(runtime,'models')]);
if(!process.argv.includes('--refresh-data'))await run(py,['-m','PyInstaller','--noconfirm',...(process.argv.includes('--incremental')?[]:['--clean']),'--onedir','--name','zion-converter','--distpath',runtime,'--workpath',path.join(build,'pyinstaller'),'--specpath',build,
  '--collect-all','docling','--collect-all','docling_core','--collect-all','docling_ibm_models','--collect-all','docling_parse','--collect-all','transformers','--collect-all','timm',
  '--copy-metadata','docling-slim','--copy-metadata','docling','--copy-metadata','transformers','--copy-metadata','torch','--copy-metadata','torchvision',
  '--exclude-module','matplotlib','--exclude-module','tkinter','--exclude-module','pytest','conversion/structure.py']);
await run(py,['conversion/bundle_data.py',path.join(runtime,'zion-converter','_internal')]);
await run(py,['conversion/licenses.py',path.join(runtime,'licenses')]);
const files=[];
function walk(folder){for(const entry of readdirSync(folder)){if(entry==='.cache'||entry==='manifest.json')continue;const file=path.join(folder,entry);if(statSync(file).isDirectory())walk(file);else files.push({path:path.relative(runtime,file).replaceAll('\\','/'),bytes:statSync(file).size,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')});}}
walk(runtime);writeFileSync(path.join(runtime,'manifest.json'),JSON.stringify({engine:'Docling 2.145.0',platform:process.platform,arch:process.arch,files},null,2));
console.log(`Offline converter built at ${runtime}`);
