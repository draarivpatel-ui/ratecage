import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../src/index.mjs';
import { makeClock } from './helpers.mjs';

function bucket(options = {}) {
  const clock = makeClock(0);
  const limiter = createRateLimiter({
    algorithm: 'token-bucket',
    capacity: 5,
    refillPerSecond: 1,
    now: clock.now,
    ...options
  });
  return { clock, limiter };
}

test('token-bucket starts with a full capacity', async () => {
  const { limiter } = bucket();
  const result = await limiter.consume('a', { cost: 5 });
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 0);
});

test('token-bucket denies when tokens are exhausted', async () => {
  const { limiter } = bucket();
  await limiter.consume('a', { cost: 5 });
  const result = await limiter.consume('a');
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'RATE_LIMITED');
});

test('token-bucket refills continuously', async () => {
  const { clock, limiter } = bucket();
  await limiter.consume('a', { cost: 5 });
  clock.set(2000);
  assert.equal((await limiter.consume('a', { cost: 2 })).allowed, true);
});

test('token-bucket supports fractional refill rates', async () => {
  const { clock, limiter } = bucket({ capacity: 2, refillPerSecond: 0.5 });
  await limiter.consume('a', { cost: 2 });
  clock.set(1000);
  assert.equal((await limiter.consume('a')).allowed, false);
  clock.set(2000);
  assert.equal((await limiter.consume('a')).allowed, true);
});

test('token-bucket never refills above capacity', async () => {
  const { clock, limiter } = bucket({ capacity: 2, refillPerSecond: 100 });
  clock.set(10000);
  const result = await limiter.consume('a', { cost: 2 });
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 0);
});

test('token-bucket retry-after reflects fractional token debt', async () => {
  const { clock, limiter } = bucket({ capacity: 1, refillPerSecond: 0.5 });
  await limiter.consume('a');
  clock.set(500);
  const denied = await limiter.consume('a');
  assert.equal(denied.retryAfterSeconds, 2);
});

test('token-bucket cost above capacity gets a stable code', async () => {
  const { limiter } = bucket({ capacity: 2 });
  const result = await limiter.consume('a', { cost: 3 });
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'COST_EXCEEDS_LIMIT');
  assert.equal(result.retryAfterSeconds, 1);
});

test('token-bucket cost can equal capacity', async () => {
  const { limiter } = bucket({ capacity: 3 });
  assert.equal((await limiter.consume('a', { cost: 3 })).allowed, true);
});

test('token-bucket remaining is floored for fractional balances', async () => {
  const { clock, limiter } = bucket({ capacity: 2, refillPerSecond: 0.5 });
  await limiter.consume('a', { cost: 2 });
  clock.set(1000);
  const result = await limiter.peek('a');
  assert.equal(result.remaining, 0);
  clock.set(2000);
  assert.equal((await limiter.peek('a')).remaining, 1);
});

test('token-bucket peek does not consume tokens', async () => {
  const { limiter } = bucket({ capacity: 1 });
  assert.equal((await limiter.peek('a')).allowed, true);
  assert.equal((await limiter.consume('a')).allowed, true);
  assert.equal((await limiter.peek('a')).allowed, false);
});

test('token-bucket keys are independent', async () => {
  const { limiter } = bucket({ capacity: 1 });
  await limiter.consume('a');
  assert.equal((await limiter.consume('b')).allowed, true);
});

test('token-bucket backward clock movement does not create tokens', async () => {
  const clock = makeClock(5000);
  const limiter = createRateLimiter({ algorithm: 'token-bucket', capacity: 1, refillPerSecond: 1, now: clock.now });
  await limiter.consume('a');
  clock.set(1000);
  assert.equal((await limiter.consume('a')).allowed, false);
});

test('token-bucket resetAtMs is now when full', async () => {
  const { limiter } = bucket({ capacity: 2 });
  const result = await limiter.peek('a');
  assert.equal(result.resetAtMs, 0);
  assert.equal(result.resetSeconds, 0);
});

test('token-bucket resetAtMs estimates time to full capacity', async () => {
  const { limiter } = bucket({ capacity: 4, refillPerSecond: 2 });
  const result = await limiter.consume('a', { cost: 3 });
  assert.equal(result.resetAtMs, 1500);
});

test('token-bucket default refill derives from windowMs', async () => {
  const clock = makeClock(0);
  const limiter = createRateLimiter({
    algorithm: 'token-bucket',
    capacity: 4,
    windowMs: 2000,
    now: clock.now
  });
  await limiter.consume('a', { cost: 4 });
  clock.set(1000);
  assert.equal((await limiter.consume('a', { cost: 2 })).allowed, true);
});

test('token-bucket limit is reported as capacity', async () => {
  const { limiter } = bucket({ capacity: 9 });
  const result = await limiter.consume('a');
  assert.equal(result.limit, 9);
  assert.match(result.headers['RateLimit-Policy'], /^9;w=/);
});

test('token-bucket concurrent consumes are serialized', async () => {
  const { limiter } = bucket({ capacity: 2 });
  const results = await Promise.all([
    limiter.consume('a'),
    limiter.consume('a'),
    limiter.consume('a')
  ]);
  assert.equal(results.filter((result) => result.allowed).length, 2);
});

test('token-bucket backward clock movement does not create retroactive refill later', async () => {
  const clock = makeClock(5000);
  const limiter = createRateLimiter({ algorithm: 'token-bucket', capacity: 1, refillPerSecond: 1, now: clock.now });
  await limiter.consume('a');
  clock.set(1000);
  assert.equal((await limiter.consume('a')).allowed, false);
  clock.set(5001);
  assert.equal((await limiter.consume('a')).allowed, false);
  clock.set(6000);
  assert.equal((await limiter.consume('a')).allowed, true);
});
