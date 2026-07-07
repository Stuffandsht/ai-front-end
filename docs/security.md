# Security

Security controls implemented in the skeleton:

- backend policy compiler enforces provider/model/tool/retention choices.
- tenant-scoped data model is used in both deployment modes.
- development auth is explicit and marked unsafe for production.
- OIDC routes validate discovery issuer, callback state signatures, authorization-code token responses, JWKS-backed ID token signatures, issuer/audience/time/email domain claims, and Microsoft Entra claim mappings.
- API mutation routes use backend role/permission checks through the shared authorization matrix.
- Admin pages use backend page permission checks, and navigation hides admin links the active role cannot use.
- provider credentials are encrypted and only referenced server-side.
- prompt fragments and retained messages are encrypted at rest.
- MCP and platform plugin install config is encrypted at rest; MCP env values are stored as references rather than raw secrets.
- ephemeral mode avoids durable content writes rather than relying on cleanup.
- audit events are metadata-only in ephemeral mode.
- dangerous tools require confirmation and denied/confirmation-required tool calls stop the runtime loop.
- tool arguments and results follow retention mode: retained mode encrypts payloads, limited/ephemeral modes avoid payload storage.
- platform plugins are manifest-only and do not register executable tools outside MCP.
- API-shaped provider responses omit credential material.
- browser source has no chat-content `localStorage` or `sessionStorage` writes.
- security tests scan API mutation routes and admin pages to ensure backend authorization wrappers remain in place.

Production hardening still needed:

- exact Docker Compose CLI smoke test after installing the Docker Compose plugin; equivalent Podman Compose full-stack smoke passed here.
