import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';

const tasks=process.argv.slice(2,4).map(file=>getDocument({data:new Uint8Array(readFileSync(file)),standardFontDataUrl:fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url)).replaceAll('\\','/')}));
try{
 const [source,output]=await Promise.all(tasks.map(t=>t.promise));assert.equal(source.numPages,9);assert.equal(output.numPages,source.numPages);
 for(let n=1;n<=source.numPages;n++){
  const [a,b]=await Promise.all([source.getPage(n).then(p=>p.getTextContent()),output.getPage(n).then(p=>p.getTextContent())]);
  const originals=a.items.filter(t=>t.str?.trim().length>20),converted=b.items.filter(t=>t.str?.trim()),errors=[];
  for(const t of originals){const found=converted.find(o=>o.str.trim()===t.str.trim());if(found)errors.push(Math.abs(t.transform[5]-found.transform[5]));}
  assert.ok(errors.length>=3,`Page ${n}: too few original phrases retained on their page`);errors.sort((a,b)=>a-b);
  assert.ok(errors[Math.floor(errors.length/2)]<3.5,`Page ${n}: text shifted away from the original layout`);
  assert.ok(Math.max(...errors)<6,`Page ${n}: a paragraph has drifted into its answer lines`);
  console.log(`PASS: page ${n}, ${errors.length} matching phrases, median vertical difference ${errors[Math.floor(errors.length/2)].toFixed(2)} pt`);
 }
}finally{await Promise.all(tasks.map(t=>t.destroy()));}
