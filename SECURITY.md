# Security policy

## Supported versions

The initial supported release line is `1.x`.

## Reporting a vulnerability

Please do not open a public issue for a security vulnerability. Use the GitHub private vulnerability reporting flow for this repository when it is available. If private reporting is not available, open a minimal public issue that asks for a private contact channel and do not include exploit details, secrets, real traffic, or personal data.

Include:

- the affected version
- the operating system and Node.js version
- a minimal reproduction
- the security impact
- whether the issue involves IP spoofing, memory growth, algorithm correctness, header handling, the CLI, or store failure behavior

## Scope

Security-relevant behavior includes:

- incorrect trust decisions for `X-Forwarded-For` or `Forwarded`
- acceptance of malformed or obfuscated IP forms that should be rejected
- bypasses of IPv6 subnet bucketing
- memory growth beyond configured key or key-length bounds
- prototype pollution paths that weaken configured limits
- store-error behavior that fails open without explicit configuration
- algorithm behavior that consumes less cost than requested
- CLI file handling that follows unsafe file types or leaks terminal control sequences

## Operational guidance

Keep `trustedProxies` narrow and exact. Use the default fail-closed store policy unless a documented availability review explicitly accepts fail-open behavior. Treat rate limiting as one layer of defense, not as a replacement for authentication, authorization, TLS, or upstream network protection.
