import test from 'node:test';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
test('Production native Method bridge: factory, identity, permission, partial and lifecycle substitutes',async()=>{await promisify(execFile)('python',['tests/bridge_methods_test.py'],{windowsHide:true,timeout:30000});});
