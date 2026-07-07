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
- Added `APP_DATABASE_MODE=postgres`, a `pg`-backed SQL executor, Postgres migration command, and web runtime selection so the live app can run against `DATABASE_URL`.
- Expanded Postgres repository coverage for durable admin settings, including identity providers, provider credentials, retention policies, prompt versions, MCP servers, plugin installations, policy snapshots, and encrypted credential reads.
- Made Postgres migration startup idempotent and changed SQL repository-generated IDs to include UUID entropy so persistent DBs survive app restarts without primary-key collisions.
- Added runtime admin-state refresh so provider/model/prompt/retention/plugin changes update effective policy and registered adapters without restarting the process.
- Wired OIDC start/callback routes with discovery, authorization-code token exchange, JWKS-backed RS256 ID-token verification, JIT user provisioning, and metadata-only login audit events.
- Implemented OpenAI-compatible `/chat/completions` calls with server-side encrypted credential loading and redacted provider errors.
- Implemented Vault Transit KMS wrapping/unwrapping and guarded HTTP/stdio MCP adapter execution paths behind explicit enablement gates.
- Upgraded migration validation to execute the SQL migration in an embedded Postgres-compatible database.
- Rendered single-company and multi-tenant Compose profiles through Docker Compose v5.3.0 and smoke-tested the full single-company stack with the Postgres-backed app runtime.
- Added `.dockerignore` and fully qualified container image references for non-interactive Compose/Podman compatibility.
- Built required UI pages and deployment-mode hiding for service/tenant admin surfaces.
- Added unit, integration, security, fast e2e, and browser e2e tests.
- Added Playwright Chromium browser e2e coverage for login, retained chat, single-company admin hiding, and browser storage behavior.
- Added required documentation files.
- Audited and checked the first-pass acceptance checklist in `codex_goal_ai_agent_chat_platform.md` against implementation and validation evidence.
- Implemented first-class OpenRouter provider support with attribution headers, retention-aware routing preferences, SSE streaming parsing, OpenAI-style tool-call compatibility, model catalog sync, encrypted tenant credential use, admin UI actions, and provider/model policy inventory registration.
- Implemented the first multi-step agent/tool runtime loop with provider tool-call capture, MCP execution, tool-result feedback messages, confirmation/denial stops, and `AGENT_MAX_TOOL_ITERATIONS` enforcement.
- Expanded MCP plugin management with tenant-installed HTTP/stdio server records, encrypted install config, env secret refs, tenant tool permissions, admin UI controls, and chat/admin tool-call timelines.
- Added manifest-based platform plugins outside MCP for prompt packs, provider presets, policy bundles, and workflow actions without arbitrary code execution; tenant policy bundles now feed into effective policy.

Validation performed:
- command: `npm install`
  result: pass, dependencies already up to date
- command: `npm run typecheck`
  result: pass
- command: `npm run test`
  result: pass, 38 tests including OIDC discovery/token/JWKS/ID-token verification, OpenAI-compatible and OpenRouter provider calls, assistant tool-call history, Vault Transit KMS, HTTP/stdio MCP adapters, API mutation authorization regression scan, and admin page permission regression scan
- command: `npm run test:integration`
  result: pass, 16 tests including migration execution, SQL-backed retained/ephemeral chat runtime tests, multi-step tool loop behavior, tenant-installed stdio MCP registration, platform policy bundles, OpenRouter policy inventory registration, and encrypted plugin config checks
- command: `npm run test:e2e`
  result: pass with Playwright Chromium browser tests when run with host-level local bind permission
- command: `npm run test:e2e:headless`
  result: pass for fast runtime/static e2e checks, including OpenRouter admin configuration and sync route coverage
- command: `npm run test:all`
  result: pass when run with host-level local bind permission; includes lint, typecheck, unit/security, integration, headless e2e, and browser e2e
- command: `npm run lint`
  result: pass
- command: `npm run build`
  result: pass
- command: `npm run db:migrate`
  result: pass, executed migration and verified 28 required tables in embedded Postgres-compatible database
- command: `APP_DATABASE_MODE=postgres DATABASE_URL=postgresql://agent:agent@localhost:5432/agent_platform npm run db:migrate:postgres`
  result: pass against Docker Postgres, applied baseline/additive migration and verified 28 public tables
- command: `npm run db:seed`
  result: pass when run outside sandbox; sandboxed run failed because `tsx` could not create its local IPC pipe
- command: `APP_DATABASE_MODE=postgres DATABASE_URL=postgresql://agent:agent@localhost:5432/agent_platform ALLOW_DEV_AUTH=true npm run db:seed`
  result: pass against Docker Postgres; second run remained idempotent with one tenant, one provider, and two prompts
- command: `npm run compose:check`
  result: pass
- command: `docker compose --profile single-company config`
  result: pass, rendered app, Postgres, Valkey, and MinIO services
- command: `docker compose --profile multi-tenant config`
  result: pass, rendered app, Postgres, Valkey, and MinIO services
- command: `APP_DEPLOYMENT_MODE=single_company docker compose --profile single-company config --services`
  result: pass, listed services: redis, minio, postgres, app
- command: `APP_DEPLOYMENT_MODE=multi_tenant docker compose --profile multi-tenant config --services`
  result: pass, listed services: minio, postgres, redis, app
- command: `APP_DEPLOYMENT_MODE=single_company docker compose --profile single-company up -d --build`
  result: pass through `sg docker`, built the app image and started app, Postgres, Valkey, and MinIO
- command: `curl -s -f http://127.0.0.1:3000/api/config/public`
  result: pass against the Compose-launched app, returned single-company public config
- command: Compose-launched dev login and retained `POST /api/chat`
  result: pass through the Postgres-backed runtime, returned policy event, stream deltas, tool-call requested/completed events, second provider iteration, and retained message id
- command: Compose-launched `POST /api/providers` with `providerType=openrouter`
  result: pass, created an OpenRouter tenant provider with encrypted credential storage
- command: raw Compose Postgres row check after retained chat
  result: pass, found retained message/conversation/audit rows, an OpenRouter provider row, one provider credential row, and no plaintext chat or OpenRouter API-key sentinels in raw encrypted columns
- command: Compose-launched retention policy PATCH and provider POST with API key
  result: pass, wrote durable retention and provider rows, encrypted one provider credential, and raw Postgres search found no plaintext provider secret
- command: `APP_DEPLOYMENT_MODE=single_company docker compose --profile single-company down`
  result: pass after full-stack smoke test; `docker ps` returned no running containers
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
- The default local npm path still uses the in-memory repository so the app can run without local services; set `APP_DATABASE_MODE=postgres` for durable runtime state.
- No real external IdP, OpenAI-compatible provider, Vault, or MCP server credentials/endpoints are available in this environment; those live code paths are covered with mocked network/process tests.
- Docker Engine and Docker Compose v5.3.0 are available. Compose profile rendering is validated for both deployment modes, and the single-company stack smoke test passes when Docker daemon access is run through the `docker` group.

Manual verification:
- Single-company runtime login seed creates one company tenant.
- Retained mock chat reloads through encrypted message repositories.
- Ephemeral mock chat does not persist sentinel content.
- SQL-backed retained mock chat stores encrypted SQL rows and reloads through repository services.
- SQL-backed ephemeral mock chat writes metadata-only audit/tool rows without persisted content.
- Live Postgres-backed web runtime migrated, seeded, handled dev login, wrote retained chat rows, and avoided raw plaintext in message rows.
- Company prompt affects mock provider response through system message names.
- Mock tool runs; dangerous mock tool requests confirmation.
- Audit metadata appears.
- Raw durable snapshot search does not reveal encrypted retained messages, prompt content, provider credentials, or ephemeral sentinel content.
- OIDC/Microsoft Entra helper tests validate discovery issuer, token audience, callback state, email domain restriction, claim mapping, and dev-auth gating.
- OIDC route helpers are tested for discovery fetch, token exchange, JWKS fetch, and signed RS256 ID-token verification.
- OpenAI-compatible provider tests verify server-side request construction, response parsing, tool-call parsing, usage mapping, and credential redaction.
- Vault Transit KMS tests verify wrap/unwrap behavior through mocked Vault responses.
- API mutation routes are regression-tested for backend `authorizedJson` permission enforcement.
- Admin pages are regression-tested for backend page permission enforcement, and the navigation hides admin links the current role cannot use.
- MCP HTTP/stdio adapter tests verify both disabled-by-default gates and enabled JSON tool-list/invocation paths.
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
