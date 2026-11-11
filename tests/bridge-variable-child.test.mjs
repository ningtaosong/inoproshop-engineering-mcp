import {test} from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
test('production FB direct-child guard rejects drift and unreadable identity (native substitutes)',()=>{
 const p=spawnSync('python',['tests/bridge_variable_child_test.py'],{encoding:'utf8'});
 assert.equal(p.status,0,p.stdout+p.stderr);
});
