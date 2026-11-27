import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRateStore } from '../src/index.mjs';
import { makeClock } from './helpers.mjs';

test('MemoryRateStore stores and returns values', () => {
  const store = new MemoryRateStore();
  store.set('a', { c: 1 }, 1000);
  assert.deepEqual(store.get('a'), { c: 1 });
});

test('MemoryRateStore delete removes a key', () => {
  const store = new MemoryRateStore();
  store.set('a', { c: 1 }, 1000);
  assert.equal(store.delete('a'), true);
  assert.equal(store.get('a'), undefined);
  assert.equal(store.delete('a'), false);
});

test('MemoryRateStore clear removes all keys', () => {
  const store = new MemoryRateStore();
  store.set('a', 1, 1000);
  store.set('b', 2, 1000);
  store.clear();
  assert.equal(store.size, 0);
});

test('MemoryRateStore supports primitive values', () => {
  const store = new MemoryRateStore();
  for (const value of [1, 'x', true, null]) {
    store.set('key', value, 1000);
    assert.equal(store.get('key'), value);
  }
});

test('MemoryRateStore clone protects top-level caller object mutation', () => {
  const store = new MemoryRateStore();
  const value = { c: 1 };
  store.set('a', value, 1000);
  value.c = 99;
  assert.equal(store.get('a').c, 1);
});

test('MemoryRateStore clone protects caller mutation after read', () => {
  const store = new MemoryRateStore();
  store.set('a', { c: 1 }, 1000);
  const first = store.get('a');
  first.c = 99;
  assert.equal(store.get('a').c, 1);
});

test('MemoryRateStore update creates state', () => {
  const store = new MemoryRateStore();
  const result = store.update('a', (current) => {
    assert.equal(current, undefined);
    return { c: 2 };
  }, 1000);
  assert.deepEqual(result, { c: 2 });
  assert.deepEqual(store.get('a'), { c: 2 });
});

test('MemoryRateStore update receives cloned current state', () => {
  const store = new MemoryRateStore();
  store.set('a', { c: 1 }, 1000);
  store.update('a', (current) => {
    current.c = 99;
    return undefined;
  }, 1000);
  assert.equal(store.get('a'), undefined);
});

test('MemoryRateStore update undefined deletes state', () => {
  const store = new MemoryRateStore();
  store.set('a', { c: 1 }, 1000);
  const result = store.update('a', () => undefined, 1000);
  assert.equal(result, undefined);
  assert.equal(store.get('a'), undefined);
});

test('MemoryRateStore rejects undefined stored values', () => {
  const store = new MemoryRateStore();
  assert.throws(() => store.set('a', undefined, 1000), /undefined/);
});

const invalidKeys = [
  '',
  null,
  undefined,
  1,
  {},
  '\0',
  'a\0b',
  'a\nb',
  'a\rb',
  'a\tb',
  'a\x01b',
  'a\x1fb',
  'a\x7fb'
];
for (const key of invalidKeys) {
  test(`MemoryRateStore rejects invalid key ${JSON.stringify(key)}`, () => {
    const store = new MemoryRateStore();
    assert.throws(() => store.set(key, 1, 1000), /ERR_RATECAGE_INVALID_KEY|key/);
    assert.throws(() => store.get(key), /ERR_RATECAGE_INVALID_KEY|key/);
  });
}

test('MemoryRateStore enforces maxKeyLength in bytes', () => {
  const store = new MemoryRateStore({ maxKeyLength: 32 });
  assert.throws(() => store.set('x'.repeat(33), 1, 1000), /maxKeyLength/);
  store.set('x'.repeat(32), 1, 1000);
  assert.equal(store.get('x'.repeat(32)), 1);
});

test('MemoryRateStore counts unicode keys by UTF-8 bytes', () => {
  const store = new MemoryRateStore({ maxKeyLength: 32 });
  assert.throws(() => store.set('é'.repeat(17), 1, 1000), /maxKeyLength/);
  store.set('é'.repeat(16), 1, 1000);
  assert.equal(store.size, 1);
});

test('MemoryRateStore rejects invalid ttl values', () => {
  const store = new MemoryRateStore();
  for (const ttl of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '1000']) {
    assert.throws(() => store.set('a', 1, ttl), /ttlMs/);
  }
});

test('MemoryRateStore expires values with the injected clock', () => {
  const clock = makeClock(100);
  const store = new MemoryRateStore({ now: clock.now });
  store.set('a', 1, 1000);
  clock.advance(999);
  assert.equal(store.get('a'), 1);
  clock.advance(1);
  assert.equal(store.get('a'), undefined);
});

test('MemoryRateStore pruneExpired removes all expired entries', () => {
  const clock = makeClock(0);
  const store = new MemoryRateStore({ now: clock.now });
  store.set('a', 1, 10);
  store.set('b', 2, 20);
  store.set('c', 3, 30);
  clock.set(15);
  assert.equal(store.pruneExpired(), 1);
  assert.equal(store.get('a'), undefined);
  assert.equal(store.get('b'), 2);
});

test('MemoryRateStore opportunistic pruning is bounded but effective for oldest expired keys', () => {
  const clock = makeClock(0);
  const store = new MemoryRateStore({ now: clock.now, pruneScanLimit: 2 });
  store.set('a', 1, 10);
  store.set('b', 2, 10);
  store.set('c', 3, 1000);
  clock.set(20);
  assert.equal(store.pruneExpiredOpportunistic(), 2);
  assert.equal(store.size, 1);
});

test('MemoryRateStore rejects a broken clock', () => {
  const store = new MemoryRateStore({ now: () => Number.NaN });
  assert.throws(() => store.nowMs(), /clock/);
});

test('MemoryRateStore evicts least recently used keys', () => {
  const store = new MemoryRateStore({ maxKeys: 3 });
  store.set('a', 1, 10000);
  store.set('b', 2, 10000);
  store.set('c', 3, 10000);
  assert.equal(store.get('a'), 1);
  store.set('d', 4, 10000);
  assert.equal(store.get('b'), undefined);
  assert.equal(store.get('a'), 1);
  assert.equal(store.get('c'), 3);
  assert.equal(store.get('d'), 4);
});

test('MemoryRateStore updating an existing key refreshes LRU position', () => {
  const store = new MemoryRateStore({ maxKeys: 3 });
  store.set('a', 1, 10000);
  store.set('b', 2, 10000);
  store.set('c', 3, 10000);
  store.set('a', 10, 10000);
  store.set('d', 4, 10000);
  assert.equal(store.get('b'), undefined);
  assert.equal(store.get('a'), 10);
});

test('MemoryRateStore delete does not disturb other keys', () => {
  const store = new MemoryRateStore({ maxKeys: 2 });
  store.set('a', 1, 10000);
  store.set('b', 2, 10000);
  store.delete('a');
  store.set('c', 3, 10000);
  assert.equal(store.get('b'), 2);
  assert.equal(store.get('c'), 3);
});

test('MemoryRateStore bounds ten thousand rotating keys', () => {
  const store = new MemoryRateStore({ maxKeys: 100 });
  for (let index = 0; index < 10000; index += 1) {
    store.set(`flood-${index}`, { c: index }, 100000);
  }
  assert.equal(store.size, 100);
  assert.equal(store.get('flood-0'), undefined);
  assert.equal(store.get('flood-9999').c, 9999);
});

test('MemoryRateStore maxKeys one retains only the newest key', () => {
  const store = new MemoryRateStore({ maxKeys: 1 });
  store.set('a', 1, 10000);
  store.set('b', 2, 10000);
  assert.equal(store.get('a'), undefined);
  assert.equal(store.get('b'), 2);
  assert.equal(store.size, 1);
});

for (const maxKeys of [2, 7, 31]) {
  test(`MemoryRateStore cap ${maxKeys} is exact under rotation`, () => {
    const store = new MemoryRateStore({ maxKeys });
    for (let index = 0; index < maxKeys * 4; index += 1) store.set(`k${index}`, index, 10000);
    assert.equal(store.size, maxKeys);
    for (let index = 0; index < maxKeys * 3; index += 1) assert.equal(store.get(`k${index}`), undefined);
  });
}

const dangerousKeys = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '__defineGetter__'];
for (const key of dangerousKeys) {
  test(`MemoryRateStore treats ${key} as an ordinary Map key`, () => {
    const store = new MemoryRateStore();
    store.set(key, { safe: true }, 1000);
    assert.deepEqual(store.get(key), { safe: true });
    store.set('ordinary', 1, 1000);
    assert.equal(store.get('ordinary'), 1);
  });
}

test('MemoryRateStore keys do not collide through object prototype names', () => {
  const store = new MemoryRateStore();
  store.set('__proto__', 1, 1000);
  store.set('constructor', 2, 1000);
  store.set('toString', 3, 1000);
  assert.equal(store.size, 3);
  assert.equal(store.get('__proto__'), 1);
  assert.equal(store.get('constructor'), 2);
  assert.equal(store.get('toString'), 3);
});

test('MemoryRateStore validates constructor options', () => {
  assert.throws(() => new MemoryRateStore({ maxKeys: 0 }), /maxKeys/);
  assert.throws(() => new MemoryRateStore({ maxKeys: 1.5 }), /maxKeys/);
  assert.throws(() => new MemoryRateStore({ maxKeyLength: 31 }), /maxKeyLength/);
  assert.throws(() => new MemoryRateStore({ now: 1 }), /now/);
  assert.throws(() => new MemoryRateStore({ unknown: true }), /unknown/);
});

test('MemoryRateStore rejects inherited constructor options', () => {
  const polluted = Object.create({ maxKeys: 1 });
  assert.throws(() => new MemoryRateStore(polluted), /inherited/);
});

test('MemoryRateStore rejects inherited maxKeys even when pollution looks helpful', () => {
  const original = Object.prototype.maxKeys;
  Object.prototype.maxKeys = 1;
  try {
    assert.throws(() => new MemoryRateStore({}), /inherited/);
  } finally {
    if (original === undefined) delete Object.prototype.maxKeys;
    else Object.prototype.maxKeys = original;
  }
});

test('MemoryRateStore backward clock movement does not shorten existing TTLs', () => {
  const clock = makeClock(5000);
  const store = new MemoryRateStore({ now: clock.now });
  store.set('a', 1, 1000);
  clock.set(1000);
  store.set('a', 1, 1000);
  clock.set(5500);
  assert.equal(store.get('a'), 1);
  clock.set(6001);
  assert.equal(store.get('a'), undefined);
});
