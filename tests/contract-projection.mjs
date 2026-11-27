import {withoutResidentExtension} from './contract-compatibility.mjs';
// Compatibility view for pre-resident releases; variable_edit now matches main 0.38 exactly.
export function beforeStructFieldInput(_name,input){return withoutResidentExtension(structuredClone(input));}
