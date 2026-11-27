#!/usr/bin/env node

import fs from 'node:fs';
import { extractClientIp, lintRateLimitConfig } from '../src/index.mjs';

const MAX_CONFIG_FILE_BYTES = 1024 * 1024;

function neutralize(text) {
  return String(text).replace(/[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ');
}

function writeError(message) {
  process.stderr.write('ratecage: error: ' + neutralize(message) + '\n');
}

function usage() {
  return [
    'ratecage 1.0.0',
    '',
    'Usage:',
    '  ratecage lint-config --config <file.json> [--json]',
    '  ratecage check-ip --socket <ip> [--xff <header>] [--forwarded <header>] [--trust <cidr1,cidr2>] [--ipv6-prefix 64] [--json]',
    '',
    'Commands:',
    '  lint-config   Audit a JSON rate-limit configuration',
    '  check-ip      Resolve the spoof-resistant client IP for a socket and forwarded headers'
  ].join('\n');
}

function parseCommandArgs(args, valueFlags, booleanFlags) {
  const values = Object.create(null);
  const booleans = Object.create(null);
  const repeated = Object.create(null);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      return { error: 'unexpected positional argument ' + token };
    }
    const name = token.slice(2);
    if (booleanFlags.includes(name)) {
      if (booleans[name] === true) return { error: 'duplicate flag --' + name };
      booleans[name] = true;
      continue;
    }
    if (!valueFlags.includes(name)) {
      return { error: 'unknown flag --' + name };
    }
    if (index + 1 >= args.length) return { error: 'missing value for --' + name };
    const value = args[index + 1];
    index += 1;
    if (name === 'trust' && values[name] !== undefined) {
      if (repeated[name] === undefined) repeated[name] = [values[name]];
      repeated[name].push(value);
      continue;
    }
    if (values[name] !== undefined) return { error: 'duplicate flag --' + name };
    values[name] = value;
  }
  return { values, booleans, repeated };
}

function statRejection(filePath) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    return 'configuration file cannot be read';
  }
  if (stat.isSymbolicLink()) return 'configuration file must not be a symbolic link';
  if (!stat.isFile()) return 'configuration path must be a regular file';
  if (stat.size > MAX_CONFIG_FILE_BYTES) return 'configuration file is too large';
  return null;
}

function readConfigFile(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096 || /[\x00-\x1f\x7f]/.test(filePath)) {
    throw new Error('configuration path is invalid');
  }
  const earlyRejection = statRejection(filePath);
  if (earlyRejection !== null) throw new Error(earlyRejection);
  const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
  const nonBlock = typeof fs.constants.O_NONBLOCK === 'number' ? fs.constants.O_NONBLOCK : 0;
  let fd;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow | nonBlock);
  } catch {
    throw new Error('configuration file cannot be opened safely');
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('configuration path must be a regular file');
    if (stat.size > MAX_CONFIG_FILE_BYTES) throw new Error('configuration file is too large');
    const buffer = Buffer.allocUnsafe(MAX_CONFIG_FILE_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const bytesRead = fs.readSync(fd, buffer, total, buffer.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > MAX_CONFIG_FILE_BYTES) throw new Error('configuration file is too large');
    return buffer.subarray(0, total).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function parseIpv6PrefixFlag(value) {
  if (value === undefined) return undefined;
  if (value === 'false' || value === 'off') return false;
  if (!/^[0-9]+$/.test(value)) throw new Error('--ipv6-prefix must be an integer from 0 through 128');
  const prefix = Number(value);
  if (!Number.isSafeInteger(prefix) || prefix < 0 || prefix > 128) {
    throw new Error('--ipv6-prefix must be an integer from 0 through 128');
  }
  return prefix;
}

function trustedProxiesFromFlags(values, repeated) {
  const raw = [];
  if (Array.isArray(repeated.trust)) raw.push(...repeated.trust);
  else if (values.trust !== undefined) raw.push(values.trust);
  const output = [];
  for (const item of raw) {
    for (const piece of item.split(',')) {
      const trimmed = piece.trim();
      if (trimmed !== '') output.push(trimmed);
    }
  }
  return output;
}

function commandLintConfig(args) {
  const parsed = parseCommandArgs(args, ['config'], ['json', 'help']);
  if (parsed.error !== undefined) {
    writeError(parsed.error);
    return 2;
  }
  if (parsed.booleans.help === true) {
    process.stdout.write(usage() + '\n');
    return 0;
  }
  if (parsed.values.config === undefined) {
    writeError('lint-config requires --config <file.json>');
    return 2;
  }
  let text;
  try {
    text = readConfigFile(parsed.values.config);
  } catch (error) {
    writeError(error.message);
    return 2;
  }
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    writeError('configuration is not valid JSON');
    return 2;
  }
  const findings = lintRateLimitConfig(config);
  const ok = findings.length === 0;
  if (parsed.booleans.json === true) {
    process.stdout.write(JSON.stringify({ ok, findings }, null, 2) + '\n');
  } else if (ok) {
    process.stdout.write('ok: no ratecage findings\n');
  } else {
    for (const finding of findings) {
      process.stdout.write(neutralize(finding.severity + ' ' + finding.code + ' ' + finding.path + ' - ' + finding.message) + '\n');
    }
  }
  return ok ? 0 : 1;
}

function commandCheckIp(args) {
  const parsed = parseCommandArgs(args, ['socket', 'xff', 'forwarded', 'trust', 'ipv6-prefix'], ['json', 'help']);
  if (parsed.error !== undefined) {
    writeError(parsed.error);
    return 2;
  }
  if (parsed.booleans.help === true) {
    process.stdout.write(usage() + '\n');
    return 0;
  }
  if (parsed.values.socket === undefined) {
    writeError('check-ip requires --socket <ip>');
    return 2;
  }
  try {
    const options = {
      socketIp: parsed.values.socket,
      xForwardedFor: parsed.values.xff,
      forwarded: parsed.values.forwarded,
      trustedProxies: trustedProxiesFromFlags(parsed.values, parsed.repeated)
    };
    const prefix = parseIpv6PrefixFlag(parsed.values['ipv6-prefix']);
    if (prefix !== undefined) options.ipv6Prefix = prefix;
    const ip = extractClientIp(options);
    if (parsed.booleans.json === true) {
      process.stdout.write(JSON.stringify({
        ok: true,
        ip,
        socketIp: extractClientIp({ socketIp: parsed.values.socket, ipv6Prefix: false }),
        trustedProxyCount: options.trustedProxies.length
      }, null, 2) + '\n');
    } else {
      process.stdout.write(ip + '\n');
    }
    return 0;
  } catch (error) {
    writeError(error && error.message ? error.message : 'client IP extraction failed');
    return 2;
  }
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(usage() + '\n');
    return 0;
  }
  if (command === '--version' || command === 'version') {
    process.stdout.write('ratecage 1.0.0\n');
    return 0;
  }
  if (command === 'lint-config') return commandLintConfig(args);
  if (command === 'check-ip') return commandCheckIp(args);
  writeError('unknown command ' + command);
  process.stderr.write(usage() + '\n');
  return 2;
}

process.exit(main(process.argv.slice(2)));
