# Security

Security controls implemented in the skeleton:

- backend policy compiler enforces provider/model/tool/retention choices.
- tenant-scoped data model is used in both deployment modes.
- development auth is explicit and marked unsafe for production.
- OIDC helpers validate discovery issuer, ID token issuer/audience/time/email domain, callback state signatures, and Microsoft Entra claim mappings.
- API mutation routes use backend role/permission checks through the shared authorization matrix.
- Admin pages use backend page permission checks, and navigation hides admin links the active role cannot use.
- provider credentials are encrypted and only referenced server-side.
- prompt fragments and retained messages are encrypted at rest.
- ephemeral mode avoids durable content writes rather than relying on cleanup.
- audit events are metadata-only in ephemeral mode.
- dangerous mock tools require confirmation.
- API-shaped provider responses omit credential material.
- browser source has no chat-content `localStorage` or `sessionStorage` writes.
- security tests scan API mutation routes and admin pages to ensure backend authorization wrappers remain in place.

Production hardening still needed:

- live OIDC network callback/token exchange wiring.
- external Postgres connectivity smoke test after wiring the running app to the SQL repository for `DATABASE_URL`.
- production KMS implementation.
- exact Docker CLI smoke test in an environment with Docker installed; equivalent Podman Compose full-stack smoke passed here.
