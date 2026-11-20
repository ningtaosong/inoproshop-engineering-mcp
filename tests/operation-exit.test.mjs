import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readJson} from '../dist/storage.js';
import {scenario} from './exit-scenario.mjs';
test('归档非零退出反例：成功文件不能覆盖 0xC000041D',async()=>{
 const x=await scenario();assert.equal(x.result.status,'unknown');
 assert.equal(x.result.error.code,'IDE_ABNORMAL_EXIT');
 assert.equal(x.result.data.priorResult.status,'succeeded');
 assert.deepEqual(await readJson(path.join(x.directory,'result.json')),x.raw);
});
