# Codex Goal: Self-Hostable Multi-Tenant / Single-Company AI Agent Chat Platform

## How to use this file

Treat this file as the project goal. Work through it until the acceptance criteria are complete.

You may install packages, scaffold the application, create Docker/Compose assets, run database migrations, run tests, and refactor aggressively. Prefer working software over prose. Keep documentation current as implementation decisions are made.

If the environment supports parallel Codex tasks, subagents, worktrees, or delegated subtasks, use them for the independent workstreams called out below. If not, emulate this by creating internal task files under `docs/codex-tasks/` and executing them sequentially.

Do not stop at a design document. The target is a runnable, tested application skeleton with the core control-plane architecture implemented deeply enough that future feature work does not need to unwind early shortcuts.

---

## Product summary

Build a self-hostable web-based front end and control plane for an AI agent/chatbot.

The system must support:

- Multi-tenant deployments.
- Single-company deployments where service-level and tenant-level configuration are collapsed into one company scope.
- Microsoft 365 / generic OIDC authentication.
- Per-service, per-tenant/company, per-group, per-user, per-conversation policy resolution.
- Per-tenant and per-user inference provider selection.
- User bring-your-own-provider configuration, when allowed by policy.
- MCP/plugin configuration per tenant and user.
- Multi-level prompt composition.
- Strict retained / limited / ephemeral retention modes.
- Encryption at rest.
- Self-hostable deployment without lock-in to one cloud provider.

This is not merely a chat UI. The web UI sits on top of a tenant-aware AI control plane and runtime.

---

## Non-negotiable design rules

1. **No provider lock-in**
   - The application must not be architecturally tied to OpenAI, Anthropic, Azure, Ollama, or any single inference provider.
   - Implement providers through a gateway/adapter interface.
   - Include one mock provider and at least one real-provider-compatible adapter shape, even if real credentials are not present.

2. **No cloud lock-in**
   - The app must run locally through Docker Compose.
   - Use Postgres as the relational baseline.
   - Use S3-compatible object storage for blobs/attachments.
   - Use Redis or Valkey for ephemeral coordination/cache.
   - Use a KMS abstraction; support local development keys and a production-grade external KMS/Vault adapter interface.

3. **No prompt-only security**
   - Prompts may guide the model.
   - Authorization must be enforced by backend policy checks.
   - Tool access, provider access, retention behavior, and credential use must be enforced outside the model.

4. **No retention ambiguity**
   - Retention mode must be part of request context.
   - Ephemeral mode must not write prompt content, user content, assistant content, tool arguments, tool results, embeddings, summaries, debug traces, or job payloads to persistent storage.
   - If content is not supposed to be retained, it must never be written. Do not rely on cleanup jobs as the primary guarantee.

5. **Single-company mode must use the same codepath**
   - Do not create a separate app for single-company instances.
   - Use one codebase.
   - Keep `tenant_id` internally even when there is only one company.
   - Collapse service-level configurable defaults into company/tenant config at policy-resolution time.

6. **Auditable behavior**
   - Admin changes, auth events, provider selection, tool calls, retention mode selection, and policy decisions must create audit metadata where policy permits.
   - In ephemeral mode, audit events must be metadata-only.

7. **Safe defaults**
   - Disable arbitrary external MCP/plugin execution by default.
   - Disable user BYO provider by default.
   - Default to retained conversations only if configured; allow tenants/company admins to set stricter defaults.
   - Never expose provider credentials to the browser or to the model.

---

## Recommended stack

Use this stack unless the existing repository strongly suggests a different one:

- TypeScript monorepo.
- Node.js backend.
- React/Next.js frontend.
- Postgres.
- Prisma or Drizzle ORM.
- Redis or Valkey.
- S3-compatible object storage; use MinIO in local Docker.
- Docker Compose for local and single-server deployment.
- Optional Helm chart scaffold for Kubernetes deployment.
- Vitest/Jest for unit tests.
- Playwright for end-to-end browser tests.
- ESLint/Prettier/TypeScript strict mode.
- Zod or similar runtime validation for config and API boundaries.

If starting from an empty repository, scaffold a modern TypeScript monorepo. A good default layout:

```text
.
├── apps/
│   ├── web/                 # Next.js UI and route handlers, or pure UI if API is separate
│   └── api/                 # backend API/runtime if using separate service
├── packages/
│   ├── config/              # typed env/config loading
│   ├── db/                  # schema, migrations, repositories
│   ├── policy/              # effective policy compiler
│   ├── prompts/             # prompt stack compiler
│   ├── providers/           # inference provider gateway/adapters
│   ├── mcp-gateway/         # MCP/plugin registry and execution boundary
│   ├── retention/           # retention enforcement helpers
│   ├── crypto/              # envelope encryption/KMS abstraction
│   ├── audit/               # audit event schema/writer
│   └── test-utils/          # fixtures and integration helpers
├── docs/
├── infra/
│   ├── docker/
│   └── helm/
├── docker-compose.yml
├── .env.example
├── package.json
└── README.md
```

A single Next.js app with route handlers is acceptable for MVP if boundaries are still represented as packages/interfaces. Do not blur policy/runtime/provider logic directly into UI components.

---

## Deployment modes

Implement deployment mode as a first-class configuration value.

```text
APP_DEPLOYMENT_MODE=multi_tenant | single_company
```

### Multi-tenant mode

In multi-tenant mode:

- Multiple tenants may exist.
- Tenant may be resolved by hostname, login discovery, or explicit tenant slug.
- Service-level defaults exist and may be overridden by tenant defaults.
- Tenant admins can configure their tenant within service policy limits.
- Service admins can manage all tenants.

Policy scope order:

```text
platform invariant policy
  ↓
service default
  ↓
tenant default
  ↓
group/role policy
  ↓
user policy
  ↓
conversation/session option
  ↓
request option
```

### Single-company mode

In single-company mode:

- Exactly one tenant/company is active.
- The UI should speak in terms of "Company" rather than "Tenant" where possible.
- The app still stores and uses a `tenant_id` internally.
- Service-level configurable defaults are collapsed into the single company/tenant scope.
- Platform invariant policy may still exist as code/static policy, but it should not appear as a configurable service layer in the UI.
- There should be no tenant picker, tenant creation UI, or host-to-tenant admin UI.
- Company admins can configure providers, prompts, MCP/plugins, retention defaults, OIDC, users, and roles.
- User-level overrides remain available where company policy permits.
- Migration from single-company mode to multi-tenant mode should be possible because internal data is still tenant-scoped.

Policy scope order in single-company mode:

```text
platform invariant policy
  ↓
company default   # implemented internally as tenant default
  ↓
group/role policy
  ↓
user policy
  ↓
conversation/session option
  ↓
request option
```

Required environment variables:

```text
APP_DEPLOYMENT_MODE=single_company
SINGLE_COMPANY_TENANT_SLUG=acme
SINGLE_COMPANY_TENANT_NAME=Acme Internal AI
PUBLIC_BASE_URL=https://ai.acme.example
```

Optional environment variables:

```text
SINGLE_COMPANY_PRIMARY_DOMAIN=acme.example
SINGLE_COMPANY_DEFAULT_RETENTION=retained | limited | ephemeral
SINGLE_COMPANY_ALLOW_USER_BYO_PROVIDER=false
SINGLE_COMPANY_DEFAULT_PROVIDER_ID=mock
SINGLE_COMPANY_DEFAULT_MODEL_ID=mock-chat
```

Required behavior:

- On boot or migration, seed the single company tenant if it does not exist.
- In single-company mode, reject attempts to create additional tenants through API or UI.
- In single-company mode, tenant resolution returns the seeded tenant after authentication succeeds.
- If hostname aliases are configured, validate the host against the single company’s allowed hostnames.
- If no OIDC provider is configured, support a local development auth mode only when `ALLOW_DEV_AUTH=true`.
- Documentation must show how to launch single-company mode with Docker Compose.

Suggested command:

```bash
docker compose --profile single-company up --build
```

---

## Authentication and identity

Implement a provider-neutral identity abstraction.

Minimum auth modes:

1. Development auth
   - Only enabled when explicitly configured.
   - Allows local testing without an external IdP.
   - Must be visibly marked unsafe for production.

2. Generic OIDC
   - Tenant/company-level IdP configuration.
   - Supports issuer URL, client ID, client secret reference, callback URL, scopes, and claim mapping.

3. Microsoft 365 / Entra ID preset
   - Implement as OIDC configuration preset, not a bespoke auth path.
   - Allow mapping of Entra ID groups or app roles to app roles.

Data model should include:

```text
identity_providers
  id
  tenant_id
  provider_type              # oidc | microsoft_entra
  issuer_url
  client_id
  client_secret_ref
  allowed_email_domains
  claim_mapping_json
  enabled
  created_at
  updated_at

users
  id
  email
  display_name
  avatar_url
  created_at
  updated_at

tenant_memberships
  id
  tenant_id
  user_id
  role
  external_subject
  external_groups_json
  created_at
  updated_at
```

Auth requirements:

- Validate OIDC issuer.
- Validate audience/client ID.
- Validate callback state.
- Store secrets through the secret/KMS abstraction, not plaintext env once persisted.
- Support just-in-time user provisioning.
- Allow company/tenant admins to restrict login by email domain and/or group/app-role claim.
- Log metadata-only auth events.

---

## Authorization and roles

Implement app-level authorization. Do not rely solely on IdP groups.

Minimum roles:

```text
service_admin        # multi-tenant mode only
company_admin        # same as tenant_admin in single-company mode
tenant_admin
workspace_admin      # optional, may be reserved for later
user
auditor
```

Minimum permissions:

```text
tenant:create
tenant:update
tenant:read
tenant:delete

user:invite
user:update
user:read
user:disable

provider:configure_service
provider:configure_tenant
provider:configure_user
provider:use

prompt:configure_service
prompt:configure_tenant
prompt:configure_user
prompt:read_effective

mcp:install_service
mcp:install_tenant
mcp:install_user
mcp:use

retention:configure
retention:select_ephemeral
retention:select_retained

audit:read
settings:read
settings:update
```

In single-company mode:

- Hide or disable service-admin-only UI.
- Map company admin to tenant admin internally.
- Reject service-level config API writes unless they are explicitly routed to the single company scope.

---

## Effective policy compiler

Create a policy compiler package. This is central.

It should accept:

```ts
type PolicyInput = {
  deploymentMode: "multi_tenant" | "single_company"
  tenantId: string
  userId: string
  groupIds: string[]
  conversationId?: string
  requestedProviderId?: string
  requestedModelId?: string
  requestedRetentionMode?: RetentionMode
  requestedToolIds?: string[]
}
```

It should return:

```ts
type EffectivePolicy = {
  id: string
  deploymentMode: "multi_tenant" | "single_company"
  tenantId: string
  userId: string
  allowedProviderIds: string[]
  defaultProviderId: string
  selectedProviderId: string
  allowedModelIds: string[]
  defaultModelId: string
  selectedModelId: string
  allowedToolIds: string[]
  enabledToolIds: string[]
  retentionMode: RetentionMode
  tracePolicy: "full" | "redacted" | "metadata_only" | "none"
  promptFragmentIds: string[]
  userByoProviderAllowed: boolean
  reasons: PolicyReason[]
}
```

Where:

```ts
type PolicyReason = {
  code: string
  severity: "info" | "warning" | "deny"
  message: string
  sourceScope: "platform" | "service" | "tenant" | "company" | "group" | "user" | "conversation" | "request"
}
```

Merge semantics:

1. `default-overridable`
   - Defaults flow downward.
   - Lower scopes may override if not forbidden.

2. `deny-overrides`
   - Any higher-scope deny prevents lower scopes from re-enabling a capability.

3. `append-with-priority`
   - Prompt fragments, allowed retrieval sources, and plugin/tool declarations may append, then sort by priority.

4. `strictest-retention-wins`
   - A lower-retention mode may be selected when allowed.
   - If company/tenant policy requires ephemeral mode, user cannot select retained.
   - If user selects ephemeral, no lower component may force content retention.

Retention ordering:

```text
ephemeral  <  limited  <  retained
```

Where lower means stricter.

Required tests:

- User provider override works when service and tenant/company allow it.
- User provider override is denied when tenant/company forbids BYO provider.
- Service deny overrides tenant allow.
- Tenant/company deny overrides user allow.
- Single-company mode resolves without a service default row.
- Single-company mode still returns a valid `tenant_id`.
- Ephemeral requested by user results in metadata-only tracing.
- Tenant/company mandatory ephemeral prevents retained conversations.
- Prompt fragments compile in deterministic priority order.
- The policy compiler produces human-readable denial reasons.

---

## Retention model

Create a dedicated retention package.

Modes:

```text
retained
limited
ephemeral
```

### Retained

May store:

- Messages.
- Prompt fragment versions.
- Compiled prompt hash and optionally compiled prompt content.
- Tool traces.
- Attachments.
- Retrieval docs.
- Embeddings.
- Summaries/memory.
- Full audit payloads, subject to redaction.

### Limited

May store:

- Messages.
- Redacted tool traces.
- Redacted provider metadata.
- Attachments only when explicitly attached and allowed.
- No secrets.
- No raw tool payloads from sensitive tools.
- Embeddings only when explicitly allowed by tenant/company policy.

### Ephemeral

Must not store:

- User messages.
- Assistant messages.
- System prompts.
- Compiled prompts.
- Tool arguments.
- Tool results.
- Raw retrieved documents.
- Attachments.
- Embeddings.
- Memory summaries.
- Full provider responses.
- Debug traces containing content.
- Background job payloads containing content.
- Browser localStorage copies of content.

May store metadata-only audit events:

```text
request_id
tenant_id
user_id
timestamp
provider_id
model_id
token counts
latency
retention mode
policy id or policy hash
tool names, not arguments/results
error class
non-reversible HMAC/content hash only if needed
```

Required implementation pattern:

```ts
type RetentionContext = {
  mode: RetentionMode
  canStoreContent: boolean
  canStoreToolPayloads: boolean
  canStoreEmbeddings: boolean
  canStoreDebugTraces: boolean
  auditContentMode: "full" | "redacted" | "metadata_only"
}
```

All content-writing APIs must accept `RetentionContext`.

Forbidden pattern:

```ts
db.message.create({ data: { content: userMessage } }) // no retention check
```

Required pattern:

```ts
messageRepository.createFromRequest(ctx, message)
```

Where the repository enforces retention.

Required no-retention tests:

- Send a unique sentinel string in ephemeral mode.
- Run a chat completion through the mock provider.
- Call at least one mock tool.
- Search the database for the sentinel.
- Search object storage for the sentinel if object storage is used in tests.
- Search job payloads for the sentinel.
- Search vector tables for the sentinel.
- Verify the sentinel does not appear in persistent storage.
- Verify metadata-only audit events still exist.

Use a generated sentinel string similar to:

```text
SENTINEL_EPHEMERAL_DO_NOT_STORE_<uuid>
```

---

## Encryption at rest

Implement encryption as an internal service, not scattered helper calls.

Minimum interfaces:

```ts
interface KmsProvider {
  wrapKey(args: { keyPlaintext: Uint8Array; context: Record<string, string> }): Promise<WrappedKey>
  unwrapKey(args: { wrappedKey: WrappedKey; context: Record<string, string> }): Promise<Uint8Array>
  encrypt?(args: { plaintext: Uint8Array; context: Record<string, string> }): Promise<Ciphertext>
  decrypt?(args: { ciphertext: Ciphertext; context: Record<string, string> }): Promise<Uint8Array>
}

interface ContentCrypto {
  encryptForTenant(args: {
    tenantId: string
    plaintext: string | Uint8Array
    aad: Record<string, string>
  }): Promise<EncryptedBlob>

  decryptForTenant(args: {
    tenantId: string
    blob: EncryptedBlob
    aad: Record<string, string>
  }): Promise<string | Uint8Array>
}
```

Support:

- Local development KMS provider.
- Placeholder/interface for Vault Transit or external KMS.
- Tenant/company data encryption keys.
- Envelope encryption.
- Key metadata table.
- Key rotation design in docs.
- Crypto-shredding design in docs.

Data model:

```text
encryption_keys
  id
  tenant_id
  key_purpose
  wrapped_dek
  kms_provider
  kms_key_id
  status
  created_at
  rotated_at
  disabled_at
```

Content-bearing columns should use encrypted blobs where practical:

```text
content_ciphertext
content_nonce
content_tag
content_key_id
content_hash
```

Acceptance requirements:

- Secrets are not stored plaintext.
- Prompt fragments are encrypted at rest.
- Retained message content is encrypted at rest.
- User provider credentials are encrypted at rest.
- Tests verify plaintext is not visible in raw DB query for encrypted records.
- `.env.example` documents local-dev KMS and production KMS expectations.

---

## Provider gateway

Implement a provider gateway with mock-first development.

Data model:

```text
provider_configs
  id
  scope_type                 # service | tenant | user
  scope_id
  provider_type              # mock | openai_compatible | anthropic_compatible | azure_openai | ollama | custom_http
  display_name
  base_url
  auth_mode                  # none | service_key | tenant_key | user_key
  credential_ref
  retention_policy_class
  supports_streaming
  supports_tool_calling
  supports_json_schema
  supports_embeddings
  enabled
  created_at
  updated_at

model_configs
  id
  provider_config_id
  model_key
  display_name
  context_window
  max_output_tokens
  supports_tools
  supports_streaming
  supports_json_schema
  input_modalities_json
  output_modalities_json
  enabled
  created_at
  updated_at
```

Provider interface:

```ts
interface InferenceProvider {
  id: string
  completeChat(args: ChatCompletionRequest): Promise<ChatCompletionResult>
  streamChat(args: ChatCompletionRequest): AsyncIterable<ChatCompletionStreamEvent>
  embed?(args: EmbeddingRequest): Promise<EmbeddingResult>
  listModels?(): Promise<ModelDescriptor[]>
}
```

Gateway responsibilities:

- Resolve provider/model from `EffectivePolicy`.
- Validate retention compatibility.
- Load credentials server-side only.
- Redact errors.
- Avoid logging prompts/messages unless retention allows.
- Provide a mock provider for deterministic tests.
- Support streaming responses to the UI.

User BYO provider:

- Disabled by default.
- Tenant/company policy can enable it.
- User credentials must be encrypted.
- UI must show whether a BYO provider is allowed.
- Provider endpoint must be validated.
- Do not allow browser-side direct provider calls.
- For custom HTTP providers, support only a constrained OpenAI-compatible shape initially.

Acceptance requirements:

- User can select from allowed models.
- User cannot select disallowed provider/model.
- BYO provider can be configured only when policy allows.
- Mock provider works in local development and tests.
- Streaming path works.
- Provider errors do not leak credentials.

---

## Prompt stack

Implement prompt fragments, not one system prompt blob.

Scopes:

```text
service       # multi-tenant configurable service defaults only
tenant        # tenant/company prompt
group         # optional
user          # user preference prompt
conversation  # temporary/session prompt
```

In single-company mode:

- Hide service prompt configuration.
- Store company prompt as tenant-scope prompt internally.
- Preserve platform invariant prompt as code/static config only.

Data model:

```text
prompt_fragments
  id
  scope_type
  scope_id
  name
  content_ciphertext
  content_hash
  priority
  enabled
  version
  created_by
  created_at
  updated_at

prompt_fragment_versions
  id
  prompt_fragment_id
  version
  content_ciphertext
  content_hash
  created_by
  created_at
```

Prompt compiler output:

```ts
type CompiledPrompt = {
  fragmentIds: string[]
  fragmentVersions: number[]
  systemMessages: Array<{ name: string; content: string }>
  compiledHash: string
}
```

Rules:

- Deterministic ordering.
- Higher-priority fragments appear in predictable order.
- Authorization/security rules must not rely on prompts alone.
- In retained mode, store prompt compilation metadata.
- In ephemeral mode, do not store prompt content or compiled prompt content.
- Admins may preview effective prompt only if permission and retention policy allow.

Acceptance requirements:

- Company/tenant prompt affects mock provider response in retained mode.
- User prompt composes with tenant/company prompt.
- Service prompt is hidden in single-company mode.
- Prompt fragments are encrypted at rest.
- Ephemeral mode does not persist compiled prompt content.

---

## MCP/plugin gateway

Implement the registry and policy boundary before implementing many real tools.

MCP/plugin data model:

```text
mcp_servers
  id
  name
  description
  transport_type             # mock | http | stdio
  server_url
  container_image
  command
  args_json
  env_secret_refs_json
  risk_level                 # low | medium | high
  retention_policy_class
  enabled
  created_at
  updated_at

plugin_installations
  id
  scope_type                 # service | tenant | user
  scope_id
  mcp_server_id
  config_ciphertext
  enabled
  installed_by
  approved_by
  created_at
  updated_at

tool_permissions
  id
  tenant_id
  tool_id
  subject_type               # tenant | group | user
  subject_id
  permission                 # use | administer
  requires_confirmation
  created_at
  updated_at

tool_invocations
  id
  tenant_id
  user_id
  conversation_id
  request_id
  tool_id
  status
  args_ciphertext_nullable
  result_ciphertext_nullable
  metadata_json
  retention_mode
  created_at
```

Execution flow:

```text
model requests tool call
  ↓
runtime validates tool exists in EffectivePolicy
  ↓
MCP/plugin gateway checks tenant/user permission
  ↓
gateway injects scoped credentials
  ↓
gateway enforces retention context
  ↓
tool executes
  ↓
result is classified/redacted if necessary
  ↓
result returns to model
  ↓
metadata audit event is written
```

Initial implementation:

- Include a mock MCP/tool server with read-only tools.
- Include one "dangerous" mock tool requiring confirmation.
- Build UI timeline for tool calls.
- Implement permission checks.
- Implement retention behavior for tool invocations.
- Stub HTTP/stdio MCP support behind interfaces if full MCP protocol implementation is too large for the first pass.
- Do not execute arbitrary local commands from untrusted plugin config in MVP.
- Do not mount host Docker socket.
- Do not pass provider/user secrets to tools unless specifically scoped.

Acceptance requirements:

- Allowed mock tool can run.
- Disallowed tool is denied.
- Dangerous tool requires confirmation.
- Tool arguments/results are stored only when retention allows.
- Ephemeral mode stores tool metadata but not arguments/results.
- Tenant/company admin can enable/disable a mock plugin.
- User can enable/disable a permitted user-level plugin.

---

## Chat runtime

The chat runtime should be a backend service/module that accepts a request context and runs:

```text
resolve tenant/company
authenticate user
compile effective policy
compile prompt stack
resolve provider/model
resolve allowed tools
run model request
handle tool calls
stream output
write storage/audit according to retention
```

Core request type:

```ts
type ChatRequest = {
  tenantSlugOrHost?: string
  conversationId?: string
  message: string
  requestedProviderId?: string
  requestedModelId?: string
  requestedRetentionMode?: RetentionMode
  enabledToolIds?: string[]
}
```

Core response stream events:

```ts
type ChatStreamEvent =
  | { type: "policy"; policySummary: SafePolicySummary }
  | { type: "message_delta"; delta: string }
  | { type: "tool_call_requested"; toolCall: SafeToolCallSummary }
  | { type: "tool_call_completed"; toolResult: SafeToolResultSummary }
  | { type: "message_done"; messageId?: string }
  | { type: "error"; error: SafeError }
```

Requirements:

- Do not stream raw secrets.
- Do not expose internal policy details beyond safe summaries.
- In ephemeral mode, the response should still stream normally but not persist content.
- Retained conversations should be reloadable.
- Ephemeral conversations should disappear after page reload unless explicitly held in volatile in-memory state during the active session.
- Browser must not store ephemeral messages in localStorage.

---

## Frontend requirements

Build enough UI to exercise the control plane.

Minimum pages:

```text
/login
/chat
/settings
/admin/company
/admin/providers
/admin/prompts
/admin/plugins
/admin/retention
/admin/audit
```

In multi-tenant mode, also include:

```text
/admin/service
/admin/tenants
```

In single-company mode:

- Hide `/admin/service`.
- Hide tenant creation/tenant list.
- Label admin areas as company admin.
- Show configured company name.
- Tenant/company selector must not appear.

Chat UI must include:

- Conversation list for retained conversations.
- New chat button.
- Message composer.
- Streaming assistant response.
- Provider/model selector.
- Retention mode selector.
- Visible retention mode indicator.
- Tool/plugin drawer.
- Tool-call timeline.
- Error states with actionable denial reasons.

Admin UI must include:

- Provider defaults.
- User BYO provider allow/deny.
- Prompt fragment management.
- Retention defaults.
- Plugin enable/disable.
- OIDC config placeholder/form.
- Audit log.

User settings must include:

- Personal provider preference.
- BYO provider credentials when allowed.
- Personal prompt.
- Default retention preference when allowed.
- Enabled user plugins when allowed.

Frontend safety requirements:

- Do not store provider credentials in localStorage.
- Do not store chat content in localStorage.
- Use secure HTTP-only cookies for sessions when applicable.
- Clearly mark development auth mode.
- In ephemeral mode, warn that the app does not retain content, but external providers/tools may process it.

---

## API requirements

Use typed API contracts. REST is fine. tRPC is fine. GraphQL is unnecessary unless already present.

Minimum API surface:

```text
GET    /api/config/public
GET    /api/me
GET    /api/policy/effective

POST   /api/chat
GET    /api/conversations
GET    /api/conversations/:id
DELETE /api/conversations/:id

GET    /api/providers
POST   /api/providers
PATCH  /api/providers/:id
DELETE /api/providers/:id
POST   /api/providers/:id/test

GET    /api/models
POST   /api/models
PATCH  /api/models/:id

GET    /api/prompts
POST   /api/prompts
PATCH  /api/prompts/:id
DELETE /api/prompts/:id
GET    /api/prompts/effective-preview

GET    /api/plugins
POST   /api/plugins
PATCH  /api/plugins/:id
POST   /api/plugins/:id/test

GET    /api/retention
PATCH  /api/retention

GET    /api/audit

GET    /api/admin/tenants             # multi-tenant mode only
POST   /api/admin/tenants             # multi-tenant mode only
PATCH  /api/admin/tenants/:id         # multi-tenant mode only
```

All mutation routes must enforce authorization. All content-handling routes must enforce retention.

---

## Database schema requirements

Create migrations for these core tables:

```text
tenants
users
tenant_memberships
identity_providers

roles
permissions
role_permissions

provider_configs
provider_credentials
model_configs
user_provider_preferences

prompt_fragments
prompt_fragment_versions
prompt_compilations

retention_policies
effective_policy_snapshots

conversations
messages
message_parts
attachments

mcp_servers
plugin_installations
tool_permissions
tool_invocations

audit_events
encryption_keys
background_jobs
```

Every tenant-scoped table should include:

```text
tenant_id
created_at
updated_at
deleted_at nullable
```

Every content-bearing record should include enough fields to support encryption and retention:

```text
content_ciphertext nullable
content_hash nullable
content_key_id nullable
retention_mode
```

Avoid plaintext content columns for durable records unless they are strictly development-only and guarded by tests/config.

---

## Docker and local development

Provide:

```text
docker-compose.yml
.env.example
Makefile or package scripts
README quickstart
```

Local services:

```text
web/api app
Postgres
Redis or Valkey
MinIO
optional local mock MCP server
```

Required commands:

```bash
cp .env.example .env
docker compose --profile dev up --build
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm test
pnpm test:e2e
pnpm lint
pnpm typecheck
```

Single-company command:

```bash
APP_DEPLOYMENT_MODE=single_company docker compose --profile single-company up --build
```

Multi-tenant command:

```bash
APP_DEPLOYMENT_MODE=multi_tenant docker compose --profile multi-tenant up --build
```

The exact package manager may differ, but document the actual commands.

---

## Testing requirements

Do not treat tests as optional. Build tests as the architecture is implemented.

Minimum test groups:

### Unit tests

- Policy compiler.
- Prompt compiler.
- Retention context builder.
- Crypto envelope encryption/decryption.
- Provider gateway selection.
- MCP permission checks.
- Deployment mode behavior.

### Integration tests

- DB migrations run.
- Single-company seed works.
- Multi-tenant seed works.
- Retained chat persists encrypted message.
- Ephemeral chat does not persist sentinel content.
- Provider credentials are encrypted.
- Prompt fragments are encrypted.
- Tool invocation retention behavior.
- Audit metadata written.

### End-to-end tests

- Development login.
- New retained chat.
- New ephemeral chat.
- Provider/model selector.
- Company admin changes default provider.
- Company admin changes retention default.
- User BYO provider is hidden when disabled.
- User BYO provider appears when enabled.
- Single-company mode hides service/tenant admin UI.
- Multi-tenant mode shows tenant admin UI to service admin.

### Security regression tests

- No raw credential appears in API response.
- No ephemeral sentinel appears in DB.
- No ephemeral sentinel appears in object storage.
- Disallowed provider is rejected.
- Disallowed tool is rejected.
- Service/tenant deny overrides user allow.
- Browser does not use localStorage for chat messages.

If a test cannot be fully implemented because of environment limitations, create a skipped test with a clear reason and a TODO linked to the relevant acceptance criterion. Do not silently omit it.

---

## Documentation requirements

Create or update:

```text
README.md
docs/architecture.md
docs/deployment.md
docs/single-company-mode.md
docs/multi-tenant-mode.md
docs/retention.md
docs/encryption.md
docs/provider-gateway.md
docs/mcp-gateway.md
docs/prompt-stack.md
docs/testing.md
docs/security.md
```

Documentation must include:

- Architecture diagram in text/mermaid.
- Deployment mode explanation.
- Single-company configuration.
- Multi-tenant configuration.
- OIDC/Microsoft 365 setup placeholders.
- Retention guarantees and limits.
- Encryption model.
- Provider adapter model.
- MCP/plugin risk model.
- How to run tests.
- Known limitations.

---

## Suggested parallel workstreams

Use these if Codex supports parallel tasks/subagents/worktrees.

### Workstream A: Foundation and infrastructure

Tasks:

- Scaffold monorepo.
- Add TypeScript strict config.
- Add lint/typecheck/test scripts.
- Add Docker Compose with Postgres, Redis/Valkey, MinIO.
- Add typed environment config.
- Add database schema and migrations.
- Add seed scripts for dev, multi-tenant, and single-company mode.

Deliverables:

- App boots locally.
- Migrations run.
- Seeds work.
- README quickstart works.

### Workstream B: Policy, retention, crypto

Tasks:

- Implement EffectivePolicy compiler.
- Implement deployment-mode handling.
- Implement retention package.
- Implement encryption/KMS abstraction.
- Add core tests.

Deliverables:

- Policy tests pass.
- Encryption tests pass.
- Retention sentinel tests pass.

### Workstream C: Chat runtime and provider gateway

Tasks:

- Implement provider gateway.
- Add mock provider.
- Add OpenAI-compatible adapter shape.
- Implement chat API.
- Implement streaming.
- Implement retained and ephemeral storage behavior.

Deliverables:

- Chat API works.
- Streaming works.
- Retained messages persist encrypted.
- Ephemeral messages do not persist content.

### Workstream D: Frontend and admin UI

Tasks:

- Build login/dev-auth flow.
- Build chat UI.
- Build company admin UI.
- Build provider/model settings UI.
- Build prompt settings UI.
- Build retention settings UI.
- Build plugin settings UI.
- Hide/show UI based on deployment mode and permissions.

Deliverables:

- E2E tests for chat/admin pass.
- Single-company UI hides service/tenant-admin surfaces.

### Workstream E: MCP/plugin gateway

Tasks:

- Build plugin registry.
- Build mock MCP/tool server.
- Add tool permissions.
- Add tool-call timeline.
- Add dangerous tool confirmation flow.
- Add retention-aware tool invocation storage.

Deliverables:

- Allowed mock tool runs.
- Disallowed tool is denied.
- Dangerous tool requires confirmation.
- Tool args/results obey retention mode.

### Workstream F: Documentation and hardening

Tasks:

- Write docs.
- Add security tests.
- Add error redaction.
- Add audit event review.
- Add `.env.example`.
- Add final validation checklist.

Deliverables:

- Docs complete.
- Final validation script/checklist passes.

---

## Implementation phases

If not using parallel workstreams, proceed in this order.

### Phase 1: Repository inspection and scaffold

1. Inspect the existing repository.
2. Determine whether it is empty, partially scaffolded, or already an app.
3. If empty, scaffold the recommended TypeScript monorepo.
4. If partially scaffolded, preserve useful structure and adapt this goal to it.
5. Add `docs/codex-progress.md` with a checklist copied from this goal.
6. Add scripts for lint, typecheck, test, dev, build.
7. Add `.env.example`.

Done when:

- `pnpm install` or equivalent works.
- `pnpm lint`, `pnpm typecheck`, and `pnpm test` exist.
- The app can start in development mode, even if it only shows a placeholder.

### Phase 2: Data model and deployment modes

1. Add DB schema/migrations.
2. Add typed deployment mode config.
3. Add tenant/company seed.
4. Implement single-company boot behavior.
5. Implement multi-tenant seed behavior.
6. Add tests for mode behavior.

Done when:

- Single-company seed creates exactly one tenant/company.
- Multi-tenant seed can create multiple tenants.
- Single-company APIs reject additional tenant creation.
- Internal tables still use `tenant_id`.

### Phase 3: Auth shell

1. Implement dev auth.
2. Implement OIDC configuration model.
3. Add Microsoft 365/Entra preset fields.
4. Add membership/role model.
5. Add route guards.
6. Add basic `/login`, `/chat`, `/settings`, and admin shell.

Done when:

- Dev auth works.
- Protected pages require a session.
- User has a tenant/company membership.
- Single-company mode routes user to the single company.

### Phase 4: Policy compiler

1. Implement policy input/output types.
2. Implement merge rules.
3. Implement default provider/model selection.
4. Implement BYO provider gating.
5. Implement retention strictness.
6. Implement prompt fragment collection.
7. Add tests.

Done when:

- Policy tests pass.
- API can return a safe effective policy summary.
- UI can show selected model, tools, and retention mode from policy.

### Phase 5: Encryption and secrets

1. Implement local KMS provider.
2. Implement content crypto.
3. Add encryption key metadata.
4. Encrypt provider credentials.
5. Encrypt prompt fragments.
6. Encrypt retained message content.
7. Add tests that query raw DB values.

Done when:

- Raw DB does not contain plaintext secrets/prompts/messages for encrypted records.
- Decrypt works through application services.
- Docs describe production KMS expectations.

### Phase 6: Provider gateway and chat API

1. Implement provider gateway.
2. Add mock provider.
3. Add OpenAI-compatible provider adapter shape.
4. Implement chat API.
5. Implement streaming response.
6. Add retained conversation storage.
7. Add ephemeral no-content-persistence path.
8. Add tests.

Done when:

- User can send a message and receive a streamed mock response.
- Retained messages reload.
- Ephemeral messages do not persist.
- Provider/model selection obeys policy.

### Phase 7: Prompt stack

1. Add prompt CRUD.
2. Add prompt versions.
3. Add prompt compiler.
4. Add admin prompt UI.
5. Add user prompt UI.
6. Add retained/ephemeral prompt behavior.
7. Add tests.

Done when:

- Tenant/company prompt and user prompt compile deterministically.
- Single-company mode hides service prompt UI.
- Prompt content is encrypted.
- Ephemeral compiled prompt is not stored.

### Phase 8: MCP/plugin gateway

1. Add plugin registry.
2. Add mock tool server.
3. Add tool permissions.
4. Add tool invocation flow.
5. Add dangerous tool confirmation.
6. Add tool timeline UI.
7. Add retention-aware tool storage.
8. Add tests.

Done when:

- Allowed tool runs.
- Disallowed tool fails with clear denial reason.
- Dangerous tool requires confirmation.
- Tool args/results are not stored in ephemeral mode.

### Phase 9: Admin and settings UX

1. Build company admin pages.
2. Build multi-tenant service admin pages.
3. Build provider settings.
4. Build retention settings.
5. Build plugin settings.
6. Build audit log.
7. Build user settings.
8. Add E2E coverage.

Done when:

- Single-company mode shows company admin only.
- Multi-tenant mode shows tenant/service admin based on role.
- Company admin can change default model/retention.
- User settings respect policy.

### Phase 10: Final hardening

1. Run all tests.
2. Run lint and typecheck.
3. Verify Docker Compose quickstart.
4. Verify single-company launch path.
5. Verify multi-tenant launch path.
6. Review API responses for credential leaks.
7. Review localStorage/sessionStorage usage.
8. Complete docs.
9. Fill in known limitations.

Done when:

- All non-skipped tests pass.
- Skipped tests have explicit reasons.
- README quickstart works.
- Final acceptance checklist is complete.

---

## Acceptance checklist

The goal is complete only when all applicable items are checked.

### App boot and repo hygiene

- [ ] Project installs cleanly.
- [ ] App starts locally.
- [ ] Docker Compose starts local dependencies.
- [ ] Lint passes.
- [ ] Typecheck passes.
- [ ] Unit tests pass.
- [ ] Integration tests pass where environment allows.
- [ ] E2E tests pass where environment allows.
- [ ] `.env.example` is complete.
- [ ] README quickstart is accurate.

### Deployment modes

- [ ] `APP_DEPLOYMENT_MODE=single_company` works.
- [ ] `APP_DEPLOYMENT_MODE=multi_tenant` works.
- [ ] Single-company mode seeds exactly one tenant/company.
- [ ] Single-company mode hides service admin UI.
- [ ] Single-company mode hides tenant creation/list UI.
- [ ] Multi-tenant mode supports multiple tenants.
- [ ] Internal records remain tenant-scoped in both modes.
- [ ] Docs explain migration path from single-company to multi-tenant.

### Identity and auth

- [ ] Development auth works only when explicitly enabled.
- [ ] OIDC config model exists.
- [ ] Microsoft 365/Entra preset exists or is documented with config placeholders.
- [ ] User membership and roles work.
- [ ] Auth events create audit metadata.
- [ ] Unauthorized pages/API calls are blocked.

### Policy

- [ ] EffectivePolicy compiler exists.
- [ ] Service defaults work in multi-tenant mode.
- [ ] Company/tenant defaults work.
- [ ] User overrides work when allowed.
- [ ] Deny-overrides behavior works.
- [ ] Strictest-retention-wins behavior works.
- [ ] Policy denial reasons are visible to API/UI.
- [ ] Tests cover all policy merge rules.

### Providers

- [ ] Provider gateway exists.
- [ ] Mock provider works.
- [ ] OpenAI-compatible adapter shape exists.
- [ ] Provider credentials are server-side only.
- [ ] User BYO provider is disabled by default.
- [ ] User BYO provider can be enabled by company/tenant policy.
- [ ] Disallowed provider/model selection is rejected.
- [ ] Streaming chat works.

### Prompts

- [ ] Prompt fragments exist.
- [ ] Tenant/company prompt exists.
- [ ] User prompt exists.
- [ ] Prompt compiler is deterministic.
- [ ] Prompt fragments are encrypted.
- [ ] Single-company mode hides service prompt configuration.
- [ ] Ephemeral mode does not persist compiled prompt content.

### Retention

- [ ] Retained mode stores encrypted content.
- [ ] Limited mode redacts configured sensitive content.
- [ ] Ephemeral mode stores no content.
- [ ] Ephemeral mode stores metadata-only audit events.
- [ ] No vector indexing happens in ephemeral mode.
- [ ] No background job payload contains ephemeral content.
- [ ] Browser does not store chat content in localStorage.
- [ ] Sentinel no-retention test passes.

### Encryption

- [ ] Local KMS provider exists.
- [ ] Production KMS/Vault adapter interface exists.
- [ ] Tenant/company DEK metadata exists.
- [ ] Provider credentials are encrypted.
- [ ] Prompt fragments are encrypted.
- [ ] Retained messages are encrypted.
- [ ] Raw DB plaintext tests pass.
- [ ] Docs explain key rotation and crypto-shredding.

### MCP/plugins

- [ ] MCP/plugin registry exists.
- [ ] Mock tool/plugin exists.
- [ ] Plugin installation scope exists.
- [ ] Tool permissions exist.
- [ ] Dangerous tool confirmation exists.
- [ ] Tool-call timeline exists.
- [ ] Tool args/results obey retention mode.
- [ ] Disallowed tools are rejected.

### UI

- [ ] Login page exists.
- [ ] Chat page exists.
- [ ] Settings page exists.
- [ ] Company admin pages exist.
- [ ] Multi-tenant service admin pages exist where applicable.
- [ ] Provider/model selector exists.
- [ ] Retention mode selector exists.
- [ ] Tool/plugin drawer exists.
- [ ] Tool-call timeline exists.
- [ ] Audit log page exists.
- [ ] UI reflects deployment mode and permissions.

### Docs

- [ ] `docs/architecture.md` exists.
- [ ] `docs/deployment.md` exists.
- [ ] `docs/single-company-mode.md` exists.
- [ ] `docs/multi-tenant-mode.md` exists.
- [ ] `docs/retention.md` exists.
- [ ] `docs/encryption.md` exists.
- [ ] `docs/provider-gateway.md` exists.
- [ ] `docs/mcp-gateway.md` exists.
- [ ] `docs/prompt-stack.md` exists.
- [ ] `docs/testing.md` exists.
- [ ] `docs/security.md` exists.

---

## Final validation commands

Before declaring completion, run the closest equivalent of:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
docker compose --profile single-company config
docker compose --profile multi-tenant config
```

Then manually verify:

```text
single-company dev login → chat → retained message reloads
single-company dev login → ephemeral chat → page reload loses content
company admin → change default model → new chat uses it
company admin → disable BYO provider → user settings hides BYO provider
company admin → enable BYO provider → user settings shows BYO provider
company admin → edit company prompt → prompt affects mock response
plugin drawer → allowed mock tool runs
plugin drawer → dangerous mock tool requests confirmation
audit log → metadata appears
raw DB search → no plaintext secret/prompt/message for encrypted records
raw DB search → ephemeral sentinel is absent
```

---

## Known limitations acceptable for the first complete pass

These are acceptable only if documented clearly:

- Full production Microsoft 365 login may be represented by a generic OIDC implementation and documented Entra configuration fields if no real IdP credentials are available.
- Full MCP protocol support may be represented by a gateway interface plus mock tools, with HTTP/stdio MCP adapters stubbed behind interfaces.
- Production KMS may be represented by an adapter interface and local KMS implementation, with Vault/external KMS documented if the environment cannot run Vault.
- Kubernetes Helm chart may be a scaffold if Docker Compose is complete.
- Real provider calls may be disabled without credentials, but mock provider must fully work.
- SAML can be deferred.
- Billing/cost accounting can be metadata-only unless already easy to implement.

These are not acceptable shortcuts:

- Storing plaintext retained content without encryption.
- Claiming ephemeral mode while writing content to the DB/logs/vector store.
- Letting UI enforce provider/tool permissions without backend checks.
- Exposing credentials to the browser.
- Implementing single-company mode as a separate fork.
- Ignoring tenant/company scoping internally.
- Skipping policy compiler tests.
- Skipping no-retention sentinel tests.

---

## Completion statement format

When done, update `docs/codex-progress.md` and include:

```text
Completed:
- ...

Validation performed:
- command: ...
  result: ...

Known limitations:
- ...

Manual verification:
- ...

Files changed:
- ...
```

Do not mark this goal complete until the implementation, tests, docs, and final validation are actually in place.
