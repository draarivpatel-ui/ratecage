import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIp } from '../src/index.mjs';

const validIpv4 = [
  ['0.0.0.0', '0.0.0.0'],
  ['1.2.3.4', '1.2.3.4'],
  ['127.0.0.1', '127.0.0.1'],
  ['192.0.2.1', '192.0.2.1'],
  ['198.51.100.20', '198.51.100.20'],
  ['203.0.113.9', '203.0.113.9'],
  ['255.255.255.255', '255.255.255.255'],
  ['8.8.8.8', '8.8.8.8'],
  ['10.0.0.1', '10.0.0.1'],
  ['172.16.0.1', '172.16.0.1'],
  ['169.254.0.1', '169.254.0.1'],
  ['100.64.0.1', '100.64.0.1'],
  ['224.0.0.1', '224.0.0.1'],
  ['240.0.0.1', '240.0.0.1'],
  ['9.255.128.0', '9.255.128.0']
];
for (let a = 1; a <= 5; a += 1) {
  for (let b = 3; b <= 5; b += 1) {
    validIpv4.push([`${a}.${b}.${a + b}.${b + 10}`, `${a}.${b}.${a + b}.${b + 10}`]);
  }
}

for (const [input, expected] of validIpv4) {
  test(`normalizeIp accepts strict IPv4 ${input}`, () => {
    assert.equal(normalizeIp(input), expected);
  });
}

const invalidIpv4 = [
  '',
  '1',
  '1.2',
  '1.2.3',
  '1.2.3.4.5',
  '256.1.1.1',
  '1.256.1.1',
  '1.1.256.1',
  '1.1.1.256',
  '999.999.999.999',
  '0177.0.0.1',
  '01.2.3.4',
  '1.02.3.4',
  '1.2.003.4',
  '1.2.3.04',
  '2130706433',
  '0x7f.0.0.1',
  '0x7f000001',
  '127.1',
  '127.0.1',
  '1.2.3.4 ',
  ' 1.2.3.4',
  '1.2.3.4\n',
  '1.2.3.4\t',
  '1..2.3',
  '.1.2.3',
  '1.2.3.',
  '-1.2.3.4',
  '+1.2.3.4',
  '1.-2.3.4',
  '1.+2.3.4',
  'a.b.c.d',
  '1.2.3.x',
  '1.2.3.4/32',
  '1.2.3.4:80',
  '[1.2.3.4]',
  '1.2.3.4%eth0',
  '1.2.3.4\0',
  '１２７.0.0.1',
  '1.2.3.٤',
  '4294967295',
  '000.000.000.000'
];

for (const input of invalidIpv4) {
  test(`normalizeIp rejects obfuscated or malformed IPv4 ${JSON.stringify(input)}`, () => {
    assert.throws(() => normalizeIp(input), /ERR_RATECAGE_INVALID_IP|IP address/);
  });
}

const validIpv6 = [
  ['::', '::'],
  ['::1', '::1'],
  ['0:0:0:0:0:0:0:0', '::'],
  ['0:0:0:0:0:0:0:1', '::1'],
  ['2001:db8::1', '2001:db8::1'],
  ['2001:db8::1:80', '2001:db8::1:80'],
  ['2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
  ['2001:DB8::1', '2001:db8::1'],
  ['fe80::a1ff:fe01:2345', 'fe80::a1ff:fe01:2345'],
  ['2001:db8:0:0:1:0:0:1', '2001:db8::1:0:0:1'],
  ['2001:0:0:1:0:0:1:1', '2001::1:0:0:1:1'],
  ['1:0:0:2:0:0:3:4', '1::2:0:0:3:4'],
  ['abcd:ef01:2345:6789:abcd:ef01:2345:6789', 'abcd:ef01:2345:6789:abcd:ef01:2345:6789'],
  ['2001:db8::ffff', '2001:db8::ffff'],
  ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2:3:4:5:6'],
  ['::ffff:192.0.2.1', '192.0.2.1'],
  ['::ffff:c000:201', '192.0.2.1'],
  ['0:0:0:0:0:ffff:198.51.100.20', '198.51.100.20'],
  ['64:ff9b::192.0.2.1', '64:ff9b::c000:201'],
  ['2001:db8::192.0.2.1', '2001:db8::c000:201'],
  ['1::2', '1::2'],
  ['1::', '1::'],
  ['::2', '::2'],
  ['1:2::7:8', '1:2::7:8'],
  ['1:2:3::6:7:8', '1:2:3::6:7:8'],
  ['ffff::', 'ffff::'],
  ['ffff:0:0:0:0:0:0:ffff', 'ffff::ffff'],
  ['1234::abcd:0:0:1', '1234::abcd:0:0:1'],
  ['aaaa:bbbb:cccc:dddd::1', 'aaaa:bbbb:cccc:dddd::1'],
  ['2001:db8:85a3::8a2e:370:7334', '2001:db8:85a3::8a2e:370:7334']
];

for (const [input, expected] of validIpv6) {
  test(`normalizeIp canonicalizes IPv6 ${input}`, () => {
    assert.equal(normalizeIp(input), expected);
  });
}

const invalidIpv6 = [
  '',
  ':',
  ':::',
  '1::2::3',
  '::1::',
  '1:2:3:4:5:6:7',
  '1:2:3:4:5:6:7:8:9',
  '1:2:3:4:5:6:7:8:',
  ':1:2:3:4:5:6:7:8',
  'gggg::1',
  '12345::',
  '2001:db8::1%',
  'fe80::1%eth0',
  'fe80::1%25eth0',
  '[2001:db8::1]',
  '2001:db8::1/64',
  ' 2001:db8::1',
  '2001:db8::1 ',
  '2001:db8::1\n',
  '2001:db8::1\0',
  '2001:db8::g',
  '2001:db8::-1',
  '2001:db8::+1',
  '2001:db8::192.0.2.256',
  '2001:db8::192.0.2',
  '2001:db8::192.0.2.1.2',
  '2001:db8::0192.0.2.1',
  '2001:db8:192.0.2.1::',
  '::ffff:999.0.2.1',
  '::ffff:192.0.2.01',
  '1:2:3:4:5:6:7::8',
  '1:2:3:4:5:6:7:8::',
  '::1:2:3:4:5:6:7:8',
  '1::2::',
  '1:::2',
  'abcd:ef01:2345:6789:abcd:ef01:2345:6789:0000',
  '0x1::',
  '２００１:db8::1',
  '2001：db8::1'
];

for (const input of invalidIpv6) {
  test(`normalizeIp rejects malformed IPv6 ${JSON.stringify(input)}`, () => {
    assert.throws(() => normalizeIp(input), /ERR_RATECAGE_INVALID_IP|IP address/);
  });
}

const ipv6Buckets = [
  ['2001:db8:abcd:1234::1', 64, '2001:db8:abcd:1234::'],
  ['2001:db8:abcd:1234:ffff::1', 64, '2001:db8:abcd:1234::'],
  ['2001:db8:abcd:1234::1', 48, '2001:db8:abcd::'],
  ['2001:db8:abcd:1234::1', 32, '2001:db8::'],
  ['2001:db8:abcd:1234::1', 128, '2001:db8:abcd:1234::1'],
  ['2001:db8:abcd:1234::1', false, '2001:db8:abcd:1234::1'],
  ['fe80::1234', 64, 'fe80::'],
  ['ffff:ffff:ffff:ffff:ffff::1', 64, 'ffff:ffff:ffff:ffff::'],
  ['ffff:ffff:ffff:ffff:ffff::1', 0, '::'],
  ['2001:db8::1', null, '2001:db8::1']
];

for (const [input, prefix, expected] of ipv6Buckets) {
  test(`normalizeIp applies IPv6 prefix bucket ${String(prefix)} to ${input}`, () => {
    assert.equal(normalizeIp(input, { ipv6Prefix: prefix }), expected);
  });
}

test('normalizeIp rejects an invalid ipv6Prefix option', () => {
  assert.throws(() => normalizeIp('2001:db8::1', { ipv6Prefix: 129 }), /ipv6Prefix/);
});

test('normalizeIp rejects inherited option properties', () => {
  const polluted = Object.create({ ipv6Prefix: 64 });
  assert.throws(() => normalizeIp('2001:db8::1', polluted), /inherited/);
});
