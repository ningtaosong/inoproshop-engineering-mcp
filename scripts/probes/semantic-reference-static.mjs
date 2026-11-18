// Disposable fixture analysis. Uses existing read-only lexer and declaration parser.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [dist, input, output] = process.argv.slice(2);
const load = file => JSON.parse(readFileSync(file, 'utf8'));
const fromDist = file => import(pathToFileURL(join(dist, file)).href);
const [{ lexSt }, { parseDeclaration, declarationPosition }, { searchResult }, { codeHash }, { VERSION, schemas }] =
  await Promise.all(['st-lex.js', 'variables.js', 'queries.js', 'storage.js', 'contracts.js'].map(fromDist));
assert.equal(VERSION, '0.29.0');
assert.equal(Object.keys(schemas).length, 32);
const spec = load(new URL('./semantic-reference-fixture.json', import.meta.url));
const key = name => name.toLowerCase();
const idName = /^[A-Za-z_][A-Za-z0-9_]*$/;
const objectName = obj => obj.path.at(-1);
const byUniqueName = (rows, name, value) => {
  const found = rows.filter(row => key(value(row)) === key(name));
  return found.length === 1 ? found[0] : undefined;
};

function synthetic() {
  const prefix = ['Fixture', 'Application'];
  const applicationId = 'offline-application-fixture';
  const corpus = Object.entries(spec.fixture).map(([name, obj]) => ({
    objectId: 'offline-' + name, applicationId, path: [...prefix, name], objectType: obj.kind,
    hasImplementation: obj.kind === 'st_pou', declaration: obj.declaration,
    implementation: obj.implementation, contentHash: codeHash(obj.declaration, obj.implementation)
  }));
  return { status: 'succeeded', data: { corpus, applicationId, projectId: 'offline-fixture',
    projectPath: 'offline-fixture-only', diskHash: null, targetKind: 'application',
    scope: { applicationPath: prefix, readObjects: corpus.length, eligibleObjects: corpus.length,
      enumerationFailures: [], readFailures: [], skippedObjects: [], treeComplete: true, coverageComplete: true }
  } };
}

const real = input !== '--fixture-only';
const savedRead = real ? load(input) : null;
if (real) {
  assert.equal(savedRead.mode, 'read');
  assert.equal(savedRead.status, 'succeeded');
  assert.equal(savedRead.saveAttempted, false);
  assert.equal(savedRead.diskBefore, savedRead.diskAfter);
}
const raw = savedRead?.evidence.sourceInventory ?? synthetic();
const data = raw.data;
assert.equal(data.scope.applicationPath.length > 0, true);
const args = { projectId: data.projectId, applicationId: data.applicationId, targetKind: 'application',
  query: 'DelayTime', areas: ['declaration', 'implementation'], caseSensitive: false, offset: 0, limit: 100, maxResults: 1000 };
const identifier = searchResult(raw, { ...args, matchMode: 'identifier' }).data;
const literal = searchResult(raw, { ...args, matchMode: 'literal' }).data;
assert.equal(identifier.page.truncated, false);
assert.equal(literal.page.truncated, false);

const required = Object.entries(spec.fixture).map(([name, expected]) => {
  const object = byUniqueName(data.corpus, name, objectName);
  assert(object, `Missing or ambiguous object ${name}`);
  assert.equal(object.applicationId, data.applicationId);
  assert.deepEqual(object.path, [...data.scope.applicationPath, name]);
  assert.equal(object.objectType, expected.kind);
  assert.equal(object.declaration, expected.declaration);
  assert.equal(object.implementation, expected.implementation);
  if (real) assert.deepEqual(object, savedRead.evidence.objects[name]);
  return object;
});
// The prototype analyzes only this three-object, one-Application fixture.
// Do not treat excluded engineering objects as if they were covered.
assert.equal(data.corpus.length, required.length);
const scopes = new Map(required.map(object => {
  const parsed = parseDeclaration(object.declaration, object.objectType, objectName(object));
  const rows = parsed.rows.filter(r => ['variable', 'type-field'].includes(r.category));
  assert(parsed.complete && rows.length === parsed.rows.length);
  assert(rows.every(row => row.addressRaw == null && row.modifiers.length === 0 && row.commentAssociation === 'single-name-declaration'));
  assert.equal(new Set(rows.map(row => key(row.name))).size, rows.length);
  return [object.objectId, rows];
}));

function declared(object, name, section) {
  return byUniqueName(scopes.get(object.objectId).filter(row => row.section === section), name, row => row.name);
}

function target(object, row) {
  return { applicationId: object.applicationId, objectId: object.objectId, object: objectName(object),
    objectPath: object.path, contentHash: object.contentHash, region: 'declaration',
    scope: row.section, name: row.name, position: row.namePosition };
}

const unknown = reason => ({ classification: 'unknown', reason });
const infer = (object, row, rule) => row ? { classification: 'inferred', target: target(object, row), rule } : unknown('No unique declaration in the supported scope');

function resolveInSubset(program, tokens) {
  const identifiers = tokens.length > 0 && tokens.filter((_, i) => i % 2 === 0).every(token => token.id && idName.test(token.text));
  if (identifiers && tokens.length === 1) return infer(program, declared(program, tokens[0].text, 'VAR'), 'plain-program-local');
  if (!identifiers || tokens.length !== 3 || tokens[1].text !== '.')
    return unknown('Expression outside the bounded simple-name or direct-member grammar');
  const [base, , member] = tokens;
  const local = declared(program, base.text, 'VAR');
  const gvl = byUniqueName(required.filter(obj => obj.objectType === 'gvl'), base.text, objectName);
  if (gvl && local) return unknown('Qualifier has both local and application-GVL meanings');
  if (gvl) return infer(gvl, declared(gvl, member.text, 'VAR_GLOBAL'), 'explicit-application-root-gvl');
  if (!local || !idName.test(local.typeRaw)) return unknown('Member owner is not a directly declared scalar named structure');
  const type = byUniqueName(required.filter(obj => obj.objectType === 'structure'), local.typeRaw, objectName);
  return type ? infer(type, declared(type, member.text, 'STRUCT'), 'direct-member-of-unique-local-structure-type')
    : unknown('Instance type is not a unique supported structure');
}

function implementationEvidence(object, offset) {
  const source = object.implementation;
  const { tokens, comments, error } = lexSt(source, true);
  const inToken = token => token.start <= offset && offset < token.end;
  if (comments.some(inToken)) return { classification: 'non-reference', rule: 'comment-token' };
  const item = tokens.find(inToken);
  if (item && /^['"]/.test(item.text)) return { classification: 'non-reference', rule: 'string-literal-token' };
  if (error || !item?.id) return unknown('No complete identifier token at this position');
  const index = tokens.indexOf(item);
  const first = tokens.slice(0, index).findLastIndex(token => token.text === ';') + 1;
  const end = tokens.findIndex((token, i) => i >= index && token.text === ';');
  if (end === -1) return unknown('No terminating statement boundary');
  const assignment = tokens.slice(first, end).findIndex(token => token.text === ':=') + first;
  if (assignment <= first || tokens.slice(assignment + 1, end).some(token => token.text === ':='))
    return unknown('Only one simple assignment per statement is supported');
  const operand = index < assignment ? tokens.slice(first, assignment) : tokens.slice(assignment + 1, end);
  if (item !== operand.at(-1)) return unknown('Only the final identifier in a direct operand is covered');
  return resolveInSubset(object, operand);
}

function offset(source, line, column) {
  return source.split('\n').slice(0, line - 1).reduce((n, part) => n + part.length + 1, 0) + column - 1;
}

function classify(obj, area, at) {
  if (area === 'implementation') return implementationEvidence(obj, at);
  const declarations = scopes.get(obj.objectId).filter(row => row.namePosition.startOffset === at);
  return declarations.length === 1 ? { classification: 'declaration', target: target(obj, declarations[0]), rule: 'declaration-parse-only' }
    : unknown('Not the start of a uniquely parsed declaration');
}

const result = spec.expected.map(expect => {
  const object = byUniqueName(required, expect.object, objectName);
  const source = object[expect.region];
  const at = offset(source, expect.line, expect.column);
  assert.equal(source.slice(at, at + 9).toLowerCase(), 'delaytime', JSON.stringify(expect));
  const isMatch = ({ objectId, region, position }) => objectId === object.objectId && region === expect.region && position.startOffset === at;
  const outcome = classify(object, expect.region, at);
  assert.equal(outcome.classification, expect.staticExpected, JSON.stringify(expect));
  if (outcome.target) assert.equal(`${outcome.target.object}.${outcome.target.name}`, expect.expected.split('（')[0]);
  const hasIdentifier = identifier.matches.some(isMatch);
  assert.equal(hasIdentifier, !['comment', 'string'].includes(expect.role));
  assert(literal.matches.some(isMatch));
  return { ...expect, objectId: object.objectId, objectPath: object.path, sourceHash: object.contentHash,
    position: declarationPosition(source, at, at + 9), nativeBinding: 'not-established',
    identifierTokenHit: hasIdentifier, literalHit: true, staticEvidence: outcome };
});
assert.equal(result.filter(row => row.identifierTokenHit).length, identifier.matches.length);
assert.equal(result.length, literal.matches.length);
const neverUsed = searchResult(raw, { ...args, matchMode: 'identifier', query: 'NeverUsed', areas: ['implementation'] }).data;
assert.equal(neverUsed.matches.length, 0);
const local = result.filter(row => row.staticEvidence.classification === 'inferred' && row.staticEvidence.target.object === 'PLC_PRG');
assert.deepEqual(local.map(row => row.line), [1, 2]);

// Explicit falsifiers: an unknown member and array indexing stay unbound.
const program = byUniqueName(required, 'PLC_PRG', objectName);
for (const source of ['Seen := Config.missing;', 'Seen := Configs[1].DelayTime;', 'Seen := Unknown.DelayTime;',
  'Seen := DelayTime + 1;', "Seen := 'unclosed DelayTime"]) {
  const token = source.toLowerCase().lastIndexOf(source.includes('missing') ? 'missing' : 'delaytime');
  assert.equal(implementationEvidence({ ...program, implementation: source }, token).classification, 'unknown');
}
const evidence = { source: real ? 'read-only native source read-back' : 'offline fixture source only',
  identity: { projectPath: data.projectPath, diskHash: data.diskHash, applicationId: data.applicationId,
    applicationPath: data.scope.applicationPath, snapshot: savedRead?.evidence.snapshot ?? null },
  sourceInventoryScope: data.scope, identifierVersion: identifier.lexerVersion,
  counts: { identifierHits: identifier.matches.length, literalHits: literal.matches.length, nativeBindings: 0, staticLocalUsages: local.length },
  emptyControl: { query: 'NeverUsed', areas: ['implementation'], result: neverUsed.noMatchConclusion,
    lexicalCoverage: neverUsed.lexicalCoverage, conclusion: 'No identifier token in the covered implementation; other engineering surfaces are not covered' },
  results: result };
writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(evidence.counts));
