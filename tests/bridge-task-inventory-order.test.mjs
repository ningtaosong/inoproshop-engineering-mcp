import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
test('task_create archived comparison, unordered tasks and ordered calls (offline native doubles)',async()=>{
  await promisify(execFile)('python',['-B','tests/bridge_task_inventory_order_test.py'],{windowsHide:true,timeout:30000});
});
