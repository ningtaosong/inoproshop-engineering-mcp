// Each release's additive object-kind extension is removed only for historical checks.
// Every other property/default/required/limit/order remains part of the historical check.
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
