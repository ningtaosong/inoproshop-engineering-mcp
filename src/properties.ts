// Native Property/Get/Set evidence validation; no IDE calls or semantic type analysis.
import {canonical,digest,codeHash,normalize} from './storage.js';
import {getterDeclarationMatches,propertyHeader} from './contracts.js';
export const PROPERTY_NATIVE='5a3b8626-d3e9-4f37-98b5-66420063d91e';
export const ACCESSOR_NATIVE='792f2eb6-721e-4e64-ba20-bc98351056db';
export const PROPERTY_COVERAGE_VERSION='fb-properties-v2';
const uuid=(x:any)=>typeof x==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(x);
export function propertyEvidence(o:any):boolean{
 const kind=o?.objectType,s=o?.accessorStructure,ro=o?.readOnly===true,rows=s?.accessors;
 if(!['property','property_get','property_set'].includes(kind)||!uuid(o.objectId)||!uuid(o.fbId)||!uuid(o.propertyId)||o.fbId===o.propertyId||!uuid(o.parentId)||o.access!=='PUBLIC'||o.propertyType!=='DINT'||typeof o.readOnly!=='boolean'||o.propertyMetadataSource!=='native-property-accessor-tree-and-declaration'||!Array.isArray(o.path)||!Array.isArray(o.parentPath)||!Array.isArray(o.propertyPath)||canonical(o.parentPath)!==canonical(o.path.slice(0,-1))||o.propertyPath.at(-1)!==o.propertyName||s?.scheme!==(ro?'fb-property-accessors-v1':'fb-property-accessors-v2')||s?.propertyId!==o.propertyId||s?.readOnly!==ro||!Array.isArray(rows)||rows.length!==(ro?1:2)||o.accessorVersion!==digest(canonical(s)))return false;
 const ids=new Set(),names=new Set();
 for(const g of rows){if(!uuid(g.objectId)||ids.has(g.objectId)||names.has(g.name)||g.objectId===o.propertyId||g.objectId===o.fbId||g.parentId!==o.propertyId||g.nativeTypeId!==ACCESSOR_NATIVE||!['Get','Set'].includes(g.name)||g.hasDeclaration!==true||g.hasImplementation!==true||!Array.isArray(g.childIds)||g.childIds.length||!Array.isArray(g.embeddedObjectTypes)||!g.embeddedObjectTypes.includes('3b83b776-fb25-43b8-99f2-3c507c9143fc'))return false;ids.add(g.objectId);names.add(g.name);}
 if(!names.has('Get')||!ro&&!names.has('Set')||ro&&names.has('Set'))return false;
 if(kind==='property'){
  const h=propertyHeader(o.declaration,true);
  return !!h&&h.name.toLowerCase()===o.propertyName.toLowerCase()&&o.nativeTypeId===PROPERTY_NATIVE&&o.objectId===o.propertyId&&o.parentId===o.fbId&&o.propertyId!==o.fbId&&o.hasImplementation===false&&o.implementation===''&&canonical(o.path)===canonical(o.propertyPath)&&o.contentHash===o.propertyContentHash&&o.contentHash===codeHash(o.declaration,'');
 }
 const role=kind==='property_get'?'Get':'Set',g=rows.find((x:any)=>x.name===role);
 return !!g&&o.nativeTypeId===ACCESSOR_NATIVE&&o.hasImplementation===true&&o.objectId===g.objectId&&o.parentId===o.propertyId&&o.path.at(-1)===role&&canonical(o.parentPath)===canonical(o.propertyPath)&&getterDeclarationMatches(o.declaration)&&/^[a-f0-9]{64}$/.test(o.propertyContentHash)&&o.contentHash===codeHash(o.declaration,o.implementation);
}
export function propertyMetadata(o:any){
 return Object.fromEntries(['parentId','parentPath','fbId','propertyId','propertyPath','propertyName','propertyType','readOnly','access','accessorVersion','accessorStructure','propertyContentHash','propertyMetadataSource'].map(k=>[k,o[k]]));
}
export function propertyCreationEvidence(d:any,a:any):boolean{
 if(!propertyEvidence(d)||!propertyEvidence(d.getter)||d.objectType!=='property'||d.getter.objectType!=='property_get'||d.parentId!==a.parentId||d.fbId!==a.parentId||d.name!==a.name||d.path.at(-1)!==a.name||d.contentHash!==codeHash(a.declaration,'')||d.getter.contentHash!==codeHash(a.getDeclaration,a.getImplementation)||canonical(d.getter.propertyPath)!==canonical(d.path)||d.getter.parentId!==d.objectId||d.getter.fbId!==a.parentId||canonical(d.getter.accessorStructure)!==canonical(d.accessorStructure)||d.getter.propertyContentHash!==d.contentHash)return false;
 const f=d.factoryEvidence,c=d.accessorCleanup,defaults=c?.defaults,h=propertyHeader(f?.defaultDeclaration??'');
 if(f?.factory!=='create_property'||canonical(f.arguments)!==canonical([a.name,'DINT','cc393387-a21c-4f68-a3e3-84c36951965d'])||f.objectId!==d.objectId||f.parentId!==a.parentId||f.nativeTypeId!==PROPERTY_NATIVE||!h||h.name.toLowerCase()!==a.name.toLowerCase()||canonical(c?.before)!==canonical(f.defaultAccessors)||canonical(c?.after)!==canonical(d.accessorStructure)||!Array.isArray(defaults)||![1,2].includes(defaults.length)||defaults.length!==f.defaultAccessors?.accessors?.length)return false;
 const ids=new Set<string>();for(const v of defaults){const x=v.identity;if(!x||ids.has(x.objectId)||!uuid(x.objectId)||x.objectId===d.objectId||x.objectId===d.fbId||x.parentId!==d.objectId||x.nativeTypeId!==ACCESSOR_NATIVE||!['Get','Set'].includes(x.name)||x.hasDeclaration!==true||x.hasImplementation!==true||x.childIds?.length!==0||!x.embeddedObjectTypes?.includes('3b83b776-fb25-43b8-99f2-3c507c9143fc')||normalize(v.declaration)!=='VAR\nEND_VAR\n'||v.implementation!==''||!f.defaultAccessors.accessors.some((r:any)=>canonical(r)===canonical(x)))return false;ids.add(x.objectId);}
 const gets=defaults.filter((x:any)=>x.identity.name==='Get'),sets=defaults.filter((x:any)=>x.identity.name==='Set');
 if(gets.length!==1||gets[0].identity.objectId!==d.getter.objectId||sets.length!==defaults.length-1)return false;
 if(a.propertyMode==='read-write')return d.readOnly===false&&propertyEvidence(d.setter)&&d.setter.objectType==='property_set'&&d.setter.applicationId===d.applicationId&&d.setter.fbId===a.parentId&&d.setter.propertyId===d.objectId&&canonical(d.setter.propertyPath)===canonical(d.path)&&canonical(d.setter.accessorStructure)===canonical(d.accessorStructure)&&d.setter.propertyContentHash===d.contentHash&&d.setter.contentHash===codeHash(a.setDeclaration,a.setImplementation)&&sets.length===1&&sets[0].identity.objectId===d.setter.objectId&&c.removedSetId===null&&c.removalStatus==='retained';
 return d.readOnly===true&&d.setter===undefined&&c.removedSetId===(sets.length?sets[0].identity.objectId:null)&&c.removalStatus===(sets.length?'confirmed-absent':'not-needed');
}
export function propertyPreservationEvidence(d:any):boolean{
 const e=d.relatedSourceEvidence;if(!Array.isArray(e?.before)||!Array.isArray(e?.after)||canonical(e.before)!==canonical(e.after))return false;
 const sibling=d.accessorStructure.accessors.filter((x:any)=>x.objectId!==d.objectId),expected=[d.fbId,d.propertyId,...sibling.map((x:any)=>x.objectId)];
 if(e.before.length!==expected.length||new Set(e.before.map((x:any)=>x.objectId)).size!==expected.length)return false;
 return expected.every(id=>e.before.some((x:any)=>x.objectId===id&&x.contentHash===codeHash(x.declaration,x.implementation)&&
  (id===d.fbId?x.objectType==='function_block'&&canonical(x.path)===canonical(d.propertyPath.slice(0,-1)):propertyEvidence(x)&&x.propertyId===d.propertyId&&x.fbId===d.fbId&&canonical(x.accessorStructure)===canonical(d.accessorStructure))))&&e.before.find((x:any)=>x.objectId===d.propertyId)?.contentHash===d.propertyContentHash;
}
