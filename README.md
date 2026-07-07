# AI Agent Chat Platform

Self-hostable, tenant-aware AI agent chat control plane skeleton for multi-tenant and single-company deployments.

## Quickstart

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Open http://localhost:3000/chat. Development auth is available only when `ALLOW_DEV_AUTH=true`.

For durable local runtime state, set `APP_DATABASE_MODE=postgres`, start Postgres, run `npm run db:migrate:postgres`, then run `npm run db:seed`.

## Validation

```bash
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:e2e
npm run build
npm run compose:check
```

This environment has Docker Engine but not the Docker Compose CLI plugin. The compose profiles were rendered with a user-level Podman Compose provider, and the single-company stack was smoke-tested with the Postgres-backed app runtime. The same file can be launched on a host with Docker Compose:

```bash
docker compose --profile dev up --build
APP_DEPLOYMENT_MODE=single_company docker compose --profile single-company up --build
APP_DEPLOYMENT_MODE=multi_tenant docker compose --profile multi-tenant up --build
```

## Layout

```text
apps/web                 Next.js UI and route handlers
packages/auth            provider-neutral OIDC helpers and Microsoft Entra preset
                         plus role/permission authorization
packages/config          typed environment and deployment-mode config
packages/db              tenant-scoped memory and SQL repositories plus schema model
packages/policy          effective policy compiler
packages/retention       retention context builder
packages/crypto          KMS and envelope encryption services
packages/providers       provider gateway, mock provider, OpenAI-compatible shape
packages/prompts         prompt fragment compiler
packages/mcp-gateway     plugin/tool registry and permission boundary
packages/runtime         chat runtime orchestration
db/migrations            Postgres baseline schema
docs                     architecture and operation docs
```

## Current Limitations

- The app defaults to the in-memory repository for local no-service development; a SQL-backed runtime repository is implemented and tested through an embedded Postgres-compatible engine.
- `APP_DATABASE_MODE=postgres` runs the live app against Postgres via `DATABASE_URL`; Docker/Compose startup applies the baseline migration before Next.js starts.
- OIDC/Microsoft Entra is wired through discovery, authorization-code token exchange, JWKS-backed ID-token verification, JIT user provisioning, and metadata-only auth audit events when `OIDC_*` settings are configured.
- OpenAI-compatible providers, encrypted provider credentials, Vault Transit KMS, and guarded HTTP/stdio MCP adapters are implemented behind server-side configuration gates.
- Browser e2e tests run with Playwright Chromium; this environment validated Compose through Podman because the Docker Compose CLI plugin is absent.
