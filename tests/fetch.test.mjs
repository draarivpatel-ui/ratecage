import test from 'node:test';
import assert from 'node:assert/strict';
import { createFetchRateLimitHandler, createRateLimiter } from '../src/index.mjs';
import { makeClock } from './helpers.mjs';

function req(path = 'https://example.test/', headers = {}) {
  return new Request(path, { headers });
}

function okResponse(body = 'ok', init = {}) {
  return new Response(body, {
    status: init.status || 200,
    statusText: init.statusText || 'OK',
    headers: init.headers || {}
  });
}

test('Fetch adapter calls the wrapped handler under the limit', async () => {
  const clock = makeClock(0);
  let calls = 0;
  const handler = createFetchRateLimitHandler(() => {
    calls += 1;
    return okResponse();
  }, { limit: 1, windowMs: 1000, now: clock.now, socketIp: '203.0.113.10' });
  const response = await handler(req());
  assert.equal(calls, 1);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'ok');
});

test('Fetch adapter adds rate headers to an allowed response', async () => {
  const clock = makeClock(0);
  const handler = createFetchRateLimitHandler(() => okResponse(), {
    limit: 3,
    windowMs: 1000,
    now: clock.now,
    socketIp: '203.0.113.10'
  });
  const response = await handler(req());
  assert.equal(response.headers.get('ratelimit-policy'), '3;w=1');
  assert.equal(response.headers.get('ratelimit'), 'limit=3, remaining=2, reset=1');
});

test('Fetch adapter denies over-limit requests with a 429 Response', async () => {
  const clock = makeClock(0);
  let calls = 0;
  const handler = createFetchRateLimitHandler(() => {
    calls += 1;
    return okResponse();
  }, { limit: 1, windowMs: 1000, now: clock.now, socketIp: '203.0.113.10' });
  await handler(req());
  const denied = await handler(req());
  assert.equal(calls, 1);
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get('cache-control'), 'no-store');
  assert.equal(denied.headers.get('retry-after'), '2');
  assert.equal((await denied.json()).error, 'rate_limited');
});

test('Fetch adapter default XFF behavior prevents spoofing', async () => {
  const clock = makeClock(0);
  const handler = createFetchRateLimitHandler(() => okResponse(), {
    limit: 1,
    windowMs: 1000,
    now: clock.now,
    socketIp: '203.0.113.10'
  });
  const first = await handler(req('https://example.test/', { 'x-forwarded-for': '1.1.1.1' }));
  const second = await handler(req('https://example.test/', { 'x-forwarded-for': '2.2.2.2' }));
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
});

test('Fetch adapter uses XFF only behind trusted proxies', async () => {
  const clock = makeClock(0);
  const handler = createFetchRateLimitHandler(() => okResponse(), {
    limit: 1,
    windowMs: 1000,
    now: clock.now,
    socketIp: '10.0.0.1',
    trustedProxies: ['10.0.0.0/8']
  });
  const first = await handler(req('https://example.test/', { 'x-forwarded-for': '198.51.100.1' }));
  const second = await handler(req('https://example.test/', { 'x-forwarded-for': '198.51.100.2' }));
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
});

test('Fetch adapter right-to-left processing blocks leftmost spoof entries', async () => {
  const clock = makeClock(0);
  const handler = createFetchRateLimitHandler(() => okResponse(), {
    limit: 1,
    windowMs: 1000,
    now: clock.now,
    socketIp: '10.0.0.1',
    trustedProxies: ['10.0.0.0/8']
  });
  const first = await handler(req('https://example.test/', { 'x-forwarded-for': '1.1.1.1, 198.51.100.20' }));
  const second = await handler(req('https://example.test/', { 'x-forwarded-for': '2.2.2.2, 198.51.100.20' }));
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
});

test('Fetch adapter supports getSocketIp', async () => {
  const clock = makeClock(0);
  const handler = createFetchRateLimitHandler(() => okResponse(), {
    limit: 1,
    windowMs: 1000,
    now: clock.now,
    getSocketIp(request) {
      return request.socketIp;
    }
  });
  const first = { headers: new Headers(), socketIp: '203.0.113.10' };
  const second = { headers: new Headers(), socketIp: '203.0.113.11' };
  assert.equal((await handler(first)).status, 200);
  assert.equal((await handler(second)).status, 200);
});

test('Fetch adapter request.ip fallback is supported', async () => {
  const clock = makeClock(0);
  const handler = createFetchRateLimitHandler(() => okResponse(), { limit: 1, windowMs: 1000, now: clock.now });
  assert.equal((await handler({ headers: new Headers(), ip: '203.0.113.10' })).status, 200);
  assert.equal((await handler({ headers: new Headers(), ip: '203.0.113.10' })).status, 429);
});

test('Fetch adapter missing socket identity fails closed into one shared bucket', async () => {
  const clock = makeClock(0);
  const handler = createFetchRateLimitHandler(() => okResponse(), { limit: 1, windowMs: 1000, now: clock.now });
  assert.equal((await handler(req())).status, 200);
  assert.equal((await handler(req())).status, 429);
});

test('Fetch adapter does not mutate the original response headers object', async () => {
  const clock = makeClock(0);
  const originalHeaders = new Headers({ 'x-custom': 'yes' });
  const original = okResponse('ok', { headers: originalHeaders });
  const handler = createFetchRateLimitHandler(() => original, {
    limit: 1,
    windowMs: 1000,
    now: clock.now,
    socketIp: '203.0.113.10'
  });
  const response = await handler(req());
  assert.equal(original.headers.get('ratelimit'), null);
  assert.equal(response.headers.get('x-custom'), 'yes');
  assert.ok(response.headers.get('ratelimit'));
});

test('Fetch adapter clones responses whose headers object cannot be mutated', async () => {
  const clock = makeClock(0);
  const original = okResponse('ok');
  original.headers.set = () => {
    throw new TypeError('immutable');
  };
  const handler = createFetchRateLimitHandler(() => original, {
    limit: 1,
    windowMs: 1000,
    now: clock.now,
    socketIp: '203.0.113.10'
  });
  const response = await handler(req());
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('ratelimit'));
  assert.equal(await response.text(), 'ok');
});

test('Fetch adapter preserves response status and statusText', async () => {
  const clock = makeClock(0);
  const handler = createFetchRateLimitHandler(() => okResponse('created', { status: 201, statusText: 'Created' }), {
    limit: 1,
    windowMs: 1000,
    now: clock.now,
    socketIp: '203.0.113.10'
  });
  const response = await handler(req());
  assert.equal(response.status, 201);
  assert.equal(response.statusText, 'Created');
});

test('Fetch adapter supports object options with handler', async () => {
  const clock = makeClock(0);
  const handler = createFetchRateLimitHandler({
    handler: () => okResponse(),
    limit: 1,
    windowMs: 1000,
    now: clock.now,
    socketIp: '203.0.113.10'
  });
  assert.equal((await handler(req())).status, 200);
});

test('Fetch adapter requires a handler', () => {
  assert.throws(() => createFetchRateLimitHandler({ limit: 1 }), /handler/);
});

test('Fetch adapter rejects non-response handler output', async () => {
  const clock = makeClock(0);
  const handler = createFetchRateLimitHandler(() => 'not a response', {
    limit: 1,
    windowMs: 1000,
    now: clock.now,
    socketIp: '203.0.113.10'
  });
  await assert.rejects(() => handler(req()), /Response/);
});

test('Fetch adapter supports a supplied shared limiter', async () => {
  const clock = makeClock(0);
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now });
  const handler = createFetchRateLimitHandler(() => okResponse(), {
    limiter,
    socketIp: '203.0.113.10'
  });
  await handler(req());
  assert.equal((await limiter.consume('ip:203.0.113.10')).allowed, false);
});

test('Fetch adapter validates options', () => {
  assert.throws(() => createFetchRateLimitHandler(() => okResponse(), { unknown: true }), /unknown/);
  assert.throws(() => createFetchRateLimitHandler(() => okResponse(), { trustedProxies: ['*'] }), /trustedProxies/);
});

test('Fetch adapter rejects an invalid static socket IP at construction', () => {
  assert.throws(() => createFetchRateLimitHandler(() => okResponse(), { socketIp: 'bad' }), /IP address/);
});
