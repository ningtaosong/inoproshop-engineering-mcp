import {test} from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
test('production member type guard rejects drift and unreadable evidence (native substitutes, not IDE)',()=>{
 const p=spawnSync('python',['tests/bridge_variable_member_test.py'],{encoding:'utf8'});
 assert.equal(p.status,0,p.stdout+p.stderr);
});
