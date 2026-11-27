# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | Yes |
| < 1.0 | No |

## Reporting a vulnerability

Use the private GitHub Security Advisories form: [Report a vulnerability](https://github.com/draarivpatel-ui/ratecage/security/advisories/new). Do not open a public issue, pull request, or discussion with exploit details, secrets, private endpoints, or personal data.

Include the affected version, operating system, Node.js version, a minimal reproduction, the security impact, and whether the issue involves IP spoofing, memory growth, algorithm correctness, header handling, the CLI, or store failure behavior.

## Disclosure timeline

We acknowledge reports within 48 hours. We aim to confirm or reject the report within 7 days, prepare a fix as soon as practical, and coordinate public disclosure with the reporter. Unless a shorter deadline is required by an actively exploited issue, please allow up to 90 days for a coordinated fix and disclosure.

## Scope

In scope:

- incorrect trust decisions for `X-Forwarded-For` or `Forwarded`
- acceptance of malformed or obfuscated IP forms that should be rejected
- bypasses of IPv6 subnet bucketing
- memory growth beyond configured key or key-length bounds
- prototype pollution paths that weaken configured limits
- store-error behavior that fails open without explicit configuration
- algorithm behavior that consumes less cost than requested
- CLI file handling that follows unsafe file types or leaks terminal control sequences

## Out of scope

Attacks that require write access to the victim process, host, or trusted proxy configuration are out of scope. Rate limiting is one layer of defense and does not replace authentication, authorization, TLS, or upstream network protection.

## Hardening notes

The package has zero runtime dependencies. Input budgets, fail-closed validation, deterministic tests, and property-based fuzz tests are part of the maintenance bar. A report that the library marks unsafe must block the operation in the caller; audit output is a boundary signal, not proof that a downstream system is safe.

## Disclosure history

No published advisories yet. Fixed versions will be listed here with their advisory links.
