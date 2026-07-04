# Single-Company Mode

Required configuration:

```text
APP_DEPLOYMENT_MODE=single_company
SINGLE_COMPANY_TENANT_SLUG=acme
SINGLE_COMPANY_TENANT_NAME=Acme Internal AI
PUBLIC_BASE_URL=https://ai.acme.example
```

Behavior implemented:

- Boot/seed creates one tenant/company.
- Internal records still use `tenant_id`.
- Tenant creation through the API/repository is rejected in single-company mode.
- Service admin and tenant list UI are hidden or return `notFound()`.
- Company prompt/provider/retention settings are stored as tenant-scope settings internally.

Migration to multi-tenant mode keeps the existing company as a tenant and enables service-level defaults and tenant administration.
