# Good first issues

These are bounded starter specifications for new contributors. Each item should include tests and documentation updates when behavior changes.

1. **CIDR fuzz corpus review**: Add a table of valid and invalid IPv6 CIDR examples covering compressed zeros, embedded IPv4, boundary prefixes, and host-bit normalization. Document any accepted host-bit behavior in the README.

2. **Forwarded header fixture expansion**: Add RFC 7239 fixtures for quoted IPv6, optional ports, parameter ordering, case-insensitive parameter names, and malformed quoting. Keep the parser strict and fail closed.

3. **RateLimit header interoperability check**: Compare emitted `RateLimit` and `RateLimit-Policy` fields against the current IETF draft text and report any format drift. Add a test for each confirmed required format rule.

4. **Token bucket precision characterization**: Add tests that document floating-point behavior for refill rates such as `0.1`, `0.3`, and `1/3`-style fractions. Recommend operational rates that avoid surprising precision artifacts.

5. **Store interface example**: Add a small in-documentation example showing how an atomic Redis-style `update` contract should behave. Do not add a Redis dependency or client implementation.

6. **Express integration example test**: Add a dependency-free test double that behaves like an Express `req`, `res`, and `next` triple and verifies middleware ordering, headers, and denial behavior.

7. **CLI fixture matrix**: Add more JSON config fixtures for warning-only, error-only, and mixed findings. Verify exact exit codes and machine-readable JSON output.

8. **Windows compatibility audit**: Review path handling, executable assumptions, FIFO tests, line endings, and test runner behavior on Windows. Convert any Unix-only test to an explicit platform skip with a reason.

9. **Namespace migration guide**: Write a short documentation section explaining how to rotate or version namespaces without blending old and new counters. Include a small example.

10. **Threat model review checklist**: Turn the README threat model into a release checklist that maintainers can copy into pull requests. Keep each item objectively testable.
