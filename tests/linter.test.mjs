import test from 'node:test';
import assert from 'node:assert/strict';
import { lintRateLimitConfig } from '../src/index.mjs';

function codes(input) {
  return lintRateLimitConfig(input).map((finding) => finding.code);
}

test('lintRateLimitConfig accepts a bounded production-style config', () => {
  const findings = lintRateLimitConfig({
    limit: 100,
    windowMs: 60000,
    maxKeys: 50000,
    trustedProxies: ['10.0.0.0/8'],
    ipv6Prefix: 64,
    onStoreError: 'deny'
  });
  assert.deepEqual(findings, []);
});

test('lintRateLimitConfig accepts a JSON string', () => {
  assert.deepEqual(lintRateLimitConfig('{"maxKeys":50000}'), []);
});

test('lintRateLimitConfig detects wildcard trusted proxies', () => {
  assert.ok(codes({ maxKeys: 1, trustedProxies: ['*'] }).includes('RATECAGE_TRUST_ALL_PROXIES'));
});

test('lintRateLimitConfig detects all keyword trusted proxies', () => {
  assert.ok(codes({ maxKeys: 1, trustedProxies: ['all'] }).includes('RATECAGE_TRUST_ALL_PROXIES'));
});

test('lintRateLimitConfig detects IPv4 trust-all CIDR', () => {
  assert.ok(codes({ maxKeys: 1, trustedProxies: ['0.0.0.0/0'] }).includes('RATECAGE_TRUST_ALL_PROXIES'));
});

test('lintRateLimitConfig detects IPv6 trust-all CIDR', () => {
  assert.ok(codes({ maxKeys: 1, trustedProxies: ['::/0'] }).includes('RATECAGE_TRUST_ALL_PROXIES'));
});

test('lintRateLimitConfig detects boolean trust-all configuration', () => {
  assert.ok(codes({ maxKeys: 1, trustedProxies: true }).includes('RATECAGE_TRUST_ALL_PROXIES'));
});

test('lintRateLimitConfig does not flag bounded trusted proxy CIDRs', () => {
  assert.equal(codes({ maxKeys: 1, trustedProxies: ['10.0.0.0/8', '2001:db8::/32'] }).includes('RATECAGE_TRUST_ALL_PROXIES'), false);
});

test('lintRateLimitConfig flags invalid trusted proxy entries', () => {
  assert.ok(codes({ maxKeys: 1, trustedProxies: ['bad'] }).includes('RATECAGE_INVALID_TRUSTED_PROXY'));
  assert.ok(codes({ maxKeys: 1, trustedProxies: [1] }).includes('RATECAGE_INVALID_TRUSTED_PROXY'));
});

test('lintRateLimitConfig flags a missing key cap', () => {
  assert.ok(codes({ limit: 10 }).includes('RATECAGE_MISSING_KEY_CAP'));
});

test('lintRateLimitConfig accepts nested store maxKeys', () => {
  assert.equal(codes({ store: { maxKeys: 1000 } }).includes('RATECAGE_MISSING_KEY_CAP'), false);
});

for (const maxKeys of [0, -1, null, false, Number.NaN, Number.POSITIVE_INFINITY, 'unbounded']) {
  test(`lintRateLimitConfig flags unbounded maxKeys ${String(maxKeys)}`, () => {
    assert.ok(codes({ maxKeys }).includes('RATECAGE_UNBOUNDED_STORE'));
  });
}

test('lintRateLimitConfig flags impractically large or fractional maxKeys', () => {
  assert.ok(codes({ maxKeys: 1.5 }).includes('RATECAGE_UNBOUNDED_STORE'));
  assert.ok(codes({ maxKeys: 1000001 }).includes('RATECAGE_UNBOUNDED_STORE'));
});

for (const prefix of [false, null, 128, '128']) {
  test(`lintRateLimitConfig flags IPv6 host bucket bypass ${String(prefix)}`, () => {
    assert.ok(codes({ maxKeys: 1, ipv6Prefix: prefix }).includes('RATECAGE_IPV6_HOST_BUCKET_BYPASS'));
  });
}

test('lintRateLimitConfig does not flag default or broader IPv6 bucketing', () => {
  assert.equal(codes({ maxKeys: 1, ipv6Prefix: 64 }).includes('RATECAGE_IPV6_HOST_BUCKET_BYPASS'), false);
  assert.equal(codes({ maxKeys: 1, ipv6Prefix: 48 }).includes('RATECAGE_IPV6_HOST_BUCKET_BYPASS'), false);
});

test('lintRateLimitConfig flags fail-open store policy', () => {
  assert.ok(codes({ maxKeys: 1, onStoreError: 'allow' }).includes('RATECAGE_FAIL_OPEN_STORE'));
});

test('lintRateLimitConfig flags failOpen true', () => {
  assert.ok(codes({ maxKeys: 1, failOpen: true }).includes('RATECAGE_FAIL_OPEN_STORE'));
});

test('lintRateLimitConfig flags nested fail-open store policy', () => {
  assert.ok(codes({ store: { maxKeys: 1, onStoreError: 'allow' } }).includes('RATECAGE_FAIL_OPEN_STORE'));
});

test('lintRateLimitConfig does not flag fail-closed policy', () => {
  assert.equal(codes({ maxKeys: 1, onStoreError: 'deny' }).includes('RATECAGE_FAIL_OPEN_STORE'), false);
});

test('lintRateLimitConfig flags excessive limits', () => {
  assert.ok(codes({ maxKeys: 1, limit: 100001 }).includes('RATECAGE_EXCESSIVE_WINDOW_OR_LIMIT'));
});

test('lintRateLimitConfig flags excessive windows in milliseconds', () => {
  assert.ok(codes({ maxKeys: 1, windowMs: 3600001 }).includes('RATECAGE_EXCESSIVE_WINDOW_OR_LIMIT'));
});

test('lintRateLimitConfig flags excessive windows in seconds', () => {
  assert.ok(codes({ maxKeys: 1, windowSeconds: 3601 }).includes('RATECAGE_EXCESSIVE_WINDOW_OR_LIMIT'));
});

test('lintRateLimitConfig reports invalid JSON as a finding', () => {
  assert.ok(codes('{').includes('RATECAGE_INVALID_JSON'));
});

test('lintRateLimitConfig reports non-object input as a finding', () => {
  assert.ok(codes([]).includes('RATECAGE_INVALID_CONFIG'));
  assert.ok(codes(null).includes('RATECAGE_INVALID_CONFIG'));
});

test('lintRateLimitConfig findings are frozen and complete', () => {
  const findings = lintRateLimitConfig({ trustedProxies: ['0.0.0.0/0'] });
  assert.equal(Object.isFrozen(findings), true);
  assert.equal(Object.isFrozen(findings[0]), true);
  for (const finding of findings) {
    assert.equal(typeof finding.code, 'string');
    assert.ok(finding.severity === 'error' || finding.severity === 'warning');
    assert.equal(typeof finding.path, 'string');
    assert.equal(typeof finding.message, 'string');
    assert.equal(typeof finding.recommendation, 'string');
  }
});

test('lintRateLimitConfig can report multiple independent footguns', () => {
  const result = codes({
    trustedProxies: ['0.0.0.0/0'],
    ipv6Prefix: 128,
    onStoreError: 'allow',
    limit: 1000000
  });
  for (const code of [
    'RATECAGE_TRUST_ALL_PROXIES',
    'RATECAGE_MISSING_KEY_CAP',
    'RATECAGE_IPV6_HOST_BUCKET_BYPASS',
    'RATECAGE_FAIL_OPEN_STORE',
    'RATECAGE_EXCESSIVE_WINDOW_OR_LIMIT'
  ]) {
    assert.ok(result.includes(code), code);
  }
});

test('lintRateLimitConfig flags a non-array trusted proxy type', () => {
  assert.ok(codes({ maxKeys: 1, trustedProxies: '10.0.0.0/8' }).includes('RATECAGE_INVALID_TRUSTED_PROXY'));
  assert.ok(codes({ maxKeys: 1, trustedProxies: 1 }).includes('RATECAGE_INVALID_TRUSTED_PROXY'));
});
