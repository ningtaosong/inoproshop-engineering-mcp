// Project only the additive 0.39 input action for historical contract checks.
// Old actions still require initializer in Zod refinement; new test checks that.
export function beforeStructFieldInput(name,input){
 if(name!=='variable_edit')return input;
 input=structuredClone(input);
 input.properties.action.enum=input.properties.action.enum.filter(x=>x!=='add-struct-field');
 input.required=Object.keys(input.properties).filter(k=>input.required.includes(k)||k==='initializer');
 return input;
}
