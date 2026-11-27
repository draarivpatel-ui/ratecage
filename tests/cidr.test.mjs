import test from 'node:test';
import assert from 'node:assert/strict';
import { ipInCidr, parseCidr } from '../src/index.mjs';

function ipv4String(number) {
  return [
    (number >>> 24) & 0xff,
    (number >>> 16) & 0xff,
    (number >>> 8) & 0xff,
    number & 0xff
  ].join('.');
}

const ipv4Address = (192 << 24) | (0 << 16) | (2 << 8) | 128;
for (let prefix = 0; prefix <= 32; prefix += 1) {
  test(`parseCidr normalizes IPv4 host bits for prefix ${prefix}`, () => {
    const maskBits = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    const networkNumber = prefix === 0 ? 0 : (ipv4Address & maskBits) >>> 0;
    const parsed = parseCidr(`192.0.2.128/${prefix}`);
    assert.equal(parsed.family, 4);
    assert.equal(parsed.prefix, prefix);
    assert.equal(parsed.network, ipv4String(networkNumber));
  });
}

const ipv6PrefixCases = [
  [0, '::'],
  [1, '::'],
  [16, '2001::'],
  [32, '2001:db8::'],
  [48, '2001:db8:abcd::'],
  [64, '2001:db8:abcd:1234::'],
  [80, '2001:db8:abcd:1234:5555::'],
  [96, '2001:db8:abcd:1234:5555:aaaa::'],
  [112, '2001:db8:abcd:1234:5555:aaaa:bbbb:0'],
  [120, '2001:db8:abcd:1234:5555:aaaa:bbbb:0'],
  [127, '2001:db8:abcd:1234:5555:aaaa:bbbb:0'],
  [128, '2001:db8:abcd:1234:5555:aaaa:bbbb:ccdd']
];
for (const [prefix, network] of ipv6PrefixCases) {
  test(`parseCidr handles IPv6 prefix ${prefix}`, () => {
    const parsed = parseCidr(`${network}/${prefix}`);
    assert.equal(parsed.family, 6);
    assert.equal(parsed.prefix, prefix);
    assert.equal(parsed.network, network);
  });
}

const cidrMatches = [
  ['192.0.2.1', '192.0.2.0/24', true],
  ['192.0.2.255', '192.0.2.0/24', true],
  ['192.0.3.0', '192.0.2.0/24', false],
  ['0.0.0.0', '0.0.0.0/0', true],
  ['255.255.255.255', '0.0.0.0/0', true],
  ['10.0.0.1', '10.0.0.1', true],
  ['10.0.0.2', '10.0.0.1', false],
  ['10.0.0.1', '10.0.0.1/32', true],
  ['10.0.0.2', '10.0.0.1/32', false],
  ['172.16.0.1', '172.16.0.0/12', true],
  ['172.15.255.255', '172.16.0.0/12', false],
  ['172.31.255.255', '172.16.0.0/12', true],
  ['172.32.0.0', '172.16.0.0/12', false],
  ['2001:db8::1', '2001:db8::/32', true],
  ['2001:db9::1', '2001:db8::/32', false],
  ['2001:db8:abcd::1', '2001:db8::/32', true],
  ['2001:db8::1', '2001:db8::1/128', true],
  ['2001:db8::2', '2001:db8::1/128', false],
  ['::1', '::1/128', true],
  ['::2', '::1/128', false],
  ['2001:db8::1', '::/0', true],
  ['ffff::1', '::/0', true],
  ['192.0.2.1', '::/0', false],
  ['2001:db8::1', '0.0.0.0/0', false],
  ['::ffff:192.0.2.1', '192.0.2.0/24', true],
  ['192.0.2.1', '::ffff:192.0.2.0/120', true],
  ['192.0.2.1', '::ffff:192.0.2.1', true],
  ['192.0.2.2', '::ffff:192.0.2.1', false],
  ['::ffff:198.51.100.4', '198.51.100.0/25', true],
  ['::ffff:198.51.100.200', '198.51.100.0/25', false]
];

for (const [ip, cidr, expected] of cidrMatches) {
  test(`ipInCidr ${ip} in ${cidr} is ${expected}`, () => {
    assert.equal(ipInCidr(ip, cidr), expected);
  });
}

test('ipInCidr accepts a pre-parsed CIDR object', () => {
  const parsed = parseCidr('203.0.113.0/24');
  assert.equal(ipInCidr('203.0.113.44', parsed), true);
  assert.equal(ipInCidr('203.0.114.44', parsed), false);
});

const invalidCidrs = [
  '',
  '/24',
  '192.0.2.0/',
  '192.0.2.0//24',
  '192.0.2.0/-1',
  '192.0.2.0/+1',
  '192.0.2.0/01',
  '192.0.2.0/33',
  '192.0.2.0/1.5',
  '192.0.2.0/x',
  '192.0.2.0 /24',
  ' 192.0.2.0/24',
  '192.0.2.0/24 ',
  '192.0.2.0/24\n',
  '0177.0.0.0/24',
  '2130706433/8',
  '2001:db8::/129',
  '2001:db8::/01',
  'fe80::1%eth0/64',
  '[2001:db8::]/64',
  '::ffff:192.0.2.0/95',
  '::ffff:192.0.2.0/129',
  '1.2.3.4.5/24',
  'foo/24',
  '192.0.2.0\0/24'
];

for (const input of invalidCidrs) {
  test(`parseCidr rejects ${JSON.stringify(input)}`, () => {
    assert.throws(() => parseCidr(input), /ERR_RATECAGE_INVALID_CIDR|CIDR/);
  });
}

test('parseCidr rejects non-string input', () => {
  assert.throws(() => parseCidr(null), /CIDR/);
  assert.throws(() => parseCidr({}), /CIDR/);
});

test('parseCidr returns frozen objects', () => {
  const parsed = parseCidr('192.0.2.0/24');
  assert.equal(Object.isFrozen(parsed), true);
  assert.throws(() => {
    parsed.prefix = 32;
  }, TypeError);
});

test('ipInCidr rejects malformed pre-parsed CIDR objects', () => {
  assert.throws(() => ipInCidr('192.0.2.1', { family: 4, bits: 32, prefix: 33, networkValue: 0n }), /CIDR/);
  assert.throws(() => ipInCidr('192.0.2.1', { family: 4, bits: 32, prefix: -1, networkValue: 0n }), /CIDR/);
  assert.throws(() => ipInCidr('192.0.2.1', { family: 4, bits: 32, prefix: 24, networkValue: 2n ** 32n }), /CIDR/);
});
