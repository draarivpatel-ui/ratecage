# ratecage

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/draarivpatel-ui/ratecage/badge)](https://scorecard.dev/viewer/?uri=github.com/draarivpatel-ui/ratecage)

ratecage is a zero-dependency Node.js security library for HTTP and API rate limiting. It combines deterministic rate-limit algorithms, memory-bounded key storage, spoof-resistant client IP extraction, standard rate-limit headers, a Node HTTP middleware adapter, a Fetch adapter, a static configuration linter, and a small CLI.

## Status

This repository is prepared for its first npm release. It is versioned as `1.0.0`, but this README does not claim that the package has already been published. After release, installation will be:

```sh
npm install ratecage
```

Until then, run it from a source checkout.

## Why this exists

Production rate limiting is easy to get subtly wrong:

- Trusting `X-Forwarded-For` directly lets a client choose a new IP for every request.
- Trusting every proxy makes forwarded headers attacker controlled.
- IPv6 clients can often rotate through a very large number of interface identifiers.
- An unbounded key map lets an attacker turn rotating identities into a memory exhaustion attack.
- Plain object key maps create avoidable prototype-key collision hazards.
- Fixed windows can allow a burst at the end of one window and another burst at the start of the next.
- A cache or store outage can silently disable protection if the failure policy is fail-open by default.
- Handwritten rate-limit headers often omit `Retry-After` or use inconsistent semantics.

ratecage makes the safer choice the default in each of these cases.

## Threat model

In scope:

- brute-force and high-frequency request control inside one Node.js process
- spoofed `X-Forwarded-For` and RFC 7239 `Forwarded` headers
- malformed, oversized, obfuscated, or control-character-bearing forwarded headers
- reverse proxy chains when the operator correctly configures trusted proxy IPs or CIDRs
- IPv4-mapped IPv6 ambiguity such as `::ffff:192.0.2.1`
- IPv6 interface-identifier rotation within a `/64` allocation
- memory exhaustion through millions of distinct rate-limit keys
- accidental use of object prototype names as keys, including `__proto__` and `constructor`
- store outages, corrupt in-memory state, and invalid limiter configuration
- clear machine-readable denial behavior with `429`, `Retry-After`, and `Cache-Control: no-store`

Out of scope and limitations:

- This is not a replacement for TLS, authentication, authorization, a web application firewall, or bot management.
- The included `MemoryRateStore` is process-local. It does not coordinate across multiple Node.js processes or machines.
- A custom store without an atomic `update` operation is serialized only within one limiter instance in one process. Distributed deployments need an atomic backing store implementation.
- Any bounded in-memory store can evict state under extreme key churn. This is deliberate: memory safety takes priority over perfect long-term counting.
- The sliding-window counter is a weighted counter, not an exact per-request timestamp log. It is memory-efficient and prevents boundary burst doubling, but it can be conservative for very small limits.
- Token bucket state is approximate when fractional refill rates are used because JavaScript numbers are floating-point values.
- The Fetch standard does not expose a peer socket IP. Serverless and edge platforms must pass a trusted platform value through `socketIp` or `getSocketIp`. If no identity is available, the adapter intentionally uses one shared fail-closed bucket.
- ratecage cannot know whether a proxy is really yours. `trustedProxies` must contain only proxies you operate or control.
- If a reverse proxy rewrites rather than appends forwarding headers, right-to-left trust walking cannot recover the original client chain.

## Installation and module support

The package is dual module:

```js
// ESM
import { createRateLimiter } from 'ratecage';
```

```js
// CommonJS
const { createRateLimiter } = require('ratecage');
```

TypeScript declarations are included. Node.js 18 or newer is required. There are no runtime dependencies.

## Quick start

```js
import { createRateLimiter } from 'ratecage';

const limiter = createRateLimiter({
  limit: 100,
  windowMs: 60_000
});

const result = await limiter.consume('user-or-ip-key');
if (!result.allowed) {
  console.log('retry in', result.retryAfterSeconds, 'seconds');
}
```

`consume` records cost. `check` is an alias for `consume` for callers that prefer that name. Use `peek` when you need a non-consuming read:

```js
const preview = await limiter.peek('user-or-ip-key');
```

A result is frozen and has this shape:

```js
{
  allowed: true,
  limit: 100,
  remaining: 99,
  resetSeconds: 60,
  resetAtMs: 1710000000000,
  retryAfterSeconds: 0,
  key: 'ratecage:user-or-ip-key',
  reason: 'ok',
  code: 'OK',
  headers: {
    'RateLimit-Policy': '100;w=60',
    RateLimit: 'limit=100, remaining=99, reset=60',
    'X-RateLimit-Limit': '100',
    'X-RateLimit-Remaining': '99',
    'X-RateLimit-Reset': '1710000000'
  }
}
```

Denied results add `Retry-After` to `headers` and use a machine-readable `code` such as `RATE_LIMITED`, `COST_EXCEEDS_LIMIT`, or `STORE_ERROR`.

## Spoof-resistant client IP extraction

The most important rule is the default: forwarded headers are not trusted.

```js
import { extractClientIp } from 'ratecage';

extractClientIp({
  socketIp: '203.0.113.10',
  xForwardedFor: '1.1.1.1'
});
// 203.0.113.10
```

The header is considered only when the direct socket peer is inside `trustedProxies`:

```js
extractClientIp({
  socketIp: '10.0.0.8',
  xForwardedFor: '198.51.100.20',
  trustedProxies: ['10.0.0.0/8']
});
// 198.51.100.20
```

When a chain is present, ratecage walks right-to-left. It never trusts the leftmost entry merely because the client supplied it:

```js
extractClientIp({
  socketIp: '10.0.0.8',
  xForwardedFor: '1.1.1.1, 198.51.100.20',
  trustedProxies: ['10.0.0.0/8']
});
// 198.51.100.20
```

In that example `1.1.1.1` was client-controlled noise. The rightmost untrusted hop is the usable client identity.

Supported protections include:

- strict dotted-decimal IPv4 parsing
- rejection of integer, hexadecimal, octal-like, and leading-zero IPv4 forms
- strict IPv6 parsing with canonical compression
- rejection of IPv6 zone identifiers such as `fe80::1%eth0`
- IPv4-mapped IPv6 normalization
- bounded hop counts and bounded forwarded-header byte length
- malformed-header fail-closed fallback to the direct socket IP
- evaluation capped to the rightmost `maxForwardedHops` entries so client-controlled leftmost noise cannot create rotating identities
- RFC 7239 `Forwarded` parsing only when `X-Forwarded-For` is absent

### IPv6 rotation protection

By default extracted IPv6 clients are bucketed to their `/64` network:

```js
extractClientIp({
  socketIp: '10.0.0.8',
  xForwardedFor: '2001:db8:abcd:1234::99',
  trustedProxies: ['10.0.0.0/8']
});
// 2001:db8:abcd:1234::
```

This prevents an attacker who can rotate interface identifiers inside one customer `/64` from receiving a fresh bucket for every address. Set `ipv6Prefix` to another value if your network allocation differs. Setting it to `128` or `false` restores per-host keys and is flagged by the linter because it weakens rotation resistance.

## Algorithms

### Sliding-window counter

This is the default:

```js
const limiter = createRateLimiter({
  algorithm: 'sliding-window',
  limit: 100,
  windowMs: 60_000
});
```

The algorithm keeps a current-window count and a previous-window count. The previous window is weighted by how much of it still overlaps the logical sliding window. This avoids the hard boundary behavior of a fixed window without storing every request timestamp.

It is intentionally memory-efficient. It can be conservative immediately after a boundary for very small limits because the previous window fades continuously rather than disappearing all at once.

### Fixed window

Fixed windows are available as an explicit opt-in:

```js
const limiter = createRateLimiter({
  algorithm: 'fixed-window',
  limit: 100,
  windowMs: 60_000
});
```

This mode is simple and exact per window, but a client can burst at the end of one window and again at the start of the next. Prefer the default unless fixed-window semantics are required.

### Token bucket

```js
const limiter = createRateLimiter({
  algorithm: 'token-bucket',
  capacity: 20,
  refillPerSecond: 2
});
```

Each key starts with a full bucket. Each request consumes `cost` tokens. Tokens refill continuously up to `capacity`. Fractional refill rates such as `0.5` are supported. If `refillPerSecond` is omitted, it is derived from `capacity` and `windowMs`.

### Cost

Every algorithm supports integer cost:

```js
await limiter.consume('api-key', { cost: 5 });
```

Cost must be a positive safe integer within the supported bound. Zero, negative, fractional, infinite, and `NaN` costs are rejected. A cost greater than the limit or bucket capacity is deterministically denied with `COST_EXCEEDS_LIMIT`.

## Memory-bounded store

The default store is `MemoryRateStore`:

```js
import { MemoryRateStore, createRateLimiter } from 'ratecage';

const store = new MemoryRateStore({
  maxKeys: 50_000,
  maxKeyLength: 256
});

const limiter = createRateLimiter({ store });
```

Properties:

- hard `maxKeys` cap
- O(1) LRU eviction using `Map` insertion-order refresh
- opportunistic expired-entry pruning
- byte-length key limits
- rejection of NUL and control characters in keys
- safe handling of keys named `__proto__`, `constructor`, or `toString`

A million distinct attacker IPs cannot create a million entries. They can evict older entries, which is the necessary trade-off of a memory-bounded cache.

### Custom stores

A store implements:

```js
{
  get(key) {},
  set(key, value, ttlMs) {},
  update(key, updater, ttlMs) {}, // optional but recommended
  delete(key) {}                  // optional
}
```

Methods may be synchronous or return promises. If `update` is present it should atomically read, modify, and write the state. For Redis or SQL this normally means a Lua script or transaction. Without an atomic `update`, ratecage serializes operations only inside the current limiter instance.

Store errors fail closed by default:

```js
const limiter = createRateLimiter({
  store,
  onStoreError: 'deny'
});
```

`onStoreError: 'allow'` is available for availability-first deployments, but it is explicitly flagged by the linter because a store outage then disables protection.

## Namespaces and oversized keys

Keys are namespaced before storage:

```js
const limiter = createRateLimiter({ namespace: 'login' });
const result = await limiter.consume('203.0.113.10');
// result.key is login:203.0.113.10
```

Oversized keys are not silently truncated. The variable key material is hashed with SHA-256 inside the namespace, so repeated oversized keys still share one deterministic bucket without letting unbounded key text consume memory. Keys beginning with the reserved `sha256:` prefix are always hashed, which prevents a short attacker-chosen key from colliding with the encoded bucket of an oversized key. Raw keys have a hard 64 KiB input cap. Namespace names may contain ASCII letters, digits, dot, underscore, and hyphen; colon is rejected so separate namespaces cannot be concatenated into the same storage key.

## Headers

ratecage emits:

- `RateLimit-Policy`
- `RateLimit`
- `Retry-After` on denial
- legacy `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` by default

Disable legacy headers if you only want structured fields:

```js
const limiter = createRateLimiter({ legacyHeaders: false });
```

Disable generated headers entirely when a proxy owns response policy:

```js
const limiter = createRateLimiter({ includeHeaders: false });
```

## Node HTTP and Express-style middleware

```js
import http from 'node:http';
import { createNodeRateLimitMiddleware } from 'ratecage';

const rateLimit = createNodeRateLimitMiddleware({
  limit: 100,
  windowMs: 60_000,
  trustedProxies: ['10.0.0.0/8']
});

http.createServer((req, res) => {
  rateLimit(req, res, () => {
    res.end('ok');
  });
}).listen(8080);
```

The same function shape works in Express-style middleware chains:

```js
app.use(createNodeRateLimitMiddleware({
  limit: 100,
  windowMs: 60_000,
  trustedProxies: ['10.0.0.0/8']
}));
```

When denied, the middleware sends:

- status `429`
- JSON body with `error`, `message`, and `retryAfterSeconds`
- `Retry-After`
- `Cache-Control: no-store`

It reads the direct peer from `req.socket.remoteAddress` or `req.connection.remoteAddress`. If neither source yields an address, unidentified traffic shares one fail-closed bucket instead of bypassing the limiter. It does not mutate the caller's options object. If response headers were already sent, it does not write a second response.

## Fetch adapter

```js
import { createFetchRateLimitHandler } from 'ratecage';

const limited = createFetchRateLimitHandler(async (request) => {
  return new Response('ok');
}, {
  limit: 100,
  windowMs: 60_000,
  socketIp: (request) => request.socketIp,
  trustedProxies: ['10.0.0.0/8']
});
```

The adapter returns a `Response` with status `429` when denied. When allowed, it clones the wrapped response and returns a new response with rate headers rather than mutating immutable response headers.

The Fetch standard has no peer-address property. Supply the platform-verified socket IP through `socketIp` or `getSocketIp` whenever possible. Common nonstandard properties such as `request.ip` and `request.socketIp` are used when present. Without any identity, all unidentified traffic shares one fail-closed bucket.

## Static configuration linter

```js
import { lintRateLimitConfig } from 'ratecage';

const findings = lintRateLimitConfig({
  trustedProxies: ['0.0.0.0/0'],
  ipv6Prefix: 128,
  onStoreError: 'allow'
});
```

Findings include:

- `RATECAGE_TRUST_ALL_PROXIES`
- `RATECAGE_UNBOUNDED_STORE`
- `RATECAGE_IPV6_HOST_BUCKET_BYPASS`
- `RATECAGE_FAIL_OPEN_STORE`
- `RATECAGE_EXCESSIVE_WINDOW_OR_LIMIT`
- `RATECAGE_MISSING_KEY_CAP`

Each finding has `code`, `severity`, `path`, `message`, and `recommendation`.

## CLI

```sh
ratecage lint-config --config rate-limit.json
ratecage lint-config --config rate-limit.json --json
ratecage check-ip --socket 10.0.0.8 --xff "198.51.100.20" --trust 10.0.0.0/8
ratecage check-ip --socket 10.0.0.8 --xff "2001:db8:abcd:1234::99" --trust 10.0.0.0/8 --json
```

Exit codes:

- `0`: success with no lint findings
- `1`: lint findings were present
- `2`: usage error, invalid input, invalid JSON, or unsafe configuration file

The config reader rejects directories, devices, FIFOs, symbolic links, and oversized files. It uses `O_NOFOLLOW` and `O_NONBLOCK` where the platform supports them, verifies the opened file with `fstat`, and reads at most one byte beyond the configured size cap so concurrent file growth cannot become an unbounded read. CLI error output neutralizes ANSI and bidirectional control characters.

## API summary

- `normalizeIp(ip, options?)`
- `parseCidr(cidr)`
- `ipInCidr(ip, cidr)`
- `extractClientIp(options)`
- `MemoryRateStore`
- `createRateLimitKey(namespace, key, maxKeyLength?)`
- `createRateLimiter(options?)`
- `createRateCage(options?)`
- `createNodeRateLimitMiddleware(options?)`
- `createFetchRateLimitHandler(handler, options?)`
- `lintRateLimitConfig(input)`

See `types/index.d.ts` for exact TypeScript signatures.

## Recommended production defaults

```js
createNodeRateLimitMiddleware({
  algorithm: 'sliding-window',
  limit: 100,
  windowMs: 60_000,
  trustedProxies: ['10.0.0.0/8'],
  ipv6Prefix: 64,
  onStoreError: 'deny'
})
```

Use a smaller limit for credential checks and expensive write endpoints. Keep `trustedProxies` as narrow as possible. Do not copy a cloud example range unless you actually operate or control that proxy layer.

## Development

```sh
npm test
node scripts/build-cjs.mjs --check
npm run smoke
npm pack --dry-run
```

The test runner explicitly enumerates `tests/*.test.mjs` so glob behavior is consistent on Windows and Unix. The package has no runtime dependencies. The only development dependency is the pinned fast-check property-testing library, and core tests use the Node.js built-in test runner. The checked-in suite currently passes 686 tests. Clocks used for tests or embedded systems should be monotonic; backward movement is treated conservatively and does not erase limiter state or store TTLs.
