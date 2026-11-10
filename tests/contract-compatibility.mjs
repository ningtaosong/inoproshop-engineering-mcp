// Each release's additive object-kind extension is removed only for historical checks.
// Every other property/default/required/limit/order remains part of the historical check.
export function withoutMethodExtension(value){
 if(Array.isArray(value))return value.map(withoutMethodExtension);
 if(!value||typeof value!=='object')return value;
 const out=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,withoutMethodExtension(v)]));
 if(Array.isArray(out.enum))out.enum=out.enum.filter(x=>!['method','method-return'].includes(x));
 if(out.properties?.methodMetadataSource){
  for(const k of ['parentPath','access','methodReturnType','methodMetadataSource'])delete out.properties[k];
  if(!out.properties.created)delete out.properties.parentId;
  // Creation payload already had parentId after name. Preserve its historical
  // insertion order as well as shape for pre-canonical schema hash fixtures.
  else if(out.properties.name&&out.properties.parentId){
   const parent=out.properties.parentId;delete out.properties.parentId;
   out.properties=Object.fromEntries(Object.entries(out.properties).flatMap(([k,v])=>k==='name'?[[k,v],['parentId',parent]]:[[k,v]]));
  }
 }
 if(out.properties?.expectedHash&&out.properties?.declaration)delete out.properties.parentId;
 if(out.properties?.skippedObjects){delete out.properties.unsupportedChildren;delete out.properties.methodCoverageVersion;}
 return out;
}
export function withoutDirectOriginExtension(value){
 value=withoutMethodExtension(value);
 if(Array.isArray(value))return value.map(withoutDirectOriginExtension);
 if(!value||typeof value!=='object')return value;
 const out=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,withoutDirectOriginExtension(v)]));
 if(JSON.stringify(out.enum)===JSON.stringify(['current-project','working-copy','registered-source']))out.enum=['working-copy','registered-source'];
 return out;
}
export function withoutInitializerMemberExtension(value){
 value=withoutDirectOriginExtension(value);
 if(Array.isArray(value))return value.map(withoutInitializerMemberExtension);
 if(!value||typeof value!=='object')return value;
 const out=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,withoutInitializerMemberExtension(v)]));
 if(out.properties?.sourceRead&&out.properties?.maxObjects&&out.properties?.maxEntries)
  for(const k of ['includeInitializerMembers','maxInitializerMembers'])delete out.properties[k];
 if(out.properties?.basis?.const==='declaration-parsing'){
  delete out.properties.memberExtraction;
  for(const k of ['includeInitializerMembers','maxInitializerMembers'])delete out.properties.query.properties[k];
  const p=out.properties.entries.items.properties;
  p.category.enum=p.category.enum.filter(x=>!['initializer-member','initializer-member-gap'].includes(x));
  for(const k of ['parentName','parentCategory','parentNamePosition','parentDeclarationPosition','parentInitializerPosition','valueRaw','valuePosition'])delete p[k];
 }
 return out;
}
export function withoutIdentifierExtension(value){
 value=withoutDirectOriginExtension(value);
 if(Array.isArray(value))return value.map(withoutIdentifierExtension);
 if(!value||typeof value!=='object')return value;
 const out=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,withoutIdentifierExtension(v)]));
 // Only the project_search input/data node has both query and areas.
 if(out.properties?.query&&out.properties?.areas&&out.properties?.caseSensitive)
  for(const key of ['matchMode','searchVersion','lexerVersion','lexicalCoverage','readOrigin','pageFileEvidence'])delete out.properties[key];
 return out;
}
export function withoutArrayExtension(value){
 value=withoutIdentifierExtension(value);
 if(Array.isArray(value))return value.map(withoutArrayExtension);
 if(!value||typeof value!=='object')return value;
 const out=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,withoutArrayExtension(v)]));
 const allowed=[['gvl','structure','enum','array'],['st_pou','function_block','gvl','structure','enum','array'],['st_pou','function_block','gvl','structure','enum','array','task']];
 if(allowed.some(a=>JSON.stringify(a)===JSON.stringify(value.enum)))out.enum=value.enum.filter(x=>x!=='array');
 return out;
}
export function withoutEnumExtension(value){
 value=withoutArrayExtension(value);
 if(Array.isArray(value))return value.map(withoutEnumExtension);
 if(!value||typeof value!=='object')return value;
 const out=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,withoutEnumExtension(v)]));
 const allowed=[['gvl','structure','enum'],['st_pou','function_block','gvl','structure','enum'],['st_pou','function_block','gvl','structure','enum','task']];
 if(allowed.some(a=>JSON.stringify(a)===JSON.stringify(value.enum)))out.enum=value.enum.filter(x=>x!=='enum');
 return out;
}
