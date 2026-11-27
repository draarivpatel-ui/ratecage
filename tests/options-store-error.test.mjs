import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, MemoryRateStore } from '../src/index.mjs';
import { makeClock } from './helpers.mjs';

const invalidOptionSets = [
  [{ algorithm: 'leaky-bucket' }, /algorithm/],
  [{ algorithm: '' }, /algorithm/],
  [{ limit: 0 }, /limit/],
  [{ limit: -1 }, /limit/],
  [{ limit: 1.5 }, /limit/],
  [{ limit: Number.NaN }, /limit/],
  [{ windowMs: 0 }, /windowMs/],
  [{ windowMs: -1 }, /windowMs/],
  [{ windowMs: 1.5 }, /windowMs/],
  [{ capacity: 0 }, /capacity/],
  [{ capacity: 1.5 }, /capacity/],
  [{ refillPerSecond: 0 }, /refillPerSecond/],
  [{ refillPerSecond: -1 }, /refillPerSecond/],
  [{ refillPerSecond: Number.NaN }, /refillPerSecond/],
  [{ refillPerSecond: Number.POSITIVE_INFINITY }, /refillPerSecond/],
  [{ cost: 0 }, /cost/],
  [{ cost: -1 }, /cost/],
  [{ cost: 1.5 }, /cost/],
  [{ cost: Number.NaN }, /cost/],
  [{ namespace: '' }, /namespace/],
  [{ namespace: '-bad' }, /namespace/],
  [{ namespace: 'a'.repeat(33) }, /namespace/],
  [{ namespace: 'bad space' }, /namespace/],
  [{ store: null }, /store/],
  [{ store: {} }, /store/],
  [{ store: { get() {} } }, /store/],
  [{ now: 1 }, /now/],
  [{ onStoreError: 'open' }, /onStoreError/],
  [{ onStoreError: true }, /onStoreError/],
  [{ legacyHeaders: 1 }, /legacyHeaders/],
  [{ includeHeaders: 1 }, /includeHeaders/],
  [{ maxKeyLength: 103 }, /maxKeyLength/],
  [{ maxKeyLength: 1.5 }, /maxKeyLength/],
  [{ unknownOption: true }, /unknown/]
];

for (const [options, pattern] of invalidOptionSets) {
  test(`createRateLimiter rejects invalid option ${JSON.stringify(options)}`, () => {
    assert.throws(() => createRateLimiter(options), pattern);
  });
}

test('createRateLimiter accepts valid boundary options', () => {
  const limiter = createRateLimiter({
    algorithm: 'fixed-window',
    limit: 1,
    windowMs: 1,
    cost: 1,
    namespace: 'a',
    onStoreError: 'deny',
    legacyHeaders: false,
    includeHeaders: true,
    maxKeyLength: 104
  });
  assert.equal(limiter.config.limit, 1);
});

test('createRateLimiter rejects inherited option values', () => {
  const polluted = Object.create({ limit: 1 });
  assert.throws(() => createRateLimiter(polluted), /inherited/);
});

test('createRateLimiter rejects Object.prototype limit pollution', () => {
  const original = Object.prototype.limit;
  Object.prototype.limit = 1000000;
  try {
    assert.throws(() => createRateLimiter({}), /inherited/);
  } finally {
    if (original === undefined) delete Object.prototype.limit;
    else Object.prototype.limit = original;
  }
});

test('createRateLimiter freezes its public config', () => {
  const limiter = createRateLimiter({ limit: 2 });
  assert.equal(Object.isFrozen(limiter), true);
  assert.equal(Object.isFrozen(limiter.config), true);
  assert.throws(() => {
    limiter.config.limit = 1;
  }, TypeError);
});

function brokenStore() {
  return {
    get() {
      throw new Error('store unavailable');
    },
    set() {
      throw new Error('store unavailable');
    }
  };
}

test('store errors fail closed by default', async () => {
  const clock = makeClock(0);
  const limiter = createRateLimiter({ limit: 5, windowMs: 1000, now: clock.now, store: brokenStore() });
  const result = await limiter.consume('a');
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'STORE_ERROR');
  assert.equal(result.reason, 'store-error');
  assert.equal(result.retryAfterSeconds, 1);
  assert.equal(result.headers['Retry-After'], '1');
});

test('store errors can fail open only by explicit opt-in', async () => {
  const clock = makeClock(0);
  const limiter = createRateLimiter({
    limit: 5,
    windowMs: 1000,
    now: clock.now,
    store: brokenStore(),
    onStoreError: 'allow'
  });
  const result = await limiter.consume('a');
  assert.equal(result.allowed, true);
  assert.equal(result.code, 'STORE_ERROR');
  assert.equal(result.reason, 'store-error');
  assert.equal(result.remaining, 4);
});

test('peek observes the same store error policy', async () => {
  const closed = createRateLimiter({ store: brokenStore() });
  const open = createRateLimiter({ store: brokenStore(), onStoreError: 'allow' });
  assert.equal((await closed.peek('a')).allowed, false);
  assert.equal((await open.peek('a')).allowed, true);
});

function corruptStore(value) {
  return {
    async get() {
      return value;
    },
    async set() {
      return undefined;
    }
  };
}

const corruptStates = [
  null,
  1,
  'x',
  {},
  { v: 2, w: 0, p: 0, c: 0 },
  { v: 1, w: Number.NaN, p: 0, c: 0 },
  { v: 1, w: 0, p: -1, c: 0 },
  { v: 1, w: 0, p: 0, c: -1 }
];
for (const state of corruptStates) {
  test(`corrupt sliding-window store state fails closed ${JSON.stringify(state)}`, async () => {
    const limiter = createRateLimiter({ store: corruptStore(state), windowMs: 1000 });
    const result = await limiter.consume('a');
    assert.equal(result.allowed, false);
    assert.equal(result.code, 'STORE_ERROR');
  });
}

test('an async custom store without update is supported', async () => {
  const data = new Map();
  const store = {
    async get(key) {
      return data.get(key);
    },
    async set(key, value) {
      data.set(key, value);
    }
  };
  const clock = makeClock(0);
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now, store });
  assert.equal((await limiter.consume('a')).allowed, true);
  assert.equal((await limiter.consume('a')).allowed, false);
});

test('custom store state is serialized per key without update', async () => {
  const data = new Map();
  const store = {
    async get(key) {
      await new Promise((resolve) => setImmediate(resolve));
      return data.get(key);
    },
    async set(key, value) {
      await new Promise((resolve) => setImmediate(resolve));
      data.set(key, value);
    }
  };
  const limiter = createRateLimiter({ limit: 2, store });
  const results = await Promise.all(Array.from({ length: 5 }, () => limiter.consume('a')));
  assert.equal(results.filter((result) => result.allowed).length, 2);
});

test('MemoryRateStore is the default bounded store', () => {
  const limiter = createRateLimiter();
  assert.equal(limiter.config.store instanceof MemoryRateStore, true);
  assert.equal(limiter.config.store.maxKeys, 50000);
});

test('DEFAULTS exposes an empty frozen trusted proxy list', async () => {
  const { DEFAULTS } = await import('../src/index.mjs');
  assert.deepEqual(DEFAULTS.trustedProxies, []);
  assert.equal(Object.isFrozen(DEFAULTS.trustedProxies), true);
});

test('namespace separators are rejected so namespaces cannot collide', () => {
  assert.throws(() => createRateLimiter({ namespace: 'api:v1' }), /namespace/);
});
