import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createNodeRateLimitMiddleware, createRateLimiter } from '../src/index.mjs';
import { createMockResponse, headerValues, makeClock } from './helpers.mjs';

function requestFor(ip, headers = {}) {
  return {
    headers,
    socket: { remoteAddress: ip }
  };
}

function middleware(options = {}) {
  const clock = makeClock(0);
  const mw = createNodeRateLimitMiddleware({ limit: 2, windowMs: 1000, now: clock.now, ...options });
  return { clock, mw };
}

async function invoke(mw, req, res) {
  let nextCalls = 0;
  const result = await mw(req, res, () => {
    nextCalls += 1;
  });
  return { result, nextCalls };
}

test('Node middleware allows requests under the limit and calls next', async () => {
  const { mw } = middleware();
  const res = createMockResponse();
  const outcome = await invoke(mw, requestFor('203.0.113.10'), res);
  assert.equal(outcome.result, true);
  assert.equal(outcome.nextCalls, 1);
});

test('Node middleware writes rate headers on allowed requests', async () => {
  const { mw } = middleware({ limit: 3 });
  const res = createMockResponse();
  await invoke(mw, requestFor('203.0.113.10'), res);
  const headers = headerValues(res.headers);
  assert.equal(headers['ratelimit-policy'], '3;w=1');
  assert.equal(headers.ratelimit, 'limit=3, remaining=2, reset=1');
  assert.equal(headers['x-ratelimit-limit'], '3');
});

test('Node middleware denies over-limit requests with 429 JSON', async () => {
  const { mw } = middleware({ limit: 1 });
  const req = requestFor('203.0.113.10');
  await invoke(mw, req, createMockResponse());
  const res = createMockResponse();
  const outcome = await invoke(mw, req, res);
  assert.equal(outcome.result, false);
  assert.equal(outcome.nextCalls, 0);
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(res.headers.get('retry-after'), '2');
  const body = JSON.parse(res.body);
  assert.equal(body.error, 'rate_limited');
  assert.equal(body.message, 'Too many requests');
  assert.equal(body.retryAfterSeconds, 2);
});

test('Node middleware uses a custom denial message safely', async () => {
  const { mw } = middleware({ limit: 1, message: 'Slow down' });
  const req = requestFor('203.0.113.10');
  await invoke(mw, req, createMockResponse());
  const res = createMockResponse();
  await invoke(mw, req, res);
  assert.equal(JSON.parse(res.body).message, 'Slow down');
});

test('Node middleware ignores X-Forwarded-For by default', async () => {
  const { mw } = middleware({ limit: 1 });
  const req = requestFor('203.0.113.10', { 'x-forwarded-for': '198.51.100.1' });
  assert.equal((await invoke(mw, req, createMockResponse())).result, true);
  const second = requestFor('203.0.113.10', { 'x-forwarded-for': '198.51.100.2' });
  assert.equal((await invoke(mw, second, createMockResponse())).result, false);
});

test('Node middleware trusts forwarded client IP only from a trusted proxy', async () => {
  const { mw } = middleware({ limit: 1, trustedProxies: ['10.0.0.0/8'] });
  const first = requestFor('10.0.0.8', { 'x-forwarded-for': '198.51.100.1' });
  const second = requestFor('10.0.0.8', { 'x-forwarded-for': '198.51.100.2' });
  assert.equal((await invoke(mw, first, createMockResponse())).result, true);
  assert.equal((await invoke(mw, second, createMockResponse())).result, true);
});

test('Node middleware prevents client-controlled XFF spoofing behind a proxy', async () => {
  const { mw } = middleware({ limit: 1, trustedProxies: ['10.0.0.0/8'] });
  const first = requestFor('10.0.0.8', { 'x-forwarded-for': '1.1.1.1, 198.51.100.20' });
  const second = requestFor('10.0.0.8', { 'x-forwarded-for': '2.2.2.2, 198.51.100.20' });
  assert.equal((await invoke(mw, first, createMockResponse())).result, true);
  assert.equal((await invoke(mw, second, createMockResponse())).result, false);
});

test('Node middleware does not trust XFF from a direct untrusted client', async () => {
  const { mw } = middleware({ limit: 1, trustedProxies: ['10.0.0.0/8'] });
  const first = requestFor('198.51.100.20', { 'x-forwarded-for': '1.1.1.1' });
  const second = requestFor('198.51.100.20', { 'x-forwarded-for': '2.2.2.2' });
  assert.equal((await invoke(mw, first, createMockResponse())).result, true);
  assert.equal((await invoke(mw, second, createMockResponse())).result, false);
});

test('Node middleware buckets IPv6 clients by /64', async () => {
  const { mw } = middleware({ limit: 1, trustedProxies: ['10.0.0.0/8'] });
  const first = requestFor('10.0.0.8', { 'x-forwarded-for': '2001:db8:abcd:1234::1' });
  const second = requestFor('10.0.0.8', { 'x-forwarded-for': '2001:db8:abcd:1234::2' });
  assert.equal((await invoke(mw, first, createMockResponse())).result, true);
  assert.equal((await invoke(mw, second, createMockResponse())).result, false);
});

test('Node middleware handles IPv4-mapped IPv6 socket addresses', async () => {
  const { mw } = middleware({ limit: 1 });
  assert.equal((await invoke(mw, requestFor('::ffff:203.0.113.10'), createMockResponse())).result, true);
  assert.equal((await invoke(mw, requestFor('203.0.113.10'), createMockResponse())).result, false);
});

test('Node middleware supports connection fallback for the socket address', async () => {
  const { mw } = middleware({ limit: 1 });
  const req = { headers: {}, connection: { remoteAddress: '203.0.113.10' } };
  assert.equal((await invoke(mw, req, createMockResponse())).result, true);
  assert.equal((await invoke(mw, req, createMockResponse())).result, false);
});

test('Node middleware missing socket identity fails closed in one shared bucket', async () => {
  const { mw } = middleware({ limit: 1 });
  assert.equal((await invoke(mw, { headers: {} }, createMockResponse())).result, true);
  assert.equal((await invoke(mw, { headers: {}, socket: {} }, createMockResponse())).result, false);
});

test('Node middleware skip bypasses limiting and calls next', async () => {
  const { mw } = middleware({ limit: 1, skip: () => true });
  const req = requestFor('203.0.113.10');
  assert.equal((await invoke(mw, req, createMockResponse())).nextCalls, 1);
  assert.equal((await invoke(mw, req, createMockResponse())).nextCalls, 1);
});

test('Node middleware onDenied receives the result and suppresses the default body', async () => {
  let seen;
  const { mw } = middleware({
    limit: 1,
    onDenied(req, res, result) {
      seen = result;
      res.statusCode = 429;
      res.end('custom');
    }
  });
  const req = requestFor('203.0.113.10');
  await invoke(mw, req, createMockResponse());
  const res = createMockResponse();
  await invoke(mw, req, res);
  assert.equal(seen.code, 'RATE_LIMITED');
  assert.equal(res.body, 'custom');
});

test('Node middleware respects headersSent and does not write a second response', async () => {
  const { mw } = middleware({ limit: 1 });
  const req = requestFor('203.0.113.10');
  await invoke(mw, req, createMockResponse());
  const res = createMockResponse();
  res.headersSent = true;
  const outcome = await invoke(mw, req, res);
  assert.equal(outcome.result, false);
  assert.equal(res.body, '');
  assert.equal(res.headers.has('retry-after'), false);
});

test('Node middleware does not mutate its options object', async () => {
  const options = { limit: 1, trustedProxies: ['10.0.0.0/8'] };
  const snapshot = JSON.stringify(options);
  createNodeRateLimitMiddleware(options);
  assert.equal(JSON.stringify(options), snapshot);
});

test('Node middleware validates keyPrefix and message', () => {
  assert.throws(() => createNodeRateLimitMiddleware({ keyPrefix: 'bad\n' }), /keyPrefix/);
  assert.throws(() => createNodeRateLimitMiddleware({ message: 'bad\n' }), /message/);
});

test('Node middleware rejects unknown options', () => {
  assert.throws(() => createNodeRateLimitMiddleware({ typo: true }), /unknown/);
});

test('Node middleware supports a supplied shared limiter', async () => {
  const clock = makeClock(0);
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now });
  const mw = createNodeRateLimitMiddleware({ limiter, trustedProxies: [] });
  await invoke(mw, requestFor('203.0.113.10'), createMockResponse());
  assert.equal((await limiter.consume('ip:203.0.113.10')).allowed, false);
});

test('Node middleware without next still returns a boolean', async () => {
  const { mw } = middleware();
  const result = await mw(requestFor('203.0.113.10'), createMockResponse());
  assert.equal(result, true);
});

test('Node middleware arrays in forwarded headers are not trusted as valid strings', async () => {
  const { mw } = middleware({ limit: 1, trustedProxies: ['10.0.0.0/8'] });
  const req = requestFor('10.0.0.8', { 'x-forwarded-for': ['198.51.100.1'] });
  assert.equal((await invoke(mw, req, createMockResponse())).result, true);
  const again = requestFor('10.0.0.8', { 'x-forwarded-for': ['198.51.100.2'] });
  assert.equal((await invoke(mw, again, createMockResponse())).result, false);
});

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

test('Node middleware works on a real http server', async () => {
  const clock = makeClock(0);
  const mw = createNodeRateLimitMiddleware({ limit: 1, windowMs: 1000, now: clock.now });
  const server = http.createServer((req, res) => {
    mw(req, res, () => {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain');
      res.end('ok');
    }).catch(() => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('error');
      }
    });
  });
  const port = await listen(server);
  try {
    const first = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(first.status, 200);
    assert.equal(await first.text(), 'ok');
    assert.ok(first.headers.get('ratelimit'));
    const second = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(second.status, 429);
    assert.equal(second.headers.get('cache-control'), 'no-store');
    assert.ok(second.headers.get('retry-after'));
    const body = await second.json();
    assert.equal(body.error, 'rate_limited');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Node middleware real server ignores spoofed XFF by default', async () => {
  const clock = makeClock(0);
  const mw = createNodeRateLimitMiddleware({ limit: 1, windowMs: 1000, now: clock.now });
  const server = http.createServer((req, res) => {
    mw(req, res, () => res.end('ok')).catch(() => res.end('error'));
  });
  const port = await listen(server);
  try {
    const first = await fetch(`http://127.0.0.1:${port}/`, { headers: { 'x-forwarded-for': '1.1.1.1' } });
    const second = await fetch(`http://127.0.0.1:${port}/`, { headers: { 'x-forwarded-for': '2.2.2.2' } });
    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Node middleware writes standard headers before a custom denial hook', async () => {
  const { mw } = middleware({ limit: 1, onDenied(req, res) { res.end('custom'); } });
  const req = requestFor('203.0.113.10');
  await invoke(mw, req, createMockResponse());
  const res = createMockResponse();
  await invoke(mw, req, res);
  assert.equal(res.headers.get('retry-after'), '2');
  assert.equal(res.body, 'custom');
});

test('Node middleware rejects an invalid static socket IP at construction', () => {
  assert.throws(() => createNodeRateLimitMiddleware({ socketIp: 'bad' }), /IP address/);
});
