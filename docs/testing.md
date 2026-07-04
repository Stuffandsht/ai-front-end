# Testing

Commands:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:e2e
npm run test:e2e:headless
npm run build
```

Coverage includes:

- policy merge rules and denial reasons.
- retention context behavior.
- envelope encryption/decryption.
- provider gateway selection.
- MCP permission checks and dangerous tool confirmation.
- deployment mode seeding and single-company tenant creation rejection.
- Postgres-compatible migration execution through PGlite.
- SQL-backed retained and ephemeral chat runtime behavior.
- retained chat encrypted persistence.
- ephemeral sentinel non-persistence.
- credential and prompt encryption.
- browser storage static regression.
- Playwright Chromium coverage for development login, retained chat, single-company admin hiding, and browser storage behavior.

`tests/e2e/headless.test.ts` keeps fast runtime/static e2e checks. `tests/playwright/app.spec.ts` runs browser coverage through Playwright Chromium.
