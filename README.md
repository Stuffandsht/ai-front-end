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
npm run test:all
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:e2e
docker compose --profile single-company config
docker compose --profile multi-tenant config
npm run build
npm run compose:check
```

This environment has Docker Compose CLI plugin v5.3.0 available. The compose profiles were validated with:

```bash
docker compose --profile single-company config
docker compose --profile single-company config --services
docker compose --profile multi-tenant config
docker compose --profile multi-tenant config --services
```

A host with Docker Engine and Docker Compose can launch the services with:

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

## Provider Setup

OpenRouter is supported as a first-class provider. Company/tenant admins can add an OpenRouter API key from `/admin/providers`, sync the OpenRouter model catalog into tenant-scoped model configuration, and then use the synced provider/model IDs through the normal policy compiler. OpenRouter credentials are encrypted server-side and are never returned to the browser.

## Current Limitations

- The app defaults to the in-memory repository for local no-service development; a SQL-backed runtime repository is implemented and tested through an embedded Postgres-compatible engine.
- `APP_DATABASE_MODE=postgres` runs the live app against Postgres via `DATABASE_URL`; Docker/Compose startup applies the baseline migration before Next.js starts.
- OIDC/Microsoft Entra is wired through discovery, authorization-code token exchange, JWKS-backed ID-token verification, JIT user provisioning, and metadata-only auth audit events when `OIDC_*` settings are configured.
- OpenAI-compatible providers, encrypted provider credentials, Vault Transit KMS, and guarded HTTP/stdio MCP adapters are implemented behind server-side configuration gates.
- Browser e2e tests run with Playwright Chromium and require permission to bind a local Next.js server on port 3000.
