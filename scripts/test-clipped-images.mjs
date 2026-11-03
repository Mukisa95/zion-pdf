import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {init} from '@embedpdf/pdfium';
import {PDFDocument,PDFOperator,PDFRawStream,PDFArray,decodePDFRawStream,rgb} from 'pdf-lib';
import {inspectImageObjects,inspectGraphicObjects,editImageObject,moveGraphicObjects} from '../src/editor/pdfium.ts';
import {replaceImagePlacement} from '../src/editor/imagePlacement.ts';
import {renderTextPreview} from '../src/editor/textCells.ts';
const api=await init({wasmBinary:await readFile(new URL('../node_modules/@embedpdf/pdfium/dist/pdfium.wasm',import.meta.url))});api.PDFiumExt_Init();
const pdf=await PDFDocument.create(),im=await pdf.embedJpg(new Uint8Array(await readFile(new URL('./fixtures/red.jpg',import.meta.url))));
const page=pdf.addPage([400,300]);
page.pushOperators(PDFOperator.of('q 40 40 100 100 re W n 40 40 m 140 40 l 40 140 l h W n /Figure <</MCID 0>> BDC'));
page.drawImage(im,{x:20,y:20,width:140,height:140});page.pushOperators(PDFOperator.of('EMC Q'));
page.drawImage(im,{x:200,y:40,width:60,height:60});page.drawText('Keep text and artwork',{x:30,y:250,size:14});page.drawRectangle({x:300,y:220,width:30,height:30,color:rgb(0,0,1)});
const second=pdf.addPage([400,300]);second.drawImage(im,{x:20,y:20,width:140,height:140});
const source=await pdf.save(),[target]=inspectImageObjects(api,source,0);assert.equal(target.unsupported,undefined);
const raster=(data,index=0)=>renderTextPreview(api,data,index,400,300,0);
const pixel=(pixels,x,y)=>Array.from(pixels.slice(((299-y)*400+x)*4,((299-y)*400+x)*4+4));
const red=p=>p[0]>180&&p[1]<70&&p[2]<70,white=p=>p.slice(0,3).every(v=>v>245);
const original=raster(source),other=raster(source,1);
assert.ok(red(pixel(original,60,60)));assert.ok(white(pixel(original,125,125)));assert.ok(white(pixel(original,25,25)));
const moved=editImageObject(api,source,0,target,{kind:'move',dx:25,dy:10});
assert.ok(red(pixel(raster(moved),85,70)));assert.ok(white(pixel(raster(moved),50,50)));assert.ok(white(pixel(raster(moved),150,135)));assert.deepEqual(raster(moved,1),other);
const resized=editImageObject(api,source,0,target,{kind:'resize',bounds:[20,20,230,230]});
assert.ok(red(pixel(raster(resized),90,90)));assert.ok(white(pixel(raster(resized),200,200)));assert.ok(white(pixel(raster(resized),25,25)));
for(const operation of ['rotate-right','flip-horizontal','smaller','larger']){
 const output=editImageObject(api,source,0,target,{kind:'transform',operation});assert.deepEqual(raster(output,1),other);
 const pixels=raster(output);assert.ok(pixels.some((_,i)=>i%4===0&&red(Array.from(pixels.slice(i,i+4)))));
 // Every visible pixel of the selected triangle must follow the same page-space transform.
 const [l,b,r,t]=target.bounds,cx=(l+r)/2,cy=(b+t)/2;
 for(const [x,y] of [[60,60],[125,125],[25,25]]){
  let tx=x,ty=y;
  if(operation==='rotate-right'){tx=cx+y-cy;ty=cy-(x-cx);}else if(operation==='flip-horizontal')tx=2*cx-x;else {const s=operation==='smaller'?.9:1.1;tx=cx+(x-cx)*s;ty=cy+(y-cy)*s;}
  assert.equal(red(pixel(pixels,Math.round(tx),Math.round(ty))),red(pixel(original,x,y)),operation+' crop follows image');
 }
}
const replacement=new Uint8Array(await readFile(new URL('../build/icon.png',import.meta.url)));
await assert.rejects(()=>replaceImagePlacement(api,source,0,target,new Uint8Array([1,2,3])),/PNG or JPEG/);
const oversized=new Uint8Array(24);oversized.set([137,80,78,71,13,10,26,10],0);oversized.set([73,72,68,82],12);new DataView(oversized.buffer).setUint32(16,50000);new DataView(oversized.buffer).setUint32(20,50000);await assert.rejects(()=>replaceImagePlacement(api,source,0,target,oversized),/dimensions/);
const replaced=await replaceImagePlacement(api,source,0,target,replacement);
const replacedPixels=raster(replaced);assert.ok(white(pixel(replacedPixels,125,125)));assert.ok(white(pixel(replacedPixels,25,25)));
// The same resource is reused on this page and another page. Neither other placement may change.
for(let y=40;y<100;y++)for(let x=200;x<260;x++)assert.deepEqual(pixel(replacedPixels,x,y),pixel(original,x,y));
assert.deepEqual(raster(replaced,1),other);assert.equal(inspectImageObjects(api,replaced,0)[0].markedContentId,0);
assert.equal(inspectImageObjects(api,replaced,0).length,2);
await assert.rejects(()=>replaceImagePlacement(api,moved,0,target,replacement),/changed/);
const movedReplacement=editImageObject(api,replaced,0,inspectImageObjects(api,replaced,0)[0],{kind:'move',dx:25,dy:10});assert.ok(white(pixel(raster(movedReplacement),150,135)));
const group=moveGraphicObjects(api,source,0,[],[target],25,10);assert.deepEqual(raster(group),raster(moved));
// Even-odd holes and curved clips survive replacement and translation.
const curved=await PDFDocument.create(),ci=await curved.embedJpg(new Uint8Array(await readFile(new URL('./fixtures/red.jpg',import.meta.url)))),cp=curved.addPage([400,300]);
cp.pushOperators(PDFOperator.of('q 30 30 m 160 30 160 160 30 160 c h 55 60 35 35 re W* n'));cp.drawImage(ci,{x:20,y:20,width:150,height:150});cp.pushOperators(PDFOperator.of('Q'));
const curvedBytes=await curved.save(),curvedTarget=inspectImageObjects(api,curvedBytes,0)[0],curveRaster=raster(curvedBytes);
const curveMove=raster(editImageObject(api,curvedBytes,0,curvedTarget,{kind:'move',dx:20,dy:10}));
for(let y=20;y<170;y++)for(let x=20;x<170;x++)assert.deepEqual(pixel(curveMove,x+20,y+10),pixel(curveRaster,x,y));
const curveReplacement=await replaceImagePlacement(api,curvedBytes,0,curvedTarget,replacement);assert.ok(white(pixel(raster(curveReplacement),70,75)));
const jpegReplacement=await replaceImagePlacement(api,curvedBytes,0,curvedTarget,new Uint8Array(await readFile(new URL('./fixtures/red.jpg',import.meta.url))));assert.deepEqual(raster(jpegReplacement),curveRaster);
// Adobe-style layer/artifact groups can share their native mark list across images, forms and text.
const shared=await PDFDocument.create(),sp=shared.addPage([400,300]),si=await shared.embedJpg(new Uint8Array(await readFile(new URL('./fixtures/red.jpg',import.meta.url))));
sp.drawImage(si,{x:300,y:20,width:40,height:40});sp.pushOperators(PDFOperator.of('/Artifact BMC'));sp.drawImage(si,{x:20,y:20,width:40,height:40});sp.drawText('Preserve /FXX Do and EMC text',{x:20,y:260,size:14});const [sf]=await shared.embedPdf(curvedBytes,[0]);sp.drawPage(sf,{x:0,y:0,width:100,height:75});sp.pushOperators(PDFOperator.of('q 100 40 60 50 re W n'));sp.drawImage(si,{x:90,y:30,width:80,height:70});sp.pushOperators(PDFOperator.of('Q EMC'));const sb=await shared.save(),st=inspectImageObjects(api,sb,0).at(-1),sr=raster(sb),so=await replaceImagePlacement(api,sb,0,st,replacement),sor=raster(so);
for(let y=0;y<300;y++)for(let x=0;x<400;x++)if(x<90||x>=170||y<30||y>=100)assert.deepEqual(pixel(sor,x,y),pixel(sr,x,y),'only selected placement changes inside a shared mark list');
assert.deepEqual(inspectImageObjects(api,so,0).slice(0,-1),inspectImageObjects(api,sb,0).slice(0,-1));assert.ok(white(pixel(sor,95,35)));
// A clipped Form and path move with their outlines as a group, retaining internal artwork.
const groupPdf=await PDFDocument.create(),gp=groupPdf.addPage([400,300]);const [embedded]=await groupPdf.embedPdf(curvedBytes,[0]);gp.pushOperators(PDFOperator.of('q 20 20 180 180 re W n'));gp.drawPage(embedded,{x:0,y:0,width:400,height:300});gp.pushOperators(PDFOperator.of('Q'));gp.pushOperators(PDFOperator.of('q 230 30 30 40 re W n'));gp.drawRectangle({x:220,y:20,width:60,height:60,color:rgb(0,0,1)});gp.pushOperators(PDFOperator.of('Q'));
const groupBytes=await groupPdf.save(),graphics=inspectGraphicObjects(api,groupBytes,0);assert.ok(graphics.length>=2);assert.ok(graphics.every(item=>!item.unsupported));
const groupBefore=raster(groupBytes),groupAfter=raster(moveGraphicObjects(api,groupBytes,0,graphics,[],20,10));
for(let y=10;y<210;y++)for(let x=10;x<285;x++)assert.deepEqual(pixel(groupAfter,x+20,y+10),pixel(groupBefore,x,y));
const check=await PDFDocument.load(replaced);const contents=check.getPage(0).node.Contents(),streams=contents instanceof PDFArray?contents.asArray():[contents];assert.ok(streams.every(ref=>!new TextDecoder().decode(decodePDFRawStream(check.context.lookup(ref,PDFRawStream)).decode()).includes('ZionPdfImage')),'temporary markers removed');
await mkdir(new URL('../release/smoke/',import.meta.url),{recursive:true});await writeFile(new URL('../release/smoke/clipped-images-fixture.pdf',import.meta.url),source);await writeFile(new URL('../release/smoke/clipped-images-replaced.pdf',import.meta.url),replaced);
console.log('PASS: clipped image movement, resizing, rotation, flipping, PNG/JPEG replacement, shared resources and mark lists, MCID preservation, even-odd/curved crops, clipped vector/form groups, saved reopening, file validation and stale selection checks');
