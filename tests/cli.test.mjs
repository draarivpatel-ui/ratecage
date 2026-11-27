import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'ratecage.mjs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ratecage-cli-test-'));
after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function cli(args, options = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    ...options
  });
}

function configFile(name, content) {
  const file = path.join(tempRoot, name);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

test('CLI help exits zero', () => {
  const result = cli(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /lint-config/);
  assert.match(result.stdout, /check-ip/);
});

test('CLI version exits zero', () => {
  const result = cli(['--version']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ratecage 1\.0\.0/);
});

test('CLI unknown command exits two', () => {
  const result = cli(['wat']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown command/);
});

test('CLI check-ip requires --socket', () => {
  const result = cli(['check-ip']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /requires --socket/);
});

test('CLI check-ip ignores XFF by default', () => {
  const result = cli(['check-ip', '--socket', '203.0.113.10', '--xff', '1.1.1.1']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '203.0.113.10');
});

test('CLI check-ip resolves a client behind a trusted proxy', () => {
  const result = cli([
    'check-ip',
    '--socket', '10.0.0.1',
    '--xff', '198.51.100.20',
    '--trust', '10.0.0.0/8'
  ]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '198.51.100.20');
});

test('CLI check-ip prevents leftmost XFF spoofing', () => {
  const result = cli([
    'check-ip',
    '--socket', '10.0.0.1',
    '--xff', '1.1.1.1, 198.51.100.20',
    '--trust', '10.0.0.0/8'
  ]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '198.51.100.20');
});

test('CLI check-ip supports repeated trust flags', () => {
  const result = cli([
    'check-ip',
    '--socket', '192.0.2.1',
    '--xff', '198.51.100.20',
    '--trust', '10.0.0.0/8',
    '--trust', '192.0.2.0/24'
  ]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '198.51.100.20');
});

test('CLI check-ip buckets IPv6 clients by default', () => {
  const result = cli([
    'check-ip',
    '--socket', '10.0.0.1',
    '--xff', '2001:db8:abcd:1234::99',
    '--trust', '10.0.0.0/8'
  ]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '2001:db8:abcd:1234::');
});

test('CLI check-ip supports explicit IPv6 prefix', () => {
  const result = cli([
    'check-ip',
    '--socket', '10.0.0.1',
    '--xff', '2001:db8:abcd:1234::99',
    '--trust', '10.0.0.0/8',
    '--ipv6-prefix', '48'
  ]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '2001:db8:abcd::');
});

test('CLI check-ip JSON output is machine readable', () => {
  const result = cli(['check-ip', '--socket', '203.0.113.10', '--json']);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.ip, '203.0.113.10');
  assert.equal(output.socketIp, '203.0.113.10');
});

test('CLI check-ip rejects invalid socket IP', () => {
  const result = cli(['check-ip', '--socket', 'bad']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /IP address|invalid/i);
});

test('CLI check-ip rejects invalid IPv6 prefix', () => {
  const result = cli(['check-ip', '--socket', '203.0.113.10', '--ipv6-prefix', '129']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /ipv6-prefix/);
});

test('CLI check-ip rejects unknown flags', () => {
  const result = cli(['check-ip', '--socket', '203.0.113.10', '--bogus']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown flag/);
});

test('CLI lint-config requires --config', () => {
  const result = cli(['lint-config']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /requires --config/);
});

test('CLI lint-config exits zero for a bounded config', () => {
  const file = configFile('clean.json', JSON.stringify({ maxKeys: 50000, limit: 100, windowMs: 60000 }));
  const result = cli(['lint-config', '--config', file]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /no ratecage findings/);
});

test('CLI lint-config exits one for findings', () => {
  const file = configFile('bad.json', JSON.stringify({ trustedProxies: ['0.0.0.0/0'] }));
  const result = cli(['lint-config', '--config', file]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /RATECAGE_TRUST_ALL_PROXIES/);
});

test('CLI lint-config JSON output includes finding objects', () => {
  const file = configFile('bad-json-output.json', JSON.stringify({ onStoreError: 'allow' }));
  const result = cli(['lint-config', '--config', file, '--json']);
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.ok(output.findings.some((finding) => finding.code === 'RATECAGE_FAIL_OPEN_STORE'));
});

test('CLI lint-config warning-only findings also exit one', () => {
  const file = configFile('warning.json', JSON.stringify({ limit: 100 }));
  const result = cli(['lint-config', '--config', file]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /RATECAGE_MISSING_KEY_CAP/);
});

test('CLI lint-config rejects invalid JSON', () => {
  const file = configFile('invalid.json', '{');
  const result = cli(['lint-config', '--config', file]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not valid JSON/);
});

test('CLI lint-config rejects a missing file', () => {
  const result = cli(['lint-config', '--config', path.join(tempRoot, 'missing.json')]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /cannot be read/);
});

test('CLI lint-config rejects a directory', () => {
  const result = cli(['lint-config', '--config', tempRoot]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /regular file/);
});

test('CLI lint-config rejects oversized files', () => {
  const file = configFile('oversized.json', ' '.repeat(1024 * 1024 + 1));
  const result = cli(['lint-config', '--config', file]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /too large/);
});

test('CLI lint-config rejects symbolic links', { skip: process.platform === 'win32' }, () => {
  const target = configFile('symlink-target.json', '{"maxKeys":50000}');
  const link = path.join(tempRoot, 'linked-config.json');
  fs.symlinkSync(target, link);
  const result = cli(['lint-config', '--config', link]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /symbolic link/);
});

test('CLI lint-config rejects FIFOs without blocking', { skip: process.platform === 'win32' }, () => {
  const fifo = path.join(tempRoot, 'config.fifo');
  const mkfifo = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
  assert.equal(mkfifo.status, 0);
  const result = cli(['lint-config', '--config', fifo]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /regular file/);
});

test('CLI errors neutralize ANSI control characters in paths', () => {
  const result = cli(['lint-config', '--config', 'bad-\x1b[31m-path.json']);
  assert.equal(result.status, 2);
  assert.equal(result.stderr.includes('\x1b'), false);
});

test('CLI lint-config rejects unknown flags', () => {
  const file = configFile('clean2.json', '{"maxKeys":50000}');
  const result = cli(['lint-config', '--config', file, '--bogus']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown flag/);
});

test('CLI lint-config rejects duplicate config flags', () => {
  const file = configFile('clean3.json', '{"maxKeys":50000}');
  const result = cli(['lint-config', '--config', file, '--config', file]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /duplicate flag/);
});
