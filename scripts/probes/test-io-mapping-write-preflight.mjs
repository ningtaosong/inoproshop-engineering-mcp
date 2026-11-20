import test from 'node:test';
import assert from 'node:assert/strict';
import {digest} from '../../dist/storage.js';
import {assess, evidenceVersion} from './io-mapping-write-preflight.mjs';

// These records are synthetic. They describe evidence inputs, not an executed setter.
export function example() {
  const nil = '00000000-0000-0000-0000-000000000000';
  const declaration = 'VAR_GLOBAL\n Ready : BOOL := FALSE;\nEND_VAR';
  const key = {deviceGuid: 'module', connectorId: 2, parameterId: 13, memberPath: ['Bit0']};
  const field = value => ({state: 'value', value});
  const empty = {state: 'null', value: null};
  const row = {
    key, nativeName: 'InputData', memberIdentifier: 'Bit0', direction: field('Input'),
    type: field('BOOL'), bits: field(1), automaticAddress: field(true),
    manualAddress: field('%IX0.0'), first: empty, defaultVariable: empty,
    complete: true, mappings: [], emptySentinelConfirmed: true,
  };
  return {
    state: {
      ideVersion: '1.9.1.6', fileIdentity: 'synthetic-file-id', diskHash: 'a'.repeat(64),
      root: {guid: 'device', description: [4102, '10f4 0002', '3.5.11.11'],
        ioApplicationSet: true, ioApplicationId: 'app'},
      module: {guid: 'module', parentGuid: 'device', description: [40600, '10F4 0600', '00.00.00.20'],
        ioApplicationSet: false, ioApplicationId: nil},
      connector: {id: 2, ownerGuid: 'module', interface: 'Common.inovance2',
        ioApplicationSet: false, ioApplicationId: nil},
      applications: [{guid: 'app', isApplication: true, deviceGuid: 'device',
        typeGuid: 'native-application', name: 'CellApp', path: ['Cell', 'Plc Logic', 'CellApp']}],
      gvls: [{guid: 'gvl', parentGuid: 'app', name: 'Signals',
        typeGuid: 'ffbfa93a-b94d-45fc-a329-229860183b1d',
        path: ['Cell', 'Plc Logic', 'CellApp', 'Signals'], declaration, sourceVersion: digest(declaration)}],
      coverage: {enumerationComplete: true, exportComplete: true, truncated: false,
        scope: 'selected-connector', observed: 2},
      channels: [row, {...structuredClone(row),
        key: {...key, memberPath: ['Bit1']}, memberIdentifier: 'Bit1'}],
    },
    target: {key, gvlGuid: 'gvl', variable: 'Ready'},
  };
}

function changeDeclaration(state, source) {
  state.gvls[0].declaration = source;
  state.gvls[0].sourceVersion = digest(source);
}

test('normal local candidate retains static identity and explicitly withholds write permission', () => {
  const {state, target} = example();
  const result = assess(state, target);
  assert.equal(result.status, 'local-candidate');
  assert.equal(result.expression, 'CellApp.Signals.Ready');
  assert.equal(result.applicationSelection.effectiveSelectionConfirmed, false);
  assert.ok(result.remainingEvidence.includes('effective-io-application-selection'));
  assert.equal(result.declaration.gvlGuid, 'gvl');
  assert.deepEqual([result.declaration.position.line, result.declaration.position.column], [2, 2]);
  assert.equal(result.writeAuthorized, false);
  assert.equal(result.duplicateSearch.applicationWide, false);
  assert.equal(result.duplicateSearch.examined, 2);
  target.variable = 'rEaDy';
  assert.equal(assess(state, target).expression, 'CellApp.Signals.Ready');
});

const cases = [
  ['wrong type', s => changeDeclaration(s, 'VAR_GLOBAL\n Ready : INT;\nEND_VAR'), 'VARIABLE_NOT_PLAIN_BOOL'],
  ['AT address', s => changeDeclaration(s, 'VAR_GLOBAL\n Ready AT %IX0.0 : BOOL;\nEND_VAR'), 'VARIABLE_NOT_PLAIN_BOOL'],
  ['array', s => changeDeclaration(s, 'VAR_GLOBAL\n Ready : ARRAY[0..1] OF BOOL;\nEND_VAR'), 'VARIABLE_NOT_PLAIN_BOOL'],
  ['alias', s => changeDeclaration(s, 'VAR_GLOBAL\n Ready : MyBool;\nEND_VAR'), 'VARIABLE_NOT_PLAIN_BOOL'],
  ['shared declaration', s => changeDeclaration(s, 'VAR_GLOBAL\n Ready, Other : BOOL;\nEND_VAR'), 'VARIABLE_NOT_PLAIN_BOOL'],
  ['duplicate variable case', s => changeDeclaration(s, 'VAR_GLOBAL\n Ready : BOOL;\n READY : BOOL;\nEND_VAR'), 'VARIABLE_NOT_UNIQUE'],
  ['missing variable', s => changeDeclaration(s, 'VAR_GLOBAL\n Other : BOOL;\nEND_VAR'), 'VARIABLE_NOT_UNIQUE'],
  ['incomplete declaration', s => changeDeclaration(s, 'VAR_GLOBAL\n Ready : BOOL;'), 'DECLARATION_INCOMPLETE'],
  ['wrong Application', s => {s.root.ioApplicationId = 'other';}, 'APPLICATION_NOT_UNIQUE'],
  ['Application name ambiguity', s => {s.applications.push({...s.applications[0], guid: 'other', name: 'cellapp'});}, 'APPLICATION_OWNERSHIP'],
  ['GVL wrong parent', s => {s.gvls[0].parentGuid = 'other';}, 'GVL_OWNERSHIP_OR_NAME'],
  ['GVL name ambiguity', s => {s.gvls.push({...s.gvls[0], guid: 'other', name: 'signals'});}, 'GVL_OWNERSHIP_OR_NAME'],
  ['unverified connector app override', s => {s.connector.ioApplicationSet = true;}, 'APPLICATION_OVERRIDE_UNSUPPORTED'],
  ['occupied target', s => {s.channels[0].first = {state: 'value', value: 'CellApp.Signals.Other'};
    s.channels[0].mappings = [{expression: 'CellApp.Signals.Other'}];}, 'TARGET_ALREADY_MAPPED'],
  ['duplicate target case in another row', s => {s.channels[1].first = {state: 'value', value: 'cellapp.signals.ready'};
    s.channels[1].mappings = [{expression: 'cellapp.signals.ready'}];}, 'DUPLICATE_VARIABLE_OBSERVED'],
  ['unparseable other expression', s => {s.channels[1].first = {state: 'value', value: 'CellApp.Signals.Ready[0]'};
    s.channels[1].mappings = [{expression: 'CellApp.Signals.Ready[0]'}];}, 'DUPLICATE_SCAN_EXPRESSION_GAP'],
  ['missing list', s => {delete s.channels[0].mappings;}, 'MAPPING_LIST_INCOMPLETE'],
  ['incomplete list', s => {s.channels[0].complete = false;}, 'MAPPING_LIST_INCOMPLETE'],
  ['truncation', s => {s.coverage.truncated = true;}, 'LIST_COVERAGE_INCOMPLETE'],
  ['export missing', s => {s.coverage.exportComplete = false;}, 'LIST_COVERAGE_INCOMPLETE'],
  ['empty string differs from native null', s => {s.channels[0].first = {state: 'value', value: ''};}, 'GETTER_EXPORT_MISMATCH'],
  ['getter failure', s => {s.channels[0].first = {state: 'error', message: 'read failed'};}, 'FIELD_UNAVAILABLE'],
  ['address failure', s => {s.channels[0].automaticAddress = {state: 'error'};}, 'FIELD_UNAVAILABLE'],
  ['native bool type missing', s => {s.channels[0].type = {state: 'missing'};}, 'FIELD_UNAVAILABLE'],
  ['duplicate channel identity', s => {s.channels[1].key = {...s.channels[0].key};}, 'DUPLICATE_CHANNEL_IDENTITY'],
  ['default not native null', s => {s.channels[0].defaultVariable = {state: 'value', value: ''};}, 'EMPTY_DEFAULT_EVIDENCE'],
];
for (const [name, alter, expected] of cases) {
  test('reject ' + name, () => {
    const {state, target} = example();
    alter(state);
    const before = JSON.stringify(state);
    const answer = assess(state, target);
    assert.equal(answer.status, 'rejected');
    assert.equal(answer.code, expected);
    assert.equal(answer.writeAuthorized, false);
    assert.equal(JSON.stringify(state), before);
  });
}
test('old evidence fails for disk, declaration, list, or coverage changes', () => {
  for (const alter of [
    s => {s.diskHash = 'b'.repeat(64);},
    s => changeDeclaration(s, 'VAR_GLOBAL\n Ready : BOOL := TRUE;\nEND_VAR'),
    s => {s.channels.reverse();},
    s => {s.coverage.enumerationComplete = false;},
  ]) {
    const {state, target} = example();
    const oldVersion = evidenceVersion(state);
    alter(state);
    assert.equal(assess(state, target, oldVersion).code, 'EVIDENCE_CHANGED');
  }
});
test('channel restriction and evidence version are not inferred from display names', () => {
  const {state, target} = example();
  target.key = {...target.key, memberPath: ['Bit1']};
  assert.equal(assess(state, target).code, 'TARGET_SCOPE');
  const changed = example();
  changed.state.gvls[0].declaration += '\n';
  assert.equal(assess(changed.state, changed.target).code, 'DECLARATION_VERSION');
});

test('an occupied aggregate parent is rejected even when the selected member is empty', () => {
  const {state, target} = example();
  state.channels[1].key.memberPath = [];
  state.channels[1].first = {state: 'value', value: 'CellApp.Signals.WordValue'};
  state.channels[1].mappings = [{expression: 'CellApp.Signals.WordValue'}];
  assert.equal(assess(state, target).code, 'RELATED_PARAMETER_MAPPED');
});
