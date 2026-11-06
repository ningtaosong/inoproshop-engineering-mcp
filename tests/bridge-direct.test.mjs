import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
test('native direct file guard, external owner rejection and no automatic rollback',async()=>{
 await promisify(execFile)('python',['tests/bridge_direct_test.py'],{windowsHide:true,timeout:30000});
});
