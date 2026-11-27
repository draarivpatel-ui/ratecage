import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as esm from '../src/index.mjs';

const require = createRequire(import.meta.url);
const cjs = require('../dist/index.cjs');

const expectedExports = [
  'CODE',
  'RESULT_CODE',
  'DEFAULTS',
  'RateCageError',
  'normalizeIp',
  'parseCidr',
  'ipInCidr',
  'extractClientIp',
  'MemoryRateStore',
  'createRateLimitKey',
  'createRateLimiter',
  'createNodeRateLimitMiddleware',
  'createFetchRateLimitHandler',
  'lintRateLimitConfig',
  'createRateCage'
];

test('ESM export surface is complete', () => {
  for (const name of expectedExports) assert.equal(typeof esm[name] !== 'undefined', true, name);
  assert.equal(typeof esm.default, 'object');
});

test('CJS export surface is complete', () => {
  for (const name of expectedExports) assert.equal(typeof cjs[name] !== 'undefined', true, name);
  assert.equal(cjs.default, cjs);
});

test('ESM and CJS normalize IPv4-mapped IPv6 identically', () => {
  assert.equal(esm.normalizeIp('::ffff:192.0.2.1'), cjs.normalizeIp('::ffff:192.0.2.1'));
});

test('ESM and CJS canonicalize IPv6 identically', () => {
  const input = '2001:0db8:0000:0000:0000:0000:0000:0001';
  assert.equal(esm.normalizeIp(input), cjs.normalizeIp(input));
});

test('ESM and CJS parse CIDRs identically', () => {
  const left = esm.parseCidr('192.0.2.128/25');
  const right = cjs.parseCidr('192.0.2.128/25');
  assert.equal(left.network, right.network);
  assert.equal(left.prefix, right.prefix);
  assert.equal(left.family, right.family);
});

test('ESM and CJS match CIDRs identically', () => {
  assert.equal(esm.ipInCidr('192.0.2.1', '192.0.2.0/24'), cjs.ipInCidr('192.0.2.1', '192.0.2.0/24'));
  assert.equal(esm.ipInCidr('192.0.3.1', '192.0.2.0/24'), cjs.ipInCidr('192.0.3.1', '192.0.2.0/24'));
});

test('ESM and CJS extract client IPs identically', () => {
  const options = {
    socketIp: '10.0.0.1',
    xForwardedFor: '1.1.1.1, 198.51.100.20',
    trustedProxies: ['10.0.0.0/8']
  };
  assert.equal(esm.extractClientIp(options), cjs.extractClientIp(options));
});

test('ESM and CJS sliding-window behavior is identical', async () => {
  let esmNow = 0;
  let cjsNow = 0;
  const left = esm.createRateLimiter({ limit: 1, windowMs: 1000, now: () => esmNow });
  const right = cjs.createRateLimiter({ limit: 1, windowMs: 1000, now: () => cjsNow });
  assert.equal((await left.consume('a')).allowed, (await right.consume('a')).allowed);
  assert.equal((await left.consume('a')).allowed, (await right.consume('a')).allowed);
  esmNow = 1500;
  cjsNow = 1500;
  assert.equal((await left.consume('a')).allowed, (await right.consume('a')).allowed);
});

test('ESM and CJS token-bucket behavior is identical', async () => {
  const left = esm.createRateLimiter({ algorithm: 'token-bucket', capacity: 1, refillPerSecond: 1, now: () => 0 });
  const right = cjs.createRateLimiter({ algorithm: 'token-bucket', capacity: 1, refillPerSecond: 1, now: () => 0 });
  assert.equal((await left.consume('a')).allowed, (await right.consume('a')).allowed);
  assert.equal((await left.consume('a')).code, (await right.consume('a')).code);
});

test('ESM and CJS MemoryRateStore eviction behavior is identical', () => {
  for (const implementation of [esm, cjs]) {
    const store = new implementation.MemoryRateStore({ maxKeys: 1 });
    store.set('a', 1, 1000);
    store.set('b', 2, 1000);
    assert.equal(store.get('a'), undefined);
    assert.equal(store.get('b'), 2);
  }
});

test('ESM and CJS linter findings are identical', () => {
  const config = { trustedProxies: ['0.0.0.0/0'], ipv6Prefix: 128, onStoreError: 'allow' };
  assert.deepEqual(
    esm.lintRateLimitConfig(config).map((finding) => finding.code),
    cjs.lintRateLimitConfig(config).map((finding) => finding.code)
  );
});

test('ESM and CJS key hashing is identical', () => {
  const key = 'x'.repeat(500);
  assert.equal(esm.createRateLimitKey('api', key), cjs.createRateLimitKey('api', key));
});

test('ESM default export contains the named API', () => {
  assert.equal(esm.default.createRateLimiter, esm.createRateLimiter);
  assert.equal(esm.default.extractClientIp, esm.extractClientIp);
});

test('CJS errors carry the same code as ESM errors', () => {
  for (const implementation of [esm, cjs]) {
    try {
      implementation.normalizeIp('bad');
      assert.fail('expected throw');
    } catch (error) {
      assert.equal(error.code, 'ERR_RATECAGE_INVALID_IP');
    }
  }
});
