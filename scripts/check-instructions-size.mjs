// Static check of this repository's simple, single-client YAML patch template.
// Not a general YAML parser; no DSH/server/IDE startup and no instruction truncation.
import {readFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = {instructions: resolve(repo, 'instructions/inoproshop-workflow.md'),
  config: resolve(repo, 'config/dsh.example.patch.yml')};
try {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || !Object.hasOwn(options, key) || !args[i+1])
      throw new Error('Usage: node scripts/check-instructions-size.mjs [--instructions path] [--config path]');
    options[key] = resolve(args[i+1]);
  }
  const decode = p => new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(readFileSync(p));
  const template = decode(options.config);
  if (template.includes('\t')) throw new Error('Template indentation must use spaces');
  const lines = template.split(/\r?\n/).filter(l => l.trim() && !l.trimStart().startsWith('#'));
  const indent = l => l.length - l.trimStart().length;
  const clients = lines.map((l, i) => /^\s*name:\s*['"]?@deepseek-ai\/dsh-mcp-client['"]?\s*$/.test(l) ? i : -1).filter(i => i >= 0);
  if (clients.length !== 1) throw new Error('Expected exactly one DSH MCP Client in the template');
  const start = clients[0]+1;
  if (lines[start]?.trim() !== 'config:') throw new Error('Expected client config mapping after name');
  const configIndent = indent(lines[start]), fieldIndent = indent(lines[start+1] ?? '');
  if (fieldIndent <= configIndent) throw new Error('Missing client config fields');
  const fields = new Map();
  for (let i = start+1; i < lines.length && indent(lines[i]) > configIndent; i++) {
    if (indent(lines[i]) !== fieldIndent) continue; // Nested env is not client configuration.
    const m = lines[i].trim().match(/^(\w+):\s*(.*?)\s*$/);
    if (!m || fields.has(m[1])) throw new Error('Invalid/duplicate client config field');
    fields.set(m[1], m[2]);
  }
  const scalar = s => s?.replace(/^(['"])(.*)\1$/, '$2');
  const serverName = scalar(fields.get('serverName'));
  if (!/^[A-Za-z0-9_-]+$/.test(serverName ?? '')) throw new Error('Expected literal serverName');
  if (scalar(fields.get('transport')) !== 'stdio') throw new Error('Expected stdio template');
  const value = fields.get('maxInstructionBytes');
  if (!/^\d+$/.test(value ?? '')) throw new Error('Explicit positive integer maxInstructionBytes required at client config level');
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid maxInstructionBytes');
  const original = decode(options.instructions), serverText = original.trimEnd();
  // Matches installed dsh-mcp-client 0.2.0-rc.2: literal attribution then Buffer.byteLength.
  const attributed = serverText ? `### MCP server: ${serverName}\n\n${serverText}` : '';
  const fileBytes = Buffer.byteLength(original, 'utf8'), attributedBytes = Buffer.byteLength(attributed, 'utf8');
  const passed = fileBytes <= limit && attributedBytes <= limit;
  console.log(JSON.stringify({passed, instructions: options.instructions, config: options.config,
    fileBytes, trimmedServerBytes: Buffer.byteLength(serverText, 'utf8'), attributedBytes,
    maxInstructionBytes: limit, remainingBytes: limit - Math.max(fileBytes, attributedBytes),
    scope: 'Static template/UTF-8 check only; not DSH connection or model adherence evidence',
    ...(passed ? {} : {error: 'Instructions exceed configured DSH limit; rejected without truncation'})}, null, 2));
  if (!passed) process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({passed: false, error: e.message}, null, 2));
  process.exitCode = 1;
}
