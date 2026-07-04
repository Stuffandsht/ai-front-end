# Architecture

```mermaid
flowchart TD
  Browser[Browser UI] --> Routes[Next.js route handlers]
  Routes --> Runtime[Chat runtime]
  Runtime --> Policy[Effective policy compiler]
  Runtime --> Prompts[Prompt stack compiler]
  Runtime --> Providers[Provider gateway]
  Runtime --> MCP[MCP/plugin gateway]
  Runtime --> Retention[Retention context]
  Runtime --> Repos[Retention-aware repositories]
  Repos --> Crypto[Envelope encryption / KMS]
  Repos --> Postgres[(Postgres baseline / SQL adapter)]
  Repos --> ObjectStore[(S3-compatible blobs)]
  Runtime --> Audit[Audit events]
  Providers --> Mock[Mock provider]
  Providers --> OpenAIShape[OpenAI-compatible adapter shape]
  MCP --> MockTools[Mock read-only and dangerous tools]
```

The UI is intentionally thin. Policy, provider selection, retention enforcement, prompt composition, tool permission checks, audit writing, and encryption live in packages used by both API routes and tests.

Single-company mode uses the same tenant-scoped data model as multi-tenant mode. The UI labels tenant-scope configuration as company configuration and hides service/tenant administration surfaces.
