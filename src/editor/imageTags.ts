import { PDFDocument, PDFArray, PDFDict, PDFName, PDFNumber, PDFNull, PDFRef } from "pdf-lib";

/** Remove only this page's deleted marked-content reference, preserving the rest of the structure tree. */
export async function removeImageTag(bytes:Uint8Array,pageIndex:number,mcid:number):Promise<Uint8Array>{
  if(mcid<0&&mcid!==-2)return bytes;
  const doc=await PDFDocument.load(bytes,{updateMetadata:false}),page=doc.getPage(pageIndex),context=doc.context,root=doc.catalog.lookupMaybe(PDFName.of("StructTreeRoot"),PDFDict);if(!root)return bytes;
  const pageRef=page.ref.toString();let budget=100000;
  const samePage=(ref:unknown)=>ref instanceof PDFRef&&ref.toString()===pageRef;
  const clean=(value:unknown,ownerPage:unknown):unknown=>{
    if(--budget<0)throw new Error("This document's accessibility structure is too large to update.");
    const object=value instanceof PDFRef?context.lookup(value):value;
    if(object instanceof PDFNumber)return samePage(ownerPage)&&(mcid===-2||object.asNumber()===mcid)?undefined:value;
    if(object instanceof PDFArray){for(let i=object.size()-1;i>=0;i--)if(clean(object.get(i),ownerPage)===undefined)object.remove(i);return object.size()?value:undefined;}
    if(object instanceof PDFDict){const inherited=object.get(PDFName.of("Pg")) || ownerPage,number=object.lookupMaybe(PDFName.of("MCID"),PDFNumber);if(number&&samePage(inherited)&&(mcid===-2||number.asNumber()===mcid))return undefined;const key=PDFName.of("K"),children=object.get(key);if(children){if(clean(children,inherited)===undefined){object.delete(key);return undefined;}}return value;}
    return value;
  };
  const key=PDFName.of("K"),children=root.get(key);if(children&&clean(children,undefined)===undefined)root.delete(key);
  const parentId=page.node.lookupMaybe(PDFName.of("StructParents"),PDFNumber);
  if(parentId){const walk=(node:PDFDict)=>{if(--budget<0)throw new Error("The structure index is too large to update.");const nums=node.lookupMaybe(PDFName.of("Nums"),PDFArray);if(nums)for(let i=0;i+1<nums.size();i+=2){const number=nums.lookup(i,PDFNumber);if(number.asNumber()===parentId.asNumber()){const refs=nums.lookup(i+1,PDFArray);if(mcid===-2){for(let j=0;j<refs.size();j++)refs.set(j,PDFNull);}else if(mcid>=0&&mcid<refs.size())refs.set(mcid,PDFNull);}}const kids=node.lookupMaybe(PDFName.of("Kids"),PDFArray);if(kids)for(let i=0;i<kids.size();i++)walk(kids.lookup(i,PDFDict));};const tree=root.lookupMaybe(PDFName.of("ParentTree"),PDFDict);if(tree)walk(tree);}
  return doc.save({useObjectStreams:false});
}
