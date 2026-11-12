import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('production bridge keeps set-type partial writes unknown in direct and old-copy modes',async()=>{
 await promisify(execFile)('python',['tests/bridge_variable_type_test.py'],{windowsHide:true,timeout:30000});
});
