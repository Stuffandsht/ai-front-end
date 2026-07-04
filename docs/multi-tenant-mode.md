# Multi-Tenant Mode

Enable with:

```text
APP_DEPLOYMENT_MODE=multi_tenant
```

Multi-tenant mode allows multiple tenants, exposes service and tenant administration pages, and includes service defaults in policy resolution before tenant/group/user/conversation/request scopes.

Tenant resolution is represented by slug/host lookup in the repository. Production deployments should bind hostnames and login discovery to the same tenant resolver.
