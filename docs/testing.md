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
- Vault Transit KMS wrapping/unwrapping through mocked Vault responses.
- provider gateway selection, OpenAI-compatible network adapter behavior, assistant tool-call history, and first-class OpenRouter headers/routing/model catalog/streaming behavior.
- MCP permission checks, dangerous tool confirmation, enabled HTTP/stdio adapter calls, tenant-installed stdio registration, and multi-step runtime tool execution.
- platform plugin policy bundle enforcement without executable tool registration.
- OIDC discovery, token exchange, JWKS fetch, and signed ID-token verification.
- deployment mode seeding and single-company tenant creation rejection.
- Postgres-compatible migration execution through PGlite.
- SQL-backed retained and ephemeral chat runtime behavior.
- live Postgres-backed app runtime smoke through `APP_DATABASE_MODE=postgres`.
- retained chat encrypted persistence.
- ephemeral sentinel non-persistence.
- OpenRouter tenant provider registration with encrypted credentials and policy-selected synced models.
- credential, prompt, MCP plugin config, and platform plugin config encryption.
- browser storage static regression.
- Playwright Chromium coverage for development login, retained chat, single-company admin hiding, and browser storage behavior.

`tests/e2e/headless.test.ts` keeps fast runtime/static e2e checks. `tests/playwright/app.spec.ts` runs browser coverage through Playwright Chromium.
