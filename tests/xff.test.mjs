import test from 'node:test';
import assert from 'node:assert/strict';
import { extractClientIp } from '../src/index.mjs';

const spoofHeaders = [
  '1.1.1.1',
  '198.51.100.99',
  '203.0.113.99, 198.51.100.99',
  '2001:db8::1',
  '::ffff:192.0.2.1',
  '0.0.0.0',
  '255.255.255.255',
  'not-an-ip',
  '1.1.1.1, 2.2.2.2, 3.3.3.3',
  ''
];
for (const header of spoofHeaders) {
  test(`extractClientIp ignores X-Forwarded-For by default ${JSON.stringify(header)}`, () => {
    assert.equal(extractClientIp({ socketIp: '203.0.113.10', xForwardedFor: header }), '203.0.113.10');
  });
}

for (const header of spoofHeaders.slice(0, 8)) {
  test(`extractClientIp ignores forwarded headers from an untrusted socket ${JSON.stringify(header)}`, () => {
    assert.equal(extractClientIp({
      socketIp: '198.51.100.10',
      xForwardedFor: header,
      trustedProxies: ['10.0.0.0/8']
    }), '198.51.100.10');
  });
}

const chainCases = [
  ['198.51.100.7', '198.51.100.7'],
  ['198.51.100.7, 10.1.0.1', '198.51.100.7'],
  ['198.51.100.7, 10.1.0.1, 10.2.0.1', '198.51.100.7'],
  ['203.0.113.9, 198.51.100.7', '198.51.100.7'],
  ['203.0.113.9, 10.1.0.1, 198.51.100.7', '198.51.100.7'],
  ['198.51.100.7, 172.16.0.8', '172.16.0.8'],
  ['198.51.100.7, 172.16.0.8, 10.1.0.1', '172.16.0.8'],
  ['10.9.0.1, 10.8.0.1, 198.51.100.7', '198.51.100.7'],
  ['10.9.0.1, 10.8.0.1', '10.9.0.1'],
  ['2001:db8:1::1', '2001:db8:1::'],
  ['[2001:db8:1::1]', '2001:db8:1::'],
  ['::ffff:192.0.2.9', '192.0.2.9']
];
for (const [header, expected] of chainCases) {
  test(`trusted proxy chain ${JSON.stringify(header)} resolves right-to-left`, () => {
    assert.equal(extractClientIp({
      socketIp: '10.2.0.1',
      xForwardedFor: header,
      trustedProxies: ['10.0.0.0/8']
    }), expected);
  });
}

const spoofResistanceCases = [
  ['1.1.1.1, 198.51.100.20', '198.51.100.20'],
  ['1.1.1.1, 2.2.2.2, 198.51.100.20', '198.51.100.20'],
  ['2001:db8:dead::1, 198.51.100.20', '198.51.100.20'],
  ['0.0.0.0, 198.51.100.20', '198.51.100.20'],
  ['255.255.255.255, 198.51.100.20', '198.51.100.20'],
  ['0177.0.0.1, 198.51.100.20', '10.2.0.1'],
  ['malformed, 198.51.100.20', '10.2.0.1']
];
for (const [header, expected] of spoofResistanceCases) {
  test(`client-controlled leftmost XFF entries cannot spoof ${JSON.stringify(header)}`, () => {
    assert.equal(extractClientIp({
      socketIp: '10.2.0.1',
      xForwardedFor: header,
      trustedProxies: ['10.2.0.1/32']
    }), expected);
  });
}

const malformedHeaders = [
  'not-an-ip',
  '1.2.3.256',
  '0177.0.0.1',
  '2130706433',
  '0x7f000001',
  '1.2.3.4:1234',
  '2001:db8::1%eth0',
  '1.2.3.4,',
  ',1.2.3.4',
  '1.2.3.4,,5.6.7.8',
  '1.2.3.4, ',
  '[2001:db8::1',
  '2001:db8::1]',
  '[1.2.3.4]',
  '1.2.3.4\0,5.6.7.8',
  '1.2.3.4\n,5.6.7.8',
  '1.2.3.4\r,5.6.7.8',
  '1.2.3.4\t,5.6.7.8',
  '1.2.3.4\x7f,5.6.7.8'
];
for (const header of malformedHeaders) {
  test(`malformed XFF falls back to the trusted socket ${JSON.stringify(header)}`, () => {
    assert.equal(extractClientIp({
      socketIp: '10.2.0.1',
      xForwardedFor: header,
      trustedProxies: ['10.2.0.1/32']
    }), '10.2.0.1');
  });
}

test('maxForwardedHops keeps the rightmost hops and never scans the whole header', () => {
  const leftNoise = Array.from({ length: 30 }, (_, index) => `198.51.100.${index + 1}`).join(', ');
  const header = `${leftNoise}, 203.0.113.77`;
  assert.equal(extractClientIp({
    socketIp: '10.0.0.1',
    xForwardedFor: header,
    trustedProxies: ['10.0.0.0/8'],
    maxForwardedHops: 2
  }), '203.0.113.77');
});

test('maxForwardedHops can preserve a trusted proxy hop at the cap boundary', () => {
  assert.equal(extractClientIp({
    socketIp: '10.0.0.1',
    xForwardedFor: '203.0.113.77, 10.9.9.9',
    trustedProxies: ['10.0.0.0/8'],
    maxForwardedHops: 2
  }), '203.0.113.77');
});

test('overlong forwarded headers fail closed to the socket IP', () => {
  const header = `198.51.100.1, ${'1'.repeat(2100)}`;
  assert.equal(extractClientIp({
    socketIp: '10.0.0.1',
    xForwardedFor: header,
    trustedProxies: ['10.0.0.0/8'],
    maxForwardedHeaderBytes: 2048
  }), '10.0.0.1');
});

test('maxForwardedHeaderBytes is validated', () => {
  assert.throws(() => extractClientIp({
    socketIp: '10.0.0.1',
    trustedProxies: ['10.0.0.0/8'],
    maxForwardedHeaderBytes: 63
  }), /maxForwardedHeaderBytes/);
});

test('maxForwardedHops is validated', () => {
  assert.throws(() => extractClientIp({
    socketIp: '10.0.0.1',
    trustedProxies: ['10.0.0.0/8'],
    maxForwardedHops: 0
  }), /maxForwardedHops/);
});

const ipv6Rotation = [
  '2001:db8:abcd:1234::1',
  '2001:db8:abcd:1234::2',
  '2001:db8:abcd:1234:1111::1',
  '2001:db8:abcd:1234:ffff::ffff',
  '2001:db8:abcd:1234:aaaa:bbbb:cccc:dddd'
];
for (const ip of ipv6Rotation) {
  test(`IPv6 ${ip} buckets to its /64 network by default`, () => {
    assert.equal(extractClientIp({
      socketIp: '10.0.0.1',
      xForwardedFor: ip,
      trustedProxies: ['10.0.0.0/8']
    }), '2001:db8:abcd:1234::');
  });
}

test('IPv6 bucketing can use another prefix', () => {
  assert.equal(extractClientIp({
    socketIp: '10.0.0.1',
    xForwardedFor: '2001:db8:abcd:1234::1',
    trustedProxies: ['10.0.0.0/8'],
    ipv6Prefix: 48
  }), '2001:db8:abcd::');
});

test('IPv6 bucketing can be disabled explicitly', () => {
  assert.equal(extractClientIp({
    socketIp: '10.0.0.1',
    xForwardedFor: '2001:db8:abcd:1234::1',
    trustedProxies: ['10.0.0.0/8'],
    ipv6Prefix: false
  }), '2001:db8:abcd:1234::1');
});

test('IPv4-mapped IPv6 clients normalize before bucketing decisions', () => {
  assert.equal(extractClientIp({
    socketIp: '10.0.0.1',
    xForwardedFor: '::ffff:198.51.100.44',
    trustedProxies: ['10.0.0.0/8']
  }), '198.51.100.44');
});

const forwardedCases = [
  ['for=198.51.100.20', '198.51.100.20'],
  ['for=198.51.100.20;proto=https', '198.51.100.20'],
  ['for="[2001:db8:1::1]"', '2001:db8:1::'],
  ['for="[2001:db8:1::1]:443"', '2001:db8:1::'],
  ['for=198.51.100.20:443', '198.51.100.20'],
  ['for=203.0.113.1, for=198.51.100.20', '198.51.100.20'],
  ['for=203.0.113.1;proto=https, for=198.51.100.20;proto=https', '198.51.100.20'],
  ['For=198.51.100.20', '198.51.100.20'],
  ['for="198.51.100.20"', '198.51.100.20'],
  ['for=10.9.9.9, for=198.51.100.20', '198.51.100.20']
];
for (const [header, expected] of forwardedCases) {
  test(`RFC Forwarded header ${JSON.stringify(header)} resolves safely`, () => {
    assert.equal(extractClientIp({
      socketIp: '10.0.0.1',
      forwarded: header,
      trustedProxies: ['10.0.0.0/8']
    }), expected);
  });
}

const malformedForwarded = [
  'for=unknown',
  'for=_hidden',
  'for=1.2.3.256',
  'for=0177.0.0.1',
  'for="[2001:db8::1"',
  'for=198.51.100.20;for=198.51.100.21',
  'proto=https',
  'for=',
  'for="unterminated',
  'for=198.51.100.20\x00'
];
for (const header of malformedForwarded) {
  test(`malformed Forwarded header falls back to socket ${JSON.stringify(header)}`, () => {
    assert.equal(extractClientIp({
      socketIp: '10.0.0.1',
      forwarded: header,
      trustedProxies: ['10.0.0.0/8']
    }), '10.0.0.1');
  });
}

test('X-Forwarded-For has precedence over Forwarded', () => {
  assert.equal(extractClientIp({
    socketIp: '10.0.0.1',
    xForwardedFor: '198.51.100.20',
    forwarded: 'for=203.0.113.20',
    trustedProxies: ['10.0.0.0/8']
  }), '198.51.100.20');
});

test('invalid socket IP input throws', () => {
  assert.throws(() => extractClientIp({ socketIp: 'bad' }), /ERR_RATECAGE_INVALID_IP|IP address/);
});

test('invalid trusted proxy entries are configuration errors', () => {
  assert.throws(() => extractClientIp({
    socketIp: '10.0.0.1',
    trustedProxies: ['*']
  }), /trustedProxies/);
});

test('positional extractClientIp arguments are supported', () => {
  assert.equal(extractClientIp('10.0.0.1', '198.51.100.20', { trustedProxies: ['10.0.0.0/8'] }), '198.51.100.20');
});

test('a malformed XFF cannot force fallback to an attacker-controlled Forwarded header', () => {
  assert.equal(extractClientIp({
    socketIp: '10.0.0.1',
    xForwardedFor: 'malformed',
    forwarded: 'for=1.1.1.1',
    trustedProxies: ['10.0.0.0/8']
  }), '10.0.0.1');
});

test('Forwarded is used only when XFF is absent', () => {
  assert.equal(extractClientIp({
    socketIp: '10.0.0.1',
    forwarded: 'for=198.51.100.20',
    trustedProxies: ['10.0.0.0/8']
  }), '198.51.100.20');
});

test('invalid request cost carries the dedicated error code', async () => {
  const { createRateLimiter } = await import('../src/index.mjs');
  const limiter = createRateLimiter();
  await assert.rejects(() => limiter.consume('a', { cost: 0 }), (error) => error.code === 'ERR_RATECAGE_INVALID_COST');
});
