import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../src/index.mjs';
import { makeClock } from './helpers.mjs';

function fixed(options = {}) {
  const clock = makeClock(0);
  const limiter = createRateLimiter({
    algorithm: 'fixed-window',
    limit: 3,
    windowMs: 1000,
    now: clock.now,
    ...options
  });
  return { clock, limiter };
}

test('fixed-window allows up to the limit in one window', async () => {
  const { limiter } = fixed();
  assert.equal((await limiter.consume('a')).allowed, true);
  assert.equal((await limiter.consume('a')).allowed, true);
  assert.equal((await limiter.consume('a')).allowed, true);
  assert.equal((await limiter.consume('a')).allowed, false);
});

test('fixed-window resets sharply at the boundary', async () => {
  const { clock, limiter } = fixed();
  for (let index = 0; index < 3; index += 1) await limiter.consume('a');
  clock.set(999);
  assert.equal((await limiter.consume('a')).allowed, false);
  clock.set(1000);
  assert.equal((await limiter.consume('a')).allowed, true);
});

test('fixed-window explicit opt-in permits boundary burst doubling', async () => {
  const clock = makeClock(900);
  const limiter = createRateLimiter({ algorithm: 'fixed-window', limit: 3, windowMs: 1000, now: clock.now });
  for (let index = 0; index < 3; index += 1) assert.equal((await limiter.consume('a')).allowed, true);
  clock.set(1000);
  for (let index = 0; index < 3; index += 1) assert.equal((await limiter.consume('a')).allowed, true);
});

test('fixed-window reports remaining count exactly', async () => {
  const { limiter } = fixed({ limit: 5 });
  assert.equal((await limiter.consume('a')).remaining, 4);
  assert.equal((await limiter.consume('a', { cost: 2 })).remaining, 2);
  assert.equal((await limiter.consume('a', { cost: 2 })).remaining, 0);
});

test('fixed-window supports exact cost consumption', async () => {
  const { limiter } = fixed({ limit: 4 });
  const result = await limiter.consume('a', { cost: 4 });
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 0);
});

test('fixed-window cost above limit gets a stable code', async () => {
  const { limiter } = fixed({ limit: 2 });
  const result = await limiter.consume('a', { cost: 3 });
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'COST_EXCEEDS_LIMIT');
});

test('fixed-window retry-after ends at the window boundary', async () => {
  const clock = makeClock(250);
  const limiter = createRateLimiter({ algorithm: 'fixed-window', limit: 1, windowMs: 1000, now: clock.now });
  await limiter.consume('a');
  const denied = await limiter.consume('a');
  assert.equal(denied.resetAtMs, 1000);
  assert.equal(denied.retryAfterSeconds, 1);
});

test('fixed-window resetSeconds reaches zero at a fresh boundary', async () => {
  const clock = makeClock(1000);
  const limiter = createRateLimiter({ algorithm: 'fixed-window', limit: 1, windowMs: 1000, now: clock.now });
  const result = await limiter.consume('a');
  assert.equal(result.resetAtMs, 2000);
  assert.equal(result.resetSeconds, 1);
});

test('fixed-window peek does not consume', async () => {
  const { limiter } = fixed({ limit: 1 });
  assert.equal((await limiter.peek('a')).allowed, true);
  assert.equal((await limiter.consume('a')).allowed, true);
  assert.equal((await limiter.peek('a')).allowed, false);
});

test('fixed-window keys are independent', async () => {
  const { limiter } = fixed({ limit: 1 });
  await limiter.consume('a');
  assert.equal((await limiter.consume('b')).allowed, true);
});

test('fixed-window skips whole elapsed windows', async () => {
  const { clock, limiter } = fixed({ limit: 1 });
  await limiter.consume('a');
  clock.set(10 * 1000 + 5);
  assert.equal((await limiter.consume('a')).allowed, true);
});

test('fixed-window backward clock movement does not reset count', async () => {
  const clock = makeClock(2000);
  const limiter = createRateLimiter({ algorithm: 'fixed-window', limit: 1, windowMs: 1000, now: clock.now });
  await limiter.consume('a');
  clock.set(1500);
  assert.equal((await limiter.consume('a')).allowed, false);
});

test('fixed-window emits policy headers', async () => {
  const { limiter } = fixed({ limit: 7, windowMs: 5000 });
  const result = await limiter.consume('a');
  assert.equal(result.headers['RateLimit-Policy'], '7;w=5');
  assert.equal(result.headers.RateLimit, 'limit=7, remaining=6, reset=5');
});
