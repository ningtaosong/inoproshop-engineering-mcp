import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
test('production member insertion preserves raw text and stops partial writes',async()=>{
 await promisify(execFile)('python',['-B','tests/bridge_member_initializer_add_test.py'],{windowsHide:true,timeout:30000});
});
