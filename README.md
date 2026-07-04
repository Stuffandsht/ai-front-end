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

Docker is not installed in this execution environment. The compose profiles were rendered with a user-level Podman Compose provider, and the single-company stack was smoke-tested that way. The same file can be launched on a host with Docker Compose:

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
- The SQL-backed repository is tested through an embedded Postgres-compatible engine; wiring the running app to an external Postgres `DATABASE_URL` remains production integration work.
- OIDC/Microsoft Entra is modeled with validation helpers and documented, with development auth implemented for local use.
- MCP HTTP/stdio adapters and production KMS are interface stubs; mock tools and local KMS are fully tested.
- Browser e2e tests run with Playwright Chromium; this environment validated Compose through Podman because Docker CLI is absent.
