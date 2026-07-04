# Codex Progress

Completed:
- Scaffolded npm workspace TypeScript monorepo with Next.js app and control-plane packages.
- Added Docker Compose assets for app, Postgres, Valkey, and MinIO profiles.
- Added typed deployment config and `.env.example`.
- Added SQL migration covering required core tables.
- Implemented single-company and multi-tenant seed behavior.
- Implemented development auth route and protected API shell.
- Implemented provider-neutral auth helpers for OIDC discovery validation, ID token issuer/audience/domain checks, callback state validation, Microsoft Entra preset config, claim mapping, and development auth gating.
- Implemented deployment-aware role/permission authorization, wired API mutation routes through backend permission checks, and added server-side admin page permission guards with role-aware navigation.
- Implemented policy compiler, retention package, local KMS/envelope encryption, provider gateway, prompt stack, MCP gateway, audit events, and chat runtime.
- Added disabled-by-default HTTP and stdio MCP adapter boundaries.
- Implemented SQL-backed runtime repository and SQL encryption key store.
- Upgraded migration validation to execute the SQL migration in an embedded Postgres-compatible database.
- Rendered single-company and multi-tenant Compose profiles through Podman Compose and smoke-tested the full single-company stack because Docker CLI is absent in this environment.
- Added `.dockerignore` and fully qualified container image references for non-interactive Compose/Podman compatibility.
- Built required UI pages and deployment-mode hiding for service/tenant admin surfaces.
- Added unit, integration, security, fast e2e, and browser e2e tests.
- Added Playwright Chromium browser e2e coverage for login, retained chat, single-company admin hiding, and browser storage behavior.
- Added required documentation files.

Validation performed:
- command: `npm run typecheck`
  result: pass
- command: `npm run test`
  result: pass, including OIDC/Microsoft Entra auth helper tests, API mutation authorization regression scan, and admin page permission regression scan
- command: `npm run test:integration`
  result: pass, including migration execution and SQL-backed retained/ephemeral chat runtime tests
- command: `npm run test:e2e`
  result: pass with Playwright Chromium browser tests
- command: `npm run test:e2e:headless`
  result: pass for fast runtime/static e2e checks
- command: `npm run test:all`
  result: pass with local-bind approval for Playwright; includes lint, typecheck, unit/security, integration, headless e2e, and browser e2e
- command: `npm run lint`
  result: pass
- command: `npm run build`
  result: pass
- command: `npm run db:migrate`
  result: pass, executed migration and verified 27 required tables in embedded Postgres-compatible database
- command: `npm run db:seed`
  result: pass when run outside sandbox; sandboxed run failed because `tsx` could not create its local IPC pipe
- command: `npm run compose:check`
  result: pass
- command: `docker compose --profile single-company config`
  result: not run successfully because Docker CLI is not installed in this environment
- command: `docker compose --profile multi-tenant config`
  result: not run successfully because Docker CLI is not installed in this environment
- command: `python3 -m pip install --user podman-compose`
  result: pass, installed a user-level Compose provider for Podman because Docker Compose is absent
- command: `APP_DEPLOYMENT_MODE=single_company podman compose --profile single-company config`
  result: pass, rendered app, Postgres, Valkey, and MinIO services
- command: `APP_DEPLOYMENT_MODE=multi_tenant podman compose --profile multi-tenant config`
  result: pass, rendered app, Postgres, Valkey, and MinIO services with `APP_DEPLOYMENT_MODE=multi_tenant`
- command: `APP_DEPLOYMENT_MODE=single_company podman compose --profile single-company up -d postgres redis minio`
  result: pass, pulled fully qualified images and started Postgres, Valkey, and MinIO through Compose
- command: `podman inspect ai-front-end_postgres_1 --format '{{.State.Health.Status}}'`
  result: pass, returned `healthy`
- command: `APP_DEPLOYMENT_MODE=single_company podman compose --profile single-company down`
  result: pass, removed smoke-test containers; `podman ps -a` returned no remaining containers
- command: `APP_DEPLOYMENT_MODE=single_company podman compose --profile single-company build app`
  result: pass, built the Next.js app image from `infra/docker/Dockerfile`
- command: `APP_DEPLOYMENT_MODE=single_company podman compose --profile single-company up -d`
  result: pass, started app, Postgres, Valkey, and MinIO
- command: `curl -s -f http://127.0.0.1:3000/api/config/public`
  result: pass against the Compose-launched app, returned single-company public config
- command: Compose-launched dev login and retained `POST /api/chat`
  result: pass, returned policy event, stream deltas, and retained message id
- command: `APP_DEPLOYMENT_MODE=single_company podman compose --profile single-company down`
  result: pass after full-stack smoke test; `podman ps -a` returned no remaining containers
- command: `ALLOW_DEV_AUTH=true npm run dev`
  result: pass, server ready at http://localhost:3000
- command: `curl -s http://localhost:3000/api/config/public`
  result: pass, returned single-company public config with dev auth enabled
- command: `curl -s -X POST http://localhost:3000/api/chat ...`
  result: pass, returned policy event, stream deltas, and retained message id
- command: `curl -i http://localhost:3000/chat`
  result: pass, unauthenticated request returned 307 redirect to `/login`
- command: `curl -i -c /tmp/agent-platform-cookies.txt -X POST http://localhost:3000/api/auth/dev ...`
  result: pass, set `HttpOnly` development session cookie and redirected to `/chat`
- command: authenticated `curl -b /tmp/agent-platform-cookies.txt -X POST http://localhost:3000/api/chat ...`
  result: pass, returned policy event, stream deltas, and retained message id
- command: `npm audit --omit=dev`
  result: pass, found 0 production vulnerabilities
- command: SQL-backed runtime integration tests in `tests/integration/sql-runtime.test.ts`
  result: pass, retained chat writes encrypted SQL rows and ephemeral chat writes no content rows
- command: `curl -s http://localhost:3000/api/config/public`
  result: pass after SQL adapter changes, returned single-company public config with dev auth enabled
- command: authenticated `curl -b /tmp/agent-platform-cookies.txt -X POST http://localhost:3000/api/chat ...`
  result: pass after SQL adapter changes, returned policy event, stream deltas, and retained message id
- command: authenticated `curl -b /tmp/agent-platform-cookies-authz.txt -X POST http://localhost:3000/api/chat ...`
  result: pass after backend authorization changes, returned policy event, stream deltas, and retained message id
- command: authenticated `curl -b /tmp/agent-platform-cookies-authz.txt -X POST http://localhost:3000/api/admin/tenants ...`
  result: pass, returned HTTP 403 in single-company mode because `company_admin` lacks `tenant:create`

Known limitations:
- The default development app path uses the in-memory repository; the SQL-backed runtime repository is implemented and tested through PGlite, but wiring the running app to an external Postgres `DATABASE_URL` remains production integration work.
- Live OIDC network callback/token exchange is not wired because no external IdP credentials are available.
- Production KMS and MCP HTTP/stdio adapters are interface stubs.
- Docker CLI was not available in this environment, so exact `docker compose ...` validation was not performed. Equivalent Podman Compose profile rendering and full single-company stack smoke testing passed.

Manual verification:
- Single-company runtime login seed creates one company tenant.
- Retained mock chat reloads through encrypted message repositories.
- Ephemeral mock chat does not persist sentinel content.
- SQL-backed retained mock chat stores encrypted SQL rows and reloads through repository services.
- SQL-backed ephemeral mock chat writes metadata-only audit/tool rows without persisted content.
- Company prompt affects mock provider response through system message names.
- Mock tool runs; dangerous mock tool requests confirmation.
- Audit metadata appears.
- Raw durable snapshot search does not reveal encrypted retained messages, prompt content, provider credentials, or ephemeral sentinel content.
- OIDC/Microsoft Entra helper tests validate discovery issuer, token audience, callback state, email domain restriction, claim mapping, and dev-auth gating.
- API mutation routes are regression-tested for backend `authorizedJson` permission enforcement.
- Admin pages are regression-tested for backend page permission enforcement, and the navigation hides admin links the current role cannot use.
- MCP HTTP/stdio adapter boundaries are tested to remain disabled by default.
- Final build and migration checks pass after browser e2e and MCP adapter updates.
- Playwright browser tests verify dev login, retained chat request, single-company admin hiding, and no browser storage of chat content.

Files changed:
- `apps/web/**`
- `packages/**`
- `tests/**`
- `docs/**`
- `db/migrations/0001_initial.sql`
- `docker-compose.yml`
- `.env.example`
- `README.md`
- `package.json`
