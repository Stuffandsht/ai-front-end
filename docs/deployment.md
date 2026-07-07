# Deployment

## Local npm

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

The default local npm path uses `APP_DATABASE_MODE=memory` so it can run without services. To run the app against Postgres:

```bash
APP_DATABASE_MODE=postgres npm run db:migrate:postgres
APP_DATABASE_MODE=postgres npm run db:seed
APP_DATABASE_MODE=postgres npm run dev
```

## Docker Compose

Compose defines the app, Postgres, Valkey, and MinIO with `dev`, `single-company`, and `multi-tenant` profiles.

```bash
docker compose --profile dev up --build
APP_DEPLOYMENT_MODE=single_company docker compose --profile single-company up --build
APP_DEPLOYMENT_MODE=multi_tenant docker compose --profile multi-tenant up --build
```

The Compose app service sets `APP_DATABASE_MODE=postgres`, runs `npm run db:migrate:postgres`, then starts Next.js. The live app therefore uses the SQL runtime repository against `DATABASE_URL`; Valkey/Redis and S3-compatible object storage remain later production hardening points.

## OIDC

Set `OIDC_ENABLED=true`, `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET_REF=env://OIDC_CLIENT_SECRET` to seed a tenant identity provider at startup. The browser starts the authorization flow at `/api/auth/oidc/start`; the callback validates state, exchanges the code, verifies the ID token against JWKS, provisions the user, and sets the server session cookie.

## Vault Transit KMS

Set `KMS_PROVIDER=vault_transit`, `VAULT_ADDR`, `VAULT_TRANSIT_KEY`, and `VAULT_TOKEN` for SQL-backed runtimes that should wrap tenant DEKs through Vault Transit instead of the local development KMS.
