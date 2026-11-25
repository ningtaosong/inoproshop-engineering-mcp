import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
test('production bridge struct field dispatch and uncertainty',()=>{const r=spawnSync('python',['-B','tests/bridge_struct_field_test.py'],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);});
