import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
test('FB interface production bridge insertion and child preservation',()=>{const r=spawnSync('python',['-B','tests/bridge_fb_initializer_add_test.py'],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);});
