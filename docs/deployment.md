# Deployment

## Local npm

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

## Docker Compose

Compose defines the app, Postgres, Valkey, and MinIO with `dev`, `single-company`, and `multi-tenant` profiles.

```bash
docker compose --profile dev up --build
APP_DEPLOYMENT_MODE=single_company docker compose --profile single-company up --build
APP_DEPLOYMENT_MODE=multi_tenant docker compose --profile multi-tenant up --build
```

The app includes a SQL repository adapter for the Postgres baseline and uses an embedded Postgres-compatible engine in tests. The default development app path still uses the in-memory repository so it can run without local services. Production deployments should wire the SQL adapter to `DATABASE_URL`, Valkey/Redis for ephemeral coordination, S3-compatible object storage for blobs, and Vault Transit or another external KMS through the provider interface.
