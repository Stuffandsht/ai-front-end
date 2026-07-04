import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppConfig, DeploymentMode } from "@agent-platform/config";
import type { IdentityProvider, RoleName } from "@agent-platform/db";

export type OidcProviderType = "oidc" | "microsoft_entra";

export type OidcProviderConfig = {
  tenantId: string;
  providerType: OidcProviderType;
  issuerUrl: string;
  clientId: string;
  clientSecretRef: string;
  callbackUrl: string;
  scopes: string[];
  allowedEmailDomains: string[];
  claimMapping: ClaimMapping;
  enabled: boolean;
};

export type ClaimMapping = {
  subject: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  groups?: string;
  roles?: string;
};

export type OidcDiscoveryDocument = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  response_types_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
};

export type OidcClaims = {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  nbf?: number;
  iat?: number;
  email?: string;
  preferred_username?: string;
  name?: string;
  picture?: string;
  groups?: string[];
  roles?: string[];
  oid?: string;
  tid?: string;
  [claim: string]: unknown;
};

export type ProvisionedIdentity = {
  email: string;
  displayName: string;
  avatarUrl: string | null;
  externalSubject: string;
  externalGroups: string[];
  mappedRoles: RoleName[];
};

export type AuthValidationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

export type Permission =
  | "tenant:create"
  | "tenant:update"
  | "tenant:read"
  | "tenant:delete"
  | "user:invite"
  | "user:update"
  | "user:read"
  | "user:disable"
  | "provider:configure_service"
  | "provider:configure_tenant"
  | "provider:configure_user"
  | "provider:use"
  | "prompt:configure_service"
  | "prompt:configure_tenant"
  | "prompt:configure_user"
  | "prompt:read_effective"
  | "mcp:install_service"
  | "mcp:install_tenant"
  | "mcp:install_user"
  | "mcp:use"
  | "retention:configure"
  | "retention:select_ephemeral"
  | "retention:select_retained"
  | "audit:read"
  | "settings:read"
  | "settings:update";

export type AuthorizationDecision = {
  allowed: boolean;
  reason: string;
};

const userPermissions = new Set<Permission>([
  "provider:use",
  "prompt:read_effective",
  "mcp:use",
  "retention:select_ephemeral",
  "retention:select_retained",
  "settings:read"
]);

const auditorPermissions = new Set<Permission>(["tenant:read", "user:read", "audit:read", "settings:read"]);

const tenantAdminPermissions = new Set<Permission>([
  "tenant:update",
  "tenant:read",
  "user:invite",
  "user:update",
  "user:read",
  "user:disable",
  "provider:configure_tenant",
  "provider:configure_user",
  "provider:use",
  "prompt:configure_tenant",
  "prompt:configure_user",
  "prompt:read_effective",
  "mcp:install_tenant",
  "mcp:install_user",
  "mcp:use",
  "retention:configure",
  "retention:select_ephemeral",
  "retention:select_retained",
  "audit:read",
  "settings:read",
  "settings:update"
]);

const serviceAdminPermissions = new Set<Permission>([
  ...tenantAdminPermissions,
  "tenant:create",
  "tenant:delete",
  "provider:configure_service",
  "prompt:configure_service",
  "mcp:install_service"
]);

export function microsoftEntraPreset(args: {
  tenantId: string;
  entraTenantId: string;
  clientId: string;
  clientSecretRef: string;
  callbackUrl: string;
  allowedEmailDomains?: string[];
  scopes?: string[];
}): OidcProviderConfig {
  return {
    tenantId: args.tenantId,
    providerType: "microsoft_entra",
    issuerUrl: `https://login.microsoftonline.com/${args.entraTenantId}/v2.0`,
    clientId: args.clientId,
    clientSecretRef: args.clientSecretRef,
    callbackUrl: args.callbackUrl,
    scopes: args.scopes ?? ["openid", "profile", "email"],
    allowedEmailDomains: args.allowedEmailDomains ?? [],
    claimMapping: {
      subject: "sub",
      email: "email",
      displayName: "name",
      groups: "groups",
      roles: "roles"
    },
    enabled: true
  };
}

export function oidcConfigFromIdentityProvider(provider: IdentityProvider, callbackUrl: string, scopes = ["openid", "profile", "email"]): OidcProviderConfig {
  return {
    tenantId: provider.tenantId,
    providerType: provider.providerType,
    issuerUrl: provider.issuerUrl,
    clientId: provider.clientId,
    clientSecretRef: provider.clientSecretRef,
    callbackUrl,
    scopes,
    allowedEmailDomains: provider.allowedEmailDomains,
    claimMapping: {
      subject: provider.claimMappingJson["subject"] ?? "sub",
      email: provider.claimMappingJson["email"] ?? "email",
      displayName: provider.claimMappingJson["displayName"] ?? "name",
      ...(provider.claimMappingJson["avatarUrl"] ? { avatarUrl: provider.claimMappingJson["avatarUrl"] } : {}),
      ...(provider.claimMappingJson["groups"] ? { groups: provider.claimMappingJson["groups"] } : {}),
      ...(provider.claimMappingJson["roles"] ? { roles: provider.claimMappingJson["roles"] } : {})
    },
    enabled: provider.enabled
  };
}

export function validateOidcDiscovery(config: OidcProviderConfig, discovery: OidcDiscoveryDocument): AuthValidationResult {
  if (!config.enabled) {
    return deny("IDP_DISABLED", "Identity provider is disabled.");
  }
  if (normalizeUrl(discovery.issuer) !== normalizeUrl(config.issuerUrl)) {
    return deny("OIDC_ISSUER_MISMATCH", "OIDC discovery issuer does not match configured issuer.");
  }
  if (!discovery.authorization_endpoint || !discovery.token_endpoint || !discovery.jwks_uri) {
    return deny("OIDC_DISCOVERY_INCOMPLETE", "OIDC discovery document is missing required endpoints.");
  }
  if (discovery.response_types_supported && !discovery.response_types_supported.includes("code")) {
    return deny("OIDC_CODE_FLOW_UNSUPPORTED", "OIDC provider does not advertise authorization code flow support.");
  }
  return { ok: true };
}

export function validateIdTokenClaims(config: OidcProviderConfig, claims: OidcClaims, nowEpochSeconds = Math.floor(Date.now() / 1000)): AuthValidationResult {
  if (normalizeUrl(claims.iss) !== normalizeUrl(config.issuerUrl)) {
    return deny("TOKEN_ISSUER_MISMATCH", "ID token issuer does not match configured issuer.");
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(config.clientId)) {
    return deny("TOKEN_AUDIENCE_MISMATCH", "ID token audience does not include configured client ID.");
  }
  if (claims.exp <= nowEpochSeconds) {
    return deny("TOKEN_EXPIRED", "ID token is expired.");
  }
  if (claims.nbf != null && claims.nbf > nowEpochSeconds) {
    return deny("TOKEN_NOT_YET_VALID", "ID token is not valid yet.");
  }
  const email = claimString(claims, config.claimMapping.email) ?? claimString(claims, "preferred_username");
  if (!email) {
    return deny("TOKEN_EMAIL_MISSING", "ID token does not include a mapped email claim.");
  }
  if (!emailDomainAllowed(email, config.allowedEmailDomains)) {
    return deny("EMAIL_DOMAIN_DENIED", "Email domain is not allowed for this identity provider.");
  }
  return { ok: true };
}

export function createCallbackState(args: { sessionId: string; tenantId: string; returnTo: string; secret: string; issuedAt?: number }): string {
  const payload = {
    sessionId: args.sessionId,
    tenantId: args.tenantId,
    returnTo: args.returnTo,
    issuedAt: args.issuedAt ?? Date.now()
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(body, args.secret);
  return `${body}.${signature}`;
}

export function validateCallbackState(state: string, args: { sessionId: string; tenantId: string; secret: string; maxAgeMs?: number; now?: number }): AuthValidationResult {
  const [body, signature] = state.split(".");
  if (!body || !signature) {
    return deny("STATE_MALFORMED", "OIDC callback state is malformed.");
  }
  if (!safeEqual(signature, sign(body, args.secret))) {
    return deny("STATE_SIGNATURE_INVALID", "OIDC callback state signature is invalid.");
  }
  const payload = JSON.parse(base64UrlDecode(body)) as { sessionId?: string; tenantId?: string; issuedAt?: number };
  if (payload.sessionId !== args.sessionId || payload.tenantId !== args.tenantId) {
    return deny("STATE_CONTEXT_MISMATCH", "OIDC callback state does not match the login session.");
  }
  const maxAgeMs = args.maxAgeMs ?? 10 * 60 * 1000;
  const now = args.now ?? Date.now();
  if (typeof payload.issuedAt !== "number" || now - payload.issuedAt > maxAgeMs) {
    return deny("STATE_EXPIRED", "OIDC callback state is expired.");
  }
  return { ok: true };
}

export function provisionIdentityFromClaims(
  config: OidcProviderConfig,
  claims: OidcClaims,
  roleMappings: Record<string, RoleName> = {}
): ProvisionedIdentity {
  const email = claimString(claims, config.claimMapping.email) ?? claimString(claims, "preferred_username");
  if (!email) {
    throw new Error("Cannot provision identity without email claim");
  }
  const externalGroups = [
    ...claimStringArray(claims, config.claimMapping.groups),
    ...claimStringArray(claims, config.claimMapping.roles)
  ];
  return {
    email,
    displayName: claimString(claims, config.claimMapping.displayName) ?? email,
    avatarUrl: config.claimMapping.avatarUrl ? claimString(claims, config.claimMapping.avatarUrl) : null,
    externalSubject: claimString(claims, config.claimMapping.subject) ?? claims.sub,
    externalGroups,
    mappedRoles: externalGroups.flatMap((group) => (roleMappings[group] ? [roleMappings[group]] : []))
  };
}

export function developmentAuthAllowed(config: AppConfig): AuthValidationResult {
  if (!config.allowDevAuth) {
    return deny("DEV_AUTH_DISABLED", "Development auth is disabled.");
  }
  if (config.publicBaseUrl.startsWith("https://") && !config.publicBaseUrl.includes("localhost")) {
    return deny("DEV_AUTH_PUBLIC_URL", "Development auth must not be enabled for a public HTTPS base URL.");
  }
  return { ok: true };
}

export function authorizeRole(args: { role: RoleName; permission: Permission; deploymentMode: DeploymentMode }): AuthorizationDecision {
  if (args.role === "service_admin") {
    if (args.deploymentMode !== "multi_tenant") {
      return {
        allowed: false,
        reason: "service_admin permissions are available only in multi_tenant mode"
      };
    }
    return permissionDecision(serviceAdminPermissions, args.permission, args.role);
  }

  if (args.role === "company_admin" || args.role === "tenant_admin" || args.role === "workspace_admin") {
    if (serviceOnlyPermission(args.permission)) {
      return {
        allowed: false,
        reason: `${args.permission} requires service_admin in multi_tenant mode`
      };
    }
    return permissionDecision(tenantAdminPermissions, args.permission, args.role);
  }

  if (args.role === "auditor") {
    return permissionDecision(auditorPermissions, args.permission, args.role);
  }

  return permissionDecision(userPermissions, args.permission, args.role);
}

export function assertAuthorized(args: { role: RoleName; permission: Permission; deploymentMode: DeploymentMode }): void {
  const decision = authorizeRole(args);
  if (!decision.allowed) {
    throw new Error(`Forbidden: ${decision.reason}`);
  }
}

function emailDomainAllowed(email: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) {
    return true;
  }
  const domain = email.split("@").at(-1)?.toLowerCase();
  return domain ? allowedDomains.map((value) => value.toLowerCase()).includes(domain) : false;
}

function serviceOnlyPermission(permission: Permission): boolean {
  return permission === "provider:configure_service" || permission === "prompt:configure_service" || permission === "mcp:install_service";
}

function permissionDecision(permissions: Set<Permission>, permission: Permission, role: RoleName): AuthorizationDecision {
  return permissions.has(permission)
    ? {
        allowed: true,
        reason: `${role} has ${permission}`
      }
    : {
        allowed: false,
        reason: `${role} lacks ${permission}`
      };
}

function claimString(claims: OidcClaims, claimName: string | undefined): string | null {
  if (!claimName) {
    return null;
  }
  const value = claims[claimName];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function claimStringArray(claims: OidcClaims, claimName: string | undefined): string[] {
  if (!claimName) {
    return [];
  }
  const value = claims[claimName];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeUrl(value: string): string {
  return value.replace(/\/$/, "");
}

function deny(code: string, message: string): AuthValidationResult {
  return {
    ok: false,
    code,
    message
  };
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
