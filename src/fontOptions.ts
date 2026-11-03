import type {LocalFontFace} from "./editor/fonts";

const familyKey=(name:string)=>name.trim().replace(/\s+/g," ").toLowerCase();
const styleKey=(style:string)=>style.replace(/[\s_-]/g,"").toLowerCase().replace(/^(normal|roman)$/,"regular");
export function fontTraits(face:LocalFontFace){
  const style=face.style;
  const weight=/black|heavy/i.test(style)?900:/extra.?bold|ultra.?bold/i.test(style)?800:/semi.?bold|demi.?bold/i.test(style)?600:/bold/i.test(style)?700:/extra.?light|ultra.?light/i.test(style)?200:/light/i.test(style)?300:/thin/i.test(style)?100:/medium/i.test(style)?500:400;
  return {weight,italic:/italic|oblique/i.test(style),bold:weight>=600};
}
const regularRank=(face:LocalFontFace)=>/^(regular|normal)$/i.test(face.style)?0:/^(book|roman)$/i.test(face.style)?1:Math.abs(fontTraits(face).weight-400)+ (fontTraits(face).italic?1000:2);
/** Present font families independently from their available styles. */
export function fontFamilyOptions(faces:LocalFontFace[]):LocalFontFace[]{
  const families=new Map<string,LocalFontFace>();
  for(const face of faces){const key=familyKey(face.family),current=families.get(key);if(!current||regularRank(face)<regularRank(current))families.set(key,face);}
  return [...families.values()].sort((a,b)=>a.family.localeCompare(b.family));
}
export function fontStyleOptions(faces:LocalFontFace[],family:string,preferred?:LocalFontFace):LocalFontFace[]{
  const styles=new Map<string,LocalFontFace>();
  for(const face of faces)if(familyKey(face.family)===familyKey(family)&&(!styles.has(styleKey(face.style))||face.postscriptName===preferred?.postscriptName))styles.set(styleKey(face.style),face);
  return [...styles.values()].sort((a,b)=>regularRank(a)-regularRank(b)||a.style.localeCompare(b.style));
}
export const sameFontFamily=(a:LocalFontFace,b:LocalFontFace)=>familyKey(a.family)===familyKey(b.family);
export function fontForFamily(faces:LocalFontFace[],family:LocalFontFace,current?:LocalFontFace):LocalFontFace {
  const styles=fontStyleOptions(faces,family.family);if(!current)return styles[0] || family;
  const traits=fontTraits(current);
  return styles.find(face=>styleKey(face.style)===styleKey(current.style))
    || styles.find(face=>fontTraits(face).weight===traits.weight&&fontTraits(face).italic===traits.italic)
    || styles[0] || family;
}
