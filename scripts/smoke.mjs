import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  createRateLimiter,
  extractClientIp,
  lintRateLimitConfig,
  normalizeIp
} from '../src/index.mjs';

const require = createRequire(import.meta.url);
const cjs = require('../dist/index.cjs');

assert.equal(normalizeIp('::ffff:192.0.2.1'), '192.0.2.1');
assert.equal(cjs.normalizeIp('::ffff:192.0.2.1'), '192.0.2.1');
assert.equal(
  extractClientIp({
    socketIp: '10.0.0.8',
    xForwardedFor: '198.51.100.20, 10.0.0.8',
    trustedProxies: ['10.0.0.0/8']
  }),
  '198.51.100.20'
);
let now = 0;
const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now });
assert.equal((await limiter.consume('smoke')).allowed, true);
assert.equal((await limiter.consume('smoke')).allowed, false);
assert.equal(cjs.lintRateLimitConfig({ maxKeys: 50000 }).length, 0);
assert.ok(lintRateLimitConfig({ trustedProxies: ['0.0.0.0/0'] }).some((finding) => finding.code === 'RATECAGE_TRUST_ALL_PROXIES'));
process.stdout.write('ratecage smoke ok\n');
