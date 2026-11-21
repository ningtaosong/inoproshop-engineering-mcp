import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('append/replace production bridge task sets and ordered calls (offline)',async()=>{
  await promisify(execFile)('python',['-B','-X','utf8','tests/bridge_task_call_inventory_order_test.py'],
    {windowsHide:true,timeout:30000});
});
