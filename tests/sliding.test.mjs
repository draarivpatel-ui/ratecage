import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRateLimitKey, createRateLimiter, MemoryRateStore } from '../src/index.mjs';
import { makeClock } from './helpers.mjs';

function sliding(options = {}) {
  const clock = makeClock(0);
  const limiter = createRateLimiter({
    algorithm: 'sliding-window',
    limit: 3,
    windowMs: 1000,
    now: clock.now,
    ...options
  });
  return { clock, limiter };
}

test('sliding-window is the default algorithm', async () => {
  const clock = makeClock(0);
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now });
  assert.equal(limiter.config.algorithm, 'sliding-window');
  assert.equal((await limiter.consume('a')).allowed, true);
  assert.equal((await limiter.consume('a')).allowed, false);
});

test('sliding-window allows requests up to the limit', async () => {
  const { limiter } = sliding();
  assert.equal((await limiter.consume('a')).allowed, true);
  assert.equal((await limiter.consume('a')).allowed, true);
  assert.equal((await limiter.consume('a')).allowed, true);
});

test('sliding-window denies the request beyond the limit', async () => {
  const { limiter } = sliding();
  await limiter.consume('a');
  await limiter.consume('a');
  await limiter.consume('a');
  const denied = await limiter.consume('a');
  assert.equal(denied.allowed, false);
  assert.equal(denied.code, 'RATE_LIMITED');
  assert.equal(denied.remaining, 0);
  assert.ok(denied.retryAfterSeconds >= 1);
  assert.equal(denied.headers['Retry-After'], String(denied.retryAfterSeconds));
});

test('sliding-window does not reset completely at the first window boundary', async () => {
  const { clock, limiter } = sliding();
  await limiter.consume('a');
  await limiter.consume('a');
  await limiter.consume('a');
  clock.set(1000);
  assert.equal((await limiter.consume('a')).allowed, false);
});

test('sliding-window prevents fixed-window boundary burst doubling', async () => {
  const { clock, limiter } = sliding({ limit: 4, windowMs: 1000 });
  clock.set(900);
  for (let index = 0; index < 4; index += 1) assert.equal((await limiter.consume('burst')).allowed, true);
  clock.set(1001);
  for (let index = 0; index < 4; index += 1) {
    assert.equal((await limiter.consume('burst')).allowed, false);
  }
});

test('sliding-window opens capacity gradually as the old window decays', async () => {
  const { clock, limiter } = sliding({ limit: 4, windowMs: 1000 });
  for (let index = 0; index < 4; index += 1) await limiter.consume('a');
  clock.set(1500);
  assert.equal((await limiter.consume('a')).allowed, true);
});

test('sliding-window still tracks newly consumed weight while old weight decays', async () => {
  const { clock, limiter } = sliding({ limit: 4, windowMs: 1000 });
  for (let index = 0; index < 4; index += 1) await limiter.consume('a');
  clock.set(1500);
  assert.equal((await limiter.consume('a')).allowed, true);
  assert.equal((await limiter.consume('a')).allowed, true);
  assert.equal((await limiter.consume('a')).allowed, false);
});

test('sliding-window fully resets after old state is two windows behind', async () => {
  const { clock, limiter } = sliding();
  for (let index = 0; index < 3; index += 1) await limiter.consume('a');
  clock.set(2000);
  assert.equal((await limiter.consume('a')).allowed, true);
  assert.equal((await limiter.consume('a')).allowed, true);
  assert.equal((await limiter.consume('a')).allowed, true);
  assert.equal((await limiter.consume('a')).allowed, false);
});

test('sliding-window keys are independent', async () => {
  const { limiter } = sliding({ limit: 1 });
  assert.equal((await limiter.consume('a')).allowed, true);
  assert.equal((await limiter.consume('b')).allowed, true);
  assert.equal((await limiter.consume('a')).allowed, false);
});

test('sliding-window supports cost greater than one', async () => {
  const { limiter } = sliding({ limit: 5 });
  const result = await limiter.consume('a', { cost: 3 });
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 2);
  assert.equal((await limiter.consume('a', { cost: 3 })).allowed, false);
});

test('sliding-window cost can consume the exact remaining capacity', async () => {
  const { limiter } = sliding({ limit: 5 });
  assert.equal((await limiter.consume('a', { cost: 2 })).remaining, 3);
  const exact = await limiter.consume('a', { cost: 3 });
  assert.equal(exact.allowed, true);
  assert.equal(exact.remaining, 0);
});

test('sliding-window cost above the limit is denied deterministically', async () => {
  const { limiter } = sliding({ limit: 2 });
  const result = await limiter.consume('a', { cost: 3 });
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'COST_EXCEEDS_LIMIT');
  assert.equal(result.reason, 'cost-exceeds-limit');
});

for (const cost of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5, '1', null]) {
  test(`sliding-window rejects invalid request cost ${String(cost)}`, async () => {
    const { limiter } = sliding();
    await assert.rejects(() => limiter.consume('a', { cost }), /cost/);
  });
}

test('sliding-window default cost is configurable', async () => {
  const { limiter } = sliding({ limit: 4, cost: 2 });
  assert.equal((await limiter.consume('a')).remaining, 2);
  assert.equal((await limiter.consume('a')).remaining, 0);
  assert.equal((await limiter.consume('a')).allowed, false);
});

test('sliding-window peek does not consume capacity', async () => {
  const { limiter } = sliding({ limit: 1 });
  assert.equal((await limiter.peek('a')).allowed, true);
  assert.equal((await limiter.peek('a')).allowed, true);
  assert.equal((await limiter.consume('a')).allowed, true);
  assert.equal((await limiter.peek('a')).allowed, false);
});

test('sliding-window check consumes like consume', async () => {
  const { limiter } = sliding({ limit: 1 });
  assert.equal((await limiter.check('a')).allowed, true);
  assert.equal((await limiter.check('a')).allowed, false);
});

test('sliding-window clock moving backwards does not erase state', async () => {
  const clock = makeClock(2000);
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now });
  assert.equal((await limiter.consume('a')).allowed, true);
  clock.set(1500);
  assert.equal((await limiter.consume('a')).allowed, false);
});

test('sliding-window result objects are frozen', async () => {
  const { limiter } = sliding();
  const result = await limiter.consume('a');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.headers), true);
  assert.throws(() => {
    result.allowed = false;
  }, TypeError);
  assert.throws(() => {
    result.headers.RateLimit = 'x';
  }, TypeError);
});

test('sliding-window emits IETF and legacy headers', async () => {
  const { limiter } = sliding({ limit: 3, windowMs: 1000 });
  const result = await limiter.consume('a');
  assert.equal(result.headers['RateLimit-Policy'], '3;w=1');
  assert.equal(result.headers.RateLimit, 'limit=3, remaining=2, reset=1');
  assert.equal(result.headers['X-RateLimit-Limit'], '3');
  assert.equal(result.headers['X-RateLimit-Remaining'], '2');
  assert.equal(result.headers['X-RateLimit-Reset'], '1');
});

test('sliding-window can disable legacy headers', async () => {
  const { limiter } = sliding({ legacyHeaders: false });
  const result = await limiter.consume('a');
  assert.equal(result.headers['X-RateLimit-Limit'], undefined);
  assert.equal(result.headers['RateLimit-Policy'], '3;w=1');
});

test('sliding-window can disable all generated headers', async () => {
  const { limiter } = sliding({ includeHeaders: false });
  const result = await limiter.consume('a');
  assert.deepEqual({ ...result.headers }, {});
});

test('sliding-window includes reset metadata', async () => {
  const { limiter } = sliding({ windowMs: 1000 });
  const result = await limiter.consume('a');
  assert.equal(result.resetAtMs, 1000);
  assert.equal(result.resetSeconds, 1);
});

test('sliding-window namespaces keys', async () => {
  const { limiter } = sliding({ namespace: 'api' });
  const result = await limiter.consume('user-1');
  assert.equal(result.key, 'api:user-1');
});

test('createRateLimitKey hashes oversized keys without truncation', () => {
  const raw = 'user-' + 'x'.repeat(500);
  const key = createRateLimitKey('api', raw, 256);
  const digest = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  assert.equal(key, 'api:sha256:' + digest);
  assert.ok(key.length <= 256);
});

test('createRateLimitKey reserves the hashed-key prefix against collisions', () => {
  const raw = 'user-' + 'x'.repeat(500);
  const digest = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  const oversizedBucket = createRateLimitKey('api', raw, 104);
  const craftedBucket = createRateLimitKey('api', 'sha256:' + digest, 104);
  assert.notEqual(craftedBucket, oversizedBucket);
  assert.equal(craftedBucket, createRateLimitKey('api', 'sha256:' + digest, 104));
});

test('oversized user keys share one deterministic hashed bucket', async () => {
  const { limiter } = sliding({ limit: 1, namespace: 'api' });
  const raw = 'user-' + 'x'.repeat(500);
  assert.equal((await limiter.consume(raw)).allowed, true);
  assert.equal((await limiter.consume(raw)).allowed, false);
});

test('sliding-window accepts dangerous object prototype names as keys', async () => {
  const { limiter } = sliding({ limit: 1 });
  for (const key of ['__proto__', 'constructor', 'toString']) {
    assert.equal((await limiter.consume(key)).allowed, true);
    assert.equal((await limiter.consume(key)).allowed, false);
  }
});

for (const key of ['', 'a\0b', 'a\nb', 'a\rb', 'a\tb']) {
  test(`sliding-window rejects dangerous key ${JSON.stringify(key)}`, async () => {
    const { limiter } = sliding();
    await assert.rejects(() => limiter.consume(key), /ERR_RATECAGE_INVALID_KEY|key/);
  });
}

test('sliding-window uses the supplied store', async () => {
  const clock = makeClock(0);
  const store = new MemoryRateStore({ now: clock.now, maxKeys: 10 });
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now, store });
  await limiter.consume('a');
  assert.equal(store.size, 1);
  assert.equal((await limiter.consume('a')).allowed, false);
});

test('sliding-window concurrent consumes are serialized per key', async () => {
  const { limiter } = sliding({ limit: 2 });
  const results = await Promise.all([
    limiter.consume('a'),
    limiter.consume('a'),
    limiter.consume('a'),
    limiter.consume('a')
  ]);
  assert.equal(results.filter((result) => result.allowed).length, 2);
  assert.equal(results.filter((result) => !result.allowed).length, 2);
});

test('raw keys over the hard input bound are rejected instead of hashed forever', async () => {
  const { limiter } = sliding();
  await assert.rejects(() => limiter.consume('x'.repeat(65537)), /maximum raw key size/);
});

test('moderately oversized keys are still hashed deterministically', () => {
  const raw = 'x'.repeat(1000);
  assert.equal(createRateLimitKey('api', raw), createRateLimitKey('api', raw));
});
