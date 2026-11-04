// The only permitted old-schema difference is this release's additive enum object kind.
// Every other property/default/required/limit/order remains part of the historical check.
export function withoutEnumExtension(value){
 if(Array.isArray(value))return value.map(withoutEnumExtension);
 if(!value||typeof value!=='object')return value;
 const out=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,withoutEnumExtension(v)]));
 const allowed=[['gvl','structure','enum'],['st_pou','function_block','gvl','structure','enum'],['st_pou','function_block','gvl','structure','enum','task']];
 if(allowed.some(a=>JSON.stringify(a)===JSON.stringify(value.enum)))out.enum=value.enum.filter(x=>x!=='enum');
 return out;
}
