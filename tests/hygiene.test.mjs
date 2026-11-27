import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function walk(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.DS_Store') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(full));
    else if (entry.isFile()) output.push(full);
  }
  return output;
}

const files = walk(root);
const textFiles = files.filter((file) => !file.endsWith('.tgz'));

test('package has the required name version and license', () => {
  assert.equal(packageJson.name, 'ratecage');
  assert.equal(packageJson.version, '1.0.0');
  assert.equal(packageJson.license, 'MIT');
});

test('package has zero runtime dependencies and only the pinned fuzz development dependency', () => {
  assert.deepEqual(packageJson.dependencies, {});
  assert.deepEqual(Object.keys(packageJson.devDependencies), ['fast-check']);
  assert.match(packageJson.devDependencies['fast-check'], /^\d+\.\d+\.\d+$/);
});

test('package supports Node.js 18 and newer', () => {
  assert.equal(packageJson.engines.node, '>=18.0.0');
});

test('package points at the expected public repository metadata', () => {
  assert.equal(packageJson.repository.url, 'git+https://github.com/draarivpatel-ui/ratecage.git');
  assert.equal(packageJson.homepage, 'https://github.com/draarivpatel-ui/ratecage#readme');
  assert.equal(packageJson.bugs.url, 'https://github.com/draarivpatel-ui/ratecage/issues');
});

test('package exposes dual ESM and CJS entry points with types', () => {
  assert.equal(packageJson.main, './dist/index.cjs');
  assert.equal(packageJson.module, './src/index.mjs');
  assert.equal(packageJson.types, './types/index.d.ts');
  assert.equal(packageJson.exports['.'].import, './src/index.mjs');
  assert.equal(packageJson.exports['.'].require, './dist/index.cjs');
  assert.equal(packageJson.exports['.'].types, './types/index.d.ts');
});

test('package bin has no leading dot slash', () => {
  assert.equal(packageJson.bin.ratecage, 'bin/ratecage.mjs');
  assert.equal(packageJson.bin.ratecage.startsWith('./'), false);
});

test('package files whitelist is production-focused', () => {
  for (const required of ['src', 'dist', 'types', 'bin', 'docs', 'README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'LICENSE']) {
    assert.ok(packageJson.files.includes(required), required);
  }
  assert.equal(packageJson.files.includes('tests'), false);
});

test('package test command enumerates tests through the Windows-safe runner', () => {
  assert.equal(packageJson.scripts.test, 'node scripts/run-tests.mjs');
});

test('repository lockfile supports reproducible development installs', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages[''].dependencies, undefined);
  assert.deepEqual(Object.keys(lock.packages[''].devDependencies), ['fast-check']);
});

test('required community and documentation files exist', () => {
  for (const relative of [
    'README.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'LICENSE',
    'docs/GOOD_FIRST_ISSUES.md',
    '.github/workflows/ci.yml',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/ISSUE_TEMPLATE/bug_report.yml',
    '.github/ISSUE_TEMPLATE/feature_request.yml'
  ]) {
    assert.equal(fs.existsSync(path.join(root, relative)), true, relative);
  }
});

test('bin and scripts are executable where the filesystem supports modes', () => {
  if (process.platform !== 'win32') {
    for (const relative of ['bin/ratecage.mjs', 'scripts/build-cjs.mjs', 'scripts/run-tests.mjs']) {
      assert.ok((fs.statSync(path.join(root, relative)).mode & 0o111) !== 0, relative);
    }
  }
});

test('bin has a node shebang', () => {
  const first = fs.readFileSync(path.join(root, 'bin', 'ratecage.mjs'), 'utf8').split('\n', 1)[0];
  assert.equal(first, '#!/usr/bin/env node');
});

test('.gitattributes enforces LF text normalization', () => {
  const attributes = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
  assert.match(attributes, /^\* text=auto eol=lf/m);
  for (const pattern of ['*.mjs', '*.cjs', '*.js', '*.ts', '*.json', '*.md', '*.yml']) {
    assert.ok(attributes.includes(pattern + ' text eol=lf'), pattern);
  }
});

test('source, types, bin and generated CJS files exist', () => {
  for (const relative of ['src/index.mjs', 'dist/index.cjs', 'types/index.d.ts', 'bin/ratecage.mjs']) {
    assert.equal(fs.existsSync(path.join(root, relative)), true, relative);
  }
});

test('no text file contains CRLF line endings', () => {
  for (const file of textFiles) {
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(content.includes('\r'), false, path.relative(root, file));
  }
});

test('no text file contains em dash or en dash characters', () => {
  for (const file of textFiles) {
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(content.includes('\u2014'), false, path.relative(root, file));
    assert.equal(content.includes('\u2013'), false, path.relative(root, file));
  }
});

test('no text file contains local machine paths or private email markers', () => {
  for (const file of textFiles) {
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(content.includes('/' + 'Users/'), false, path.relative(root, file));
    assert.equal(content.includes('someone' + '@gmail.com'), false, path.relative(root, file));
    assert.equal(content.includes('handle-redacted286' + '@gmail.com'), false, path.relative(root, file));
  }
});

test('no text file contains NUL bytes', () => {
  for (const file of textFiles) {
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(content.includes('\0'), false, path.relative(root, file));
  }
});

test('test runner explicitly enumerates test files', () => {
  const runner = fs.readFileSync(path.join(root, 'scripts', 'run-tests.mjs'), 'utf8');
  assert.ok(runner.includes('fs.readdirSync'));
  assert.ok(runner.includes("'--test'"));
  assert.ok(runner.includes('process.execPath'));
});

test('CI covers Node 18, 20, 22 and 24 on Ubuntu and Windows', () => {
  const ci = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  for (const version of ['18', '20', '22', '24']) assert.ok(ci.includes(version), version);
  assert.ok(ci.includes('ubuntu-24.04'));
  assert.ok(ci.includes('windows-latest'));
  assert.ok(ci.includes('npm test'));
  assert.ok(ci.includes('node scripts/build-cjs.mjs --check'));
  assert.ok(ci.includes('npm pack --dry-run'));
});

test('type declarations expose the primary public API', () => {
  const types = fs.readFileSync(path.join(root, 'types', 'index.d.ts'), 'utf8');
  for (const name of ['extractClientIp', 'MemoryRateStore', 'createRateLimiter', 'createNodeRateLimitMiddleware', 'createFetchRateLimitHandler', 'lintRateLimitConfig']) {
    assert.ok(types.includes(name), name);
  }
});
