import { describe, expect, it } from "vitest";
import {
  createCallbackState,
  developmentAuthAllowed,
  microsoftEntraPreset,
  provisionIdentityFromClaims,
  authorizeRole,
  validateCallbackState,
  validateIdTokenClaims,
  validateOidcDiscovery
} from "@agent-platform/auth";
import { testConfig } from "@agent-platform/test-utils";

describe("auth and OIDC helpers", () => {
  it("creates a Microsoft Entra preset as an OIDC configuration", () => {
    const config = microsoftEntraPreset({
      tenantId: "tenant_1",
      entraTenantId: "entra-tenant",
      clientId: "client-id",
      clientSecretRef: "secret://tenant/oidc",
      callbackUrl: "http://localhost:3000/api/auth/oidc/callback",
      allowedEmailDomains: ["example.com"]
    });

    expect(config.providerType).toBe("microsoft_entra");
    expect(config.issuerUrl).toBe("https://login.microsoftonline.com/entra-tenant/v2.0");
    expect(config.scopes).toContain("openid");
  });

  it("validates OIDC discovery issuer and required endpoints", () => {
    const config = microsoftEntraPreset({
      tenantId: "tenant_1",
      entraTenantId: "entra-tenant",
      clientId: "client-id",
      clientSecretRef: "secret://tenant/oidc",
      callbackUrl: "http://localhost/callback"
    });

    expect(
      validateOidcDiscovery(config, {
        issuer: config.issuerUrl,
        authorization_endpoint: "https://login.example/authorize",
        token_endpoint: "https://login.example/token",
        jwks_uri: "https://login.example/jwks",
        response_types_supported: ["code"]
      })
    ).toEqual({ ok: true });
    expect(
      validateOidcDiscovery(config, {
        issuer: "https://wrong.example",
        authorization_endpoint: "https://login.example/authorize",
        token_endpoint: "https://login.example/token",
        jwks_uri: "https://login.example/jwks"
      })
    ).toMatchObject({ ok: false, code: "OIDC_ISSUER_MISMATCH" });
  });

  it("validates ID token issuer, audience, time, and allowed email domain", () => {
    const config = microsoftEntraPreset({
      tenantId: "tenant_1",
      entraTenantId: "entra-tenant",
      clientId: "client-id",
      clientSecretRef: "secret://tenant/oidc",
      callbackUrl: "http://localhost/callback",
      allowedEmailDomains: ["example.com"]
    });

    expect(
      validateIdTokenClaims(
        config,
        {
          iss: config.issuerUrl,
          aud: "client-id",
          sub: "subject",
          exp: 200,
          email: "person@example.com"
        },
        100
      )
    ).toEqual({ ok: true });
    expect(
      validateIdTokenClaims(
        config,
        {
          iss: config.issuerUrl,
          aud: "other-client",
          sub: "subject",
          exp: 200,
          email: "person@example.com"
        },
        100
      )
    ).toMatchObject({ ok: false, code: "TOKEN_AUDIENCE_MISMATCH" });
    expect(
      validateIdTokenClaims(
        config,
        {
          iss: config.issuerUrl,
          aud: "client-id",
          sub: "subject",
          exp: 200,
          email: "person@other.test"
        },
        100
      )
    ).toMatchObject({ ok: false, code: "EMAIL_DOMAIN_DENIED" });
  });

  it("validates callback state signature, context, and max age", () => {
    const state = createCallbackState({
      sessionId: "session_1",
      tenantId: "tenant_1",
      returnTo: "/chat",
      secret: "state-secret",
      issuedAt: 1000
    });

    expect(
      validateCallbackState(state, {
        sessionId: "session_1",
        tenantId: "tenant_1",
        secret: "state-secret",
        now: 1200
      })
    ).toEqual({ ok: true });
    expect(
      validateCallbackState(`${state}x`, {
        sessionId: "session_1",
        tenantId: "tenant_1",
        secret: "state-secret"
      })
    ).toMatchObject({ ok: false, code: "STATE_SIGNATURE_INVALID" });
    expect(
      validateCallbackState(state, {
        sessionId: "session_2",
        tenantId: "tenant_1",
        secret: "state-secret"
      })
    ).toMatchObject({ ok: false, code: "STATE_CONTEXT_MISMATCH" });
  });

  it("maps claims to a provisioned identity and app roles", () => {
    const config = microsoftEntraPreset({
      tenantId: "tenant_1",
      entraTenantId: "entra-tenant",
      clientId: "client-id",
      clientSecretRef: "secret://tenant/oidc",
      callbackUrl: "http://localhost/callback"
    });

    const identity = provisionIdentityFromClaims(
      config,
      {
        iss: config.issuerUrl,
        aud: "client-id",
        sub: "subject",
        exp: 200,
        email: "person@example.com",
        name: "Person Example",
        groups: ["entra-admins"],
        roles: ["auditors"]
      },
      {
        "entra-admins": "company_admin",
        auditors: "auditor"
      }
    );

    expect(identity).toMatchObject({
      email: "person@example.com",
      displayName: "Person Example",
      externalSubject: "subject",
      externalGroups: ["entra-admins", "auditors"],
      mappedRoles: ["company_admin", "auditor"]
    });
  });

  it("keeps development auth explicitly gated", () => {
    expect(developmentAuthAllowed(testConfig({ ALLOW_DEV_AUTH: "true", PUBLIC_BASE_URL: "http://localhost:3000" }))).toEqual({ ok: true });
    expect(developmentAuthAllowed(testConfig({ ALLOW_DEV_AUTH: "false" }))).toMatchObject({ ok: false, code: "DEV_AUTH_DISABLED" });
    expect(developmentAuthAllowed(testConfig({ ALLOW_DEV_AUTH: "true", PUBLIC_BASE_URL: "https://ai.example.com" }))).toMatchObject({
      ok: false,
      code: "DEV_AUTH_PUBLIC_URL"
    });
  });

  it("enforces deployment-aware role permissions", () => {
    expect(authorizeRole({ role: "company_admin", permission: "provider:configure_tenant", deploymentMode: "single_company" })).toMatchObject({
      allowed: true
    });
    expect(authorizeRole({ role: "company_admin", permission: "provider:configure_service", deploymentMode: "single_company" })).toMatchObject({
      allowed: false
    });
    expect(authorizeRole({ role: "service_admin", permission: "tenant:create", deploymentMode: "multi_tenant" })).toMatchObject({
      allowed: true
    });
    expect(authorizeRole({ role: "service_admin", permission: "tenant:create", deploymentMode: "single_company" })).toMatchObject({
      allowed: false
    });
    expect(authorizeRole({ role: "user", permission: "audit:read", deploymentMode: "single_company" })).toMatchObject({
      allowed: false
    });
  });
});
