// Each release's additive object-kind extension is removed only for historical checks.
// Every other property/default/required/limit/order remains part of the historical check.
export function withoutInitializerMemberExtension(value){
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
