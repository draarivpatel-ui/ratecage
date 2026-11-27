# Contributing

Contributions are welcome. Please keep the project zero-dependency, dual-module, and compatible with Node.js 18 or newer.

## Before you start

- Open an issue before a large API or behavior change.
- Read `docs/GOOD_FIRST_ISSUES.md` if you want a small first contribution.
- Do not add runtime dependencies.
- Do not weaken secure defaults to make a test easier to write.

## Development commands

```sh
npm test
node scripts/build-cjs.mjs --check
npm run smoke
npm pack --dry-run
```

`dist/index.cjs` is generated from `src/index.mjs` by `node scripts/build-cjs.mjs`. Do not edit it directly. The check mode must pass before a pull request is submitted.

## Code expectations

- Keep parsing strict and fail closed for malformed security input.
- Use `Map` for attacker-controlled keys.
- Copy and validate option objects without trusting inherited properties.
- Avoid regular expressions with unbounded nested repetition on untrusted input.
- Add tests for every behavior change, including negative cases.
- Keep documentation aligned with actual behavior.

## Commit and pull request expectations

- Use LF line endings.
- Do not commit `node_modules`, package tarballs, secrets, tokens, or local machine paths.
- Keep generated files reproducible.
- Explain the security reasoning behind changed defaults.
- Include the verification commands you ran in the pull request body.
