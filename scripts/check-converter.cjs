const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
// Packaging must fail when a runtime/model is missing instead of shipping a download prompt.
module.exports=async context=>{
  const platform=context.electronPlatformName,arch=String(context.arch) === '3'?'arm64':'x64';
  const targets=context.packager.platformSpecificBuildOptions.target;
  const universal=platform==='darwin'&&(Number(context.arch)===4||Array.isArray(targets)&&targets.some(t=>typeof t==='object'&&t.arch?.includes('universal')));
  const architectures=universal?['x64','arm64']:[arch];
  for(const cpu of architectures){
    const root=path.join(context.packager.projectDir,'conversion','runtime',`${platform}-${cpu}`),manifest=path.join(root,'manifest.json');
    if(!fs.existsSync(manifest))throw new Error(`Build the complete offline converter for ${platform}-${cpu} before packaging (npm run converter:build).`);
    const data=JSON.parse(fs.readFileSync(manifest,'utf8'));
    if(data.platform!==platform||data.arch!==cpu||!data.files.length)throw new Error('Incorrect converter runtime manifest.');
    for(const required of [`zion-converter/zion-converter${platform==='win32'?'.exe':''}`,'models/docling-project--docling-layout-heron/model.safetensors','models/docling-project--docling-models/model_artifacts/tableformer/accurate/tableformer_accurate.safetensors','zion-converter/_internal/latex2mathml/unimathsymbols.txt'])if(!data.files.some(file=>file.path===required))throw new Error(`Missing offline converter component: ${required}`);
    if(!data.files.some(file=>/zion-converter\/_internal\/torchvision\/_C.*\.(pyd|so|dylib)$/.test(file.path)))throw new Error('The native image-processing library is missing from the offline converter.');
    for(const item of data.files){const file=path.resolve(root,item.path);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).size!==item.bytes)throw new Error(`Incomplete offline converter: ${item.path}`);if(/\.safetensors$/.test(item.path)&&createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==item.sha256)throw new Error(`Corrupt recognition model: ${item.path}`);}
  }
};
