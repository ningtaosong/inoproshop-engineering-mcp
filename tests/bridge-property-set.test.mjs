import {test} from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
test('Production writable Property/Get/Set native bridge substitutes (not IDE)',()=>{const p=spawnSync('python',['tests/bridge_property_set_test.py'],{encoding:'utf8'});assert.equal(p.status,0,p.stdout+p.stderr);});
