import {test} from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
test('Production Property/Get bridge boundaries and partial lifecycle substitutes (not IDE)',()=>{const p=spawnSync('python',['tests/bridge_properties_test.py'],{encoding:'utf8'});assert.equal(p.status,0,p.stdout+p.stderr);});
