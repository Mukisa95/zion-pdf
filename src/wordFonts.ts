import type {LocalFontFace} from "./editor/fonts";
import {matchLocalFont} from "./editor/fonts";
import {fontTraits} from "./fontOptions";

type WordFace={family:string;bold:boolean;italic:boolean;descent?:number};
const names=new WeakMap<LocalFontFace,WordFace>();
/** Word uses the legacy OpenType family, which can differ from the browser's typographic family. */
export async function prepareWordFonts(faces:LocalFontFace[],requested:string[]){
  const selected=new Set(requested.map(name=>matchLocalFont(faces,name)).filter((face):face is LocalFontFace=>!!face));
  for(const face of selected){if(names.has(face))continue;const traits=fontTraits(face);names.set(face,{family:face.family,bold:traits.bold,italic:traits.italic});
    try{const blob=await face.blob();if(blob.size>64*1024*1024)continue;const data=new DataView(await blob.arrayBuffer()),count=data.getUint16(4);if(count>4096||12+count*16>data.byteLength)continue;
      let offset=0,length=0,head=0,hhea=0;for(let i=0;i<count;i++){const at=12+i*16,tag=data.getUint32(at),start=data.getUint32(at+8),size=data.getUint32(at+12);if(start+size>data.byteLength)continue;if(tag===0x6e616d65){offset=start;length=size;}else if(tag===0x68656164&&size>=20)head=start;else if(tag===0x68686561&&size>=8)hhea=start;}
      const units=head?data.getUint16(head+18):0,descent=units&&hhea?Math.abs(data.getInt16(hhea+6))/units:undefined;
      if(!offset||length<6||offset+length>data.byteLength)continue;const records=data.getUint16(offset+2),strings=offset+data.getUint16(offset+4);if(records>4096||6+records*12>length)continue;
      const values=new Map<number,{text:string;rank:number}>();
      for(let i=0;i<records;i++){const at=offset+6+i*12,platform=data.getUint16(at),language=data.getUint16(at+4),id=data.getUint16(at+6),size=data.getUint16(at+8),start=strings+data.getUint16(at+10);if((id!==1&&id!==2)||start+size>offset+length||!size)continue;
        const rank=platform===3&&language===0x409?10:platform===0?8:platform===3?6:platform===1?2:0;if(!rank||rank<=(values.get(id)?.rank||0))continue;
        const bytes=new Uint8Array(data.buffer,start,size),text=new TextDecoder(platform===0||platform===3?"utf-16be":"windows-1252").decode(bytes).replace(/\0/g,"").trim();if(text)values.set(id,{text,rank});
      }
      const family=values.get(1)?.text,style=values.get(2)?.text;if(family&&style)names.set(face,{family,bold:/bold|black|heavy|demi/i.test(style),italic:/italic|oblique/i.test(style),descent});
    }catch{/* Font data can be unavailable; its device family remains usable. */}
  }
}
export const wordFontFace=(face:LocalFontFace)=>names.get(face);
