import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('production Property search scope descriptions match readonly and writable inventories',()=>{
  const r=spawnSync('python',['tests/bridge_property_scope_description_test.py'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stdout+r.stderr);
});
