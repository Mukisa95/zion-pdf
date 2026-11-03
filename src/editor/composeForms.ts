import {PDFDocument,PDFArray,PDFDict,PDFName,PDFObjectCopier,PDFString,PDFHexString,type PDFRef,type PDFObject} from "pdf-lib";
import type {ComposeSource} from "./composePdf";

/** PDFium copies widget appearances but omits their parent fields and the document's AcroForm. */
export async function restoreMergedForms(bytes:Uint8Array,sources:ComposeSource[]){
  if(sources.every(s=>s.hasForms===false))return bytes;
  const output=await PDFDocument.load(bytes,{updateMetadata:false}),fields:PDFRef[]=[],fonts=output.context.obj({});let offset=0;
  for(const [sourceIndex,input]of sources.entries()){
    if(input.hasForms===false){offset+=input.pages.length;continue;}
    const source=await PDFDocument.load(input.bytes,{updateMetadata:false,ignoreEncryption:true}),copier=PDFObjectCopier.for(source.context,output.context),known=new Map<PDFDict,{ref:PDFRef;kids:PDFArray}>(),fontNames=new Map<string,string>();
    const form=source.catalog.lookupMaybe(PDFName.of("AcroForm"),PDFDict),fontDict=form?.lookupMaybe(PDFName.of("DR"),PDFDict)?.lookupMaybe(PDFName.of("Font"),PDFDict);
    const copyFonts=()=>{if(fontNames.size||!fontDict)return;for(const [key,value]of fontDict.entries()){const renamed=`Zion${sourceIndex}_${key.decodeText()}`;fontNames.set(key.decodeText(),renamed);fonts.set(PDFName.of(renamed),copier.copy(value));}};
    for(const pageNumber of input.pages){
      const original=source.getPage(pageNumber-1).node.Annots(),target=output.getPage(offset++).node.Annots();if(!original||!target)continue;
      for(let n=0;n<original.size();n++){
        const widget=original.lookup(n,PDFDict);if(widget.lookupMaybe(PDFName.of("Subtype"),PDFName)?.decodeText()!=="Widget")continue;
        if(source.isEncrypted)throw new Error("Save an unprotected copy of this PDF before merging its form fields.");
        const imported=target.lookupMaybe(n,PDFDict);if(!imported)throw new Error("Couldn't preserve a PDF form field.");
        const chain:PDFDict[]=[widget];let parent=widget.lookupMaybe(PDFName.of("Parent"),PDFDict);
        while(parent&&!chain.includes(parent)&&chain.length<32){chain.push(parent);parent=parent.lookupMaybe(PDFName.of("Parent"),PDFDict);}
        const owner=chain.find(d=>d.has(PDFName.of("T"))||d.has(PDFName.of("FT")))||widget;
        let field=known.get(owner);
        if(!field){
          const attributes:Record<string,PDFObject>={};
          for(const key of ["FT","V","DV","Ff","Q","Opt","MaxLen","I","TU","TM","DS","RV"]){const value=chain.map(d=>d.get(PDFName.of(key))).find(v=>v!==undefined);if(value)attributes[key]=copier.copy(value);}
          copyFonts();const appearance=chain.map(d=>d.lookupMaybe(PDFName.of("DA"),PDFString,PDFHexString)).find(Boolean)||form?.lookupMaybe(PDFName.of("DA"),PDFString,PDFHexString);
          if(appearance)attributes.DA=PDFString.of(appearance.decodeText().replace(/\/([^\s]+)(?=\s)/g,(whole,name)=>fontNames.has(name)?`/${fontNames.get(name)}`:whole));
          const path=chain.slice().reverse().map(d=>d.lookupMaybe(PDFName.of("T"),PDFString,PDFHexString)?.decodeText()).filter(Boolean).join(".")||`Field${fields.length+1}`,kids=output.context.obj([]);
          const ref=output.context.register(output.context.obj({...attributes,T:PDFString.of(`Document${sourceIndex+1}.${path}`),Kids:kids}));field={ref,kids};known.set(owner,field);fields.push(ref);
        }
        for(const key of ["FT","T","V","DV","Ff","DA","Q","Opt","MaxLen","I"])imported.delete(PDFName.of(key));
        imported.set(PDFName.of("Parent"),field.ref);field.kids.push(target.get(n));
      }
    }
  }
  if(!fields.length)return bytes;
  output.catalog.set(PDFName.of("AcroForm"),output.context.register(output.context.obj({Fields:fields,DR:output.context.obj({Font:fonts}),NeedAppearances:false})));
  return new Uint8Array(await output.save({updateFieldAppearances:false}));
}
