import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { CODE, RateCageError, createRateLimiter } from '../src/index.mjs';

const keyUnit = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789._-');
const safeKey = fc.string({ unit: keyUnit, minLength: 1, maxLength: 16 });
const controlCharacter = fc.constantFrom('\0', '\n', '\r', '\x1b', '\x7f');
const fuzzOptions = { seed: 20261127, numRuns: 90 };

function makeLimiter(limit) {
  return createRateLimiter({
    algorithm: 'sliding-window',
    limit,
    windowMs: 1000,
    now: () => 0
  });
}

test('fast-check valid keys can consume exactly up to the configured limit', async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 8 }), safeKey, async (limit, key) => {
    const limiter = makeLimiter(limit);
    for (let index = 0; index < limit; index += 1) {
      const result = await limiter.consume(key);
      assert.equal(result.allowed, true, 'valid request inside the limit was denied');
      assert.equal(result.code, 'OK');
      assert.equal(result.remaining, limit - index - 1);
    }
    const denied = await limiter.consume(key);
    assert.equal(denied.allowed, false, 'request beyond the limit was allowed');
    assert.equal(denied.code, 'RATE_LIMITED');
    assert.equal(denied.remaining, 0);
  }), fuzzOptions);
});

test('fast-check control-character key injection is always rejected as a typed invalid key', async () => {
  await fc.assert(fc.asyncProperty(safeKey, controlCharacter, safeKey, async (left, control, right) => {
    const limiter = makeLimiter(2);
    const hostileKey = left + control + right;
    await assert.rejects(
      () => limiter.consume(hostileKey),
      (error) => error instanceof RateCageError && error.code === CODE.INVALID_KEY
    );
  }), fuzzOptions);
});

test('fast-check cost above the configured limit is never consumed', async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 1, max: 10 }), safeKey, async (limit, extra, key) => {
    const limiter = makeLimiter(limit);
    const result = await limiter.consume(key, { cost: limit + extra });
    assert.equal(result.allowed, false);
    assert.equal(result.code, 'COST_EXCEEDS_LIMIT');
    const after = await limiter.peek(key);
    assert.equal(after.remaining, limit, 'rejected over-limit cost mutated bucket state');
  }), fuzzOptions);
});
