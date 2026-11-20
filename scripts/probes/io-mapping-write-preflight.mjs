// Offline design examples only. Imports contain parsing/hashing, never an IDE adapter.
import {parseDeclaration, VARIABLE_PARSER_VERSION} from '../../dist/variables.js';
import {canonical, digest} from '../../dist/storage.js';

const GVL_TYPE = 'ffbfa93a-b94d-45fc-a329-229860183b1d';
const ZERO = '00000000-0000-0000-0000-000000000000';
const ident = value => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
const folded = value => value.toLowerCase();
const same = (a, b) => canonical(a) === canonical(b);

function requireEvidence(condition, code) {
  if (!condition) throw Object.assign(new Error(code), {code});
}

function unique(items, code) {
  requireEvidence(items.length === 1, code);
  return items[0];
}

function value(field) {
  requireEvidence(field && field.state === 'value', 'FIELD_UNAVAILABLE');
  return field.value;
}

function channelKey(row) {
  const key = row.key;
  requireEvidence(key && typeof key.deviceGuid === 'string' &&
    Number.isInteger(key.connectorId) && Number.isInteger(key.parameterId) &&
    Array.isArray(key.memberPath) && key.memberPath.every(ident), 'CHANNEL_IDENTITY');
  return canonical(key);
}

export function evidenceVersion(state) {
  return digest(canonical({rules: 'io-write-assessment-v1', parser: VARIABLE_PARSER_VERSION, state}));
}

export function assess(state, target, expectedVersion) {
  try {
    const version = evidenceVersion(state);
    requireEvidence(!expectedVersion || expectedVersion === version, 'EVIDENCE_CHANGED');
    requireEvidence(state.ideVersion === '1.9.1.6' && state.fileIdentity &&
      /^[0-9a-f]{64}$/.test(state.diskHash), 'PROJECT_IDENTITY');
    requireEvidence(same(state.root.description, [4102, '10f4 0002', '3.5.11.11']) &&
      same(state.module.description, [40600, '10F4 0600', '00.00.00.20']) &&
      state.module.parentGuid === state.root.guid, 'DEVICE_SCOPE');
    requireEvidence(state.connector.id === 2 && state.connector.ownerGuid === state.module.guid &&
      state.connector.interface === 'Common.inovance2', 'CONNECTOR_SCOPE');

    const app = unique(state.applications.filter(a => a.guid === state.root.ioApplicationId),
      'APPLICATION_NOT_UNIQUE');
    requireEvidence(state.root.ioApplicationSet === true && app.isApplication === true &&
      app.deviceGuid === state.root.guid && app.typeGuid && ident(app.name) &&
      state.applications.filter(a => folded(a.name) === folded(app.name)).length === 1,
      'APPLICATION_OWNERSHIP');
    for (const owner of [state.module, state.connector]) {
      requireEvidence(owner.ioApplicationSet === false && owner.ioApplicationId === ZERO,
        'APPLICATION_OVERRIDE_UNSUPPORTED');
    }
    const gvl = unique(state.gvls.filter(g => g.guid === target.gvlGuid), 'GVL_NOT_UNIQUE');
    requireEvidence(gvl.typeGuid === GVL_TYPE && gvl.parentGuid === app.guid &&
      same(gvl.path, [...app.path, gvl.name]) && ident(gvl.name) &&
      state.gvls.filter(g => g.parentGuid === app.guid && folded(g.name) === folded(gvl.name)).length === 1,
      'GVL_OWNERSHIP_OR_NAME');
    requireEvidence(typeof gvl.declaration === 'string' &&
      digest(gvl.declaration) === gvl.sourceVersion, 'DECLARATION_VERSION');
    const parsed = parseDeclaration(gvl.declaration, 'gvl', gvl.name);
    requireEvidence(parsed.complete && !parsed.excluded, 'DECLARATION_INCOMPLETE');
    requireEvidence(ident(target.variable), 'VARIABLE_NAME_UNSUPPORTED');
    const vars = parsed.rows.filter(r => r.category === 'variable');
    const variable = unique(vars.filter(v => folded(v.name) === folded(target.variable)),
      'VARIABLE_NOT_UNIQUE');
    requireEvidence(variable.section === 'VAR_GLOBAL' && variable.modifiers.length === 0 &&
      variable.typeRaw.toUpperCase() === 'BOOL' && variable.addressRaw === null &&
      variable.commentAssociation === 'single-name-declaration', 'VARIABLE_NOT_PLAIN_BOOL');
    const expression = [app.name, gvl.name, variable.name].join('.');

    requireEvidence(state.coverage.enumerationComplete === true &&
      state.coverage.exportComplete === true && state.coverage.truncated === false &&
      state.coverage.scope === 'selected-connector' &&
      state.coverage.observed === state.channels.length, 'LIST_COVERAGE_INCOMPLETE');
    const keys = state.channels.map(channelKey);
    requireEvidence(new Set(keys).size === keys.length, 'DUPLICATE_CHANNEL_IDENTITY');
    requireEvidence(target.key.deviceGuid === state.module.guid && target.key.connectorId === 2 &&
      target.key.parameterId === 13 && same(target.key.memberPath, ['Bit0']), 'TARGET_SCOPE');
    const selected = unique(state.channels.filter(row => channelKey(row) === canonical(target.key)),
      'TARGET_NOT_UNIQUE');
    requireEvidence(selected.nativeName === 'InputData' && selected.memberIdentifier === 'Bit0' &&
      value(selected.direction) === 'Input' && value(selected.type) === 'BOOL' &&
      value(selected.bits) === 1, 'CHANNEL_TYPE_OR_DIRECTION');
    requireEvidence(typeof value(selected.automaticAddress) === 'boolean' &&
      typeof value(selected.manualAddress) === 'string', 'ADDRESS_EVIDENCE');

    for (const row of state.channels) {
      requireEvidence(row.complete === true && Array.isArray(row.mappings), 'MAPPING_LIST_INCOMPLETE');
      requireEvidence(row.key.deviceGuid === state.module.guid && row.key.connectorId === 2,
        'CHANNEL_OWNERSHIP');
      const getter = row.first;
      requireEvidence(getter && ['null', 'value'].includes(getter.state) &&
        (getter.state !== 'null' || getter.value === null), 'FIELD_UNAVAILABLE');
      if (row.mappings.length === 0) {
        requireEvidence(getter.state === 'null' && row.emptySentinelConfirmed === true,
          'GETTER_EXPORT_MISMATCH');
      } else {
        requireEvidence(getter.state === 'value' && typeof getter.value === 'string' &&
          getter.value === row.mappings[0].expression, 'GETTER_EXPORT_MISMATCH');
      }
    }
    requireEvidence(selected.mappings.length === 0, 'TARGET_ALREADY_MAPPED');
    for (const row of state.channels) {
      const path = row.key.memberPath;
      const isAncestor = path.length < target.key.memberPath.length &&
        path.every((part, index) => part === target.key.memberPath[index]);
      if (row.key.parameterId === target.key.parameterId && isAncestor) {
        requireEvidence(row.mappings.length === 0, 'RELATED_PARAMETER_MAPPED');
      }
    }
    requireEvidence(selected.defaultVariable.state === 'null' &&
      selected.defaultVariable.value === null, 'EMPTY_DEFAULT_EVIDENCE');
    for (const row of state.channels) {
      for (const mapping of row.mappings) {
        requireEvidence(typeof mapping.expression === 'string', 'MAPPING_EXPRESSION_UNAVAILABLE');
        const parts = mapping.expression.split('.');
        requireEvidence(parts.length === 3 && parts.every(ident), 'DUPLICATE_SCAN_EXPRESSION_GAP');
        requireEvidence(folded(mapping.expression) !== folded(expression), 'DUPLICATE_VARIABLE_OBSERVED');
      }
    }
    return {
      status: 'local-candidate', version, expression,
      declaration: {gvlGuid: gvl.guid, sourceVersion: gvl.sourceVersion,
        name: variable.name, position: variable.namePosition, basis: 'bounded-declaration-parser'},
      duplicateSearch: {scope: state.coverage.scope, examined: state.channels.length,
        result: 'not-found-in-examined-lists', applicationWide: false},
      writeAuthorized: false,
      directionBasis: 'installed-help-controller-perspective; native getter does not invert ChannelType',
      applicationSelection: {basis: 'archived-DriverInfo-fields', effectiveSelectionConfirmed: false},
      remainingEvidence: ['effective-io-application-selection', 'application-wide-duplicate-source-coverage',
        'input-variable-program-write-coverage'],
    };
  } catch (error) {
    return {status: 'rejected', code: error.code ?? 'EVIDENCE_MALFORMED', writeAuthorized: false};
  }
}
