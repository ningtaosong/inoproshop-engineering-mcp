import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
test('生产桥接POU创建：类型/返回值、局部故障恢复及磁盘重开替身测试',async()=>{
  await promisify(execFile)('python',['tests/bridge_pou_test.py'],{windowsHide:true,timeout:30000});
});
