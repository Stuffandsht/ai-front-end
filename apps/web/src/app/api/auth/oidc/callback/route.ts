import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  decodeCallbackState,
  exchangeOidcCode,
  fetchOidcDiscovery,
  fetchOidcJwks,
  oidcConfigFromIdentityProvider,
  provisionIdentityFromClaims,
  validateCallbackState,
  verifyOidcIdToken
} from "@agent-platform/auth";
import { buildRetentionContext } from "@agent-platform/retention";
import { getConfig, getRuntime } from "@/lib/runtime";

export async function GET(request: Request) {
  const config = getConfig();
  const runtime = await getRuntime();
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return NextResponse.json({ error, errorDescription: url.searchParams.get("error_description") }, { status: 400 });
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.json({ error: "OIDC callback requires code and state." }, { status: 400 });
  }

  const statePayload = decodeCallbackState(state);
  const cookieStore = await cookies();
  const loginSessionId = cookieStore.get(oidcSessionCookie(config))?.value;
  const stateValidation = validateCallbackState(state, {
    sessionId: loginSessionId ?? "",
    tenantId: runtime.tenant.id,
    secret: oidcStateSecret(config)
  });
  if (!stateValidation.ok || statePayload.tenantId !== runtime.tenant.id) {
    return NextResponse.json({ error: stateValidation.ok ? "OIDC state tenant mismatch." : stateValidation.message }, { status: 400 });
  }

  const provider = (await runtime.db.snapshot()).identityProviders.find((item) => item.tenantId === runtime.tenant.id && item.enabled && item.deletedAt == null);
  if (!provider) {
    return NextResponse.json({ error: "No OIDC identity provider is configured." }, { status: 404 });
  }
  const oidcConfig = oidcConfigFromIdentityProvider(provider, new URL("/api/auth/oidc/callback", config.publicBaseUrl).toString());
  const discovery = await fetchOidcDiscovery(oidcConfig);
  const token = await exchangeOidcCode(oidcConfig, discovery, {
    code,
    clientSecret: resolveSecretRef(provider.clientSecretRef)
  });
  const jwks = await fetchOidcJwks(discovery);
  const claims = verifyOidcIdToken(oidcConfig, token.id_token ?? "", jwks);
  const identity = provisionIdentityFromClaims(oidcConfig, claims);
  const user = await runtime.db.upsertUser({
    email: identity.email,
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl
  });
  await runtime.db.upsertMembership({
    tenantId: runtime.tenant.id,
    userId: user.id,
    role: normalizeOidcRole(identity.mappedRoles[0], config.deploymentMode),
    externalSubject: identity.externalSubject,
    externalGroupsJson: identity.externalGroups
  });
  await runtime.db.createAudit({
    tenantId: runtime.tenant.id,
    userId: user.id,
    type: "auth.login",
    metadata: {
      mode: "oidc",
      providerId: provider.id,
      issuer: provider.issuerUrl
    },
    retention: buildRetentionContext("ephemeral")
  });

  const response = NextResponse.redirect(new URL(safeReturnTo(statePayload.returnTo), config.publicBaseUrl), 303);
  response.cookies.set(config.sessionCookieName, user.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.publicBaseUrl.startsWith("https://"),
    path: "/"
  });
  response.cookies.delete(oidcSessionCookie(config));
  return response;
}

function normalizeOidcRole(role: "service_admin" | "company_admin" | "tenant_admin" | "workspace_admin" | "user" | "auditor" | undefined, deploymentMode: "multi_tenant" | "single_company") {
  if (!role) {
    return "user";
  }
  return deploymentMode === "single_company" && role === "service_admin" ? "company_admin" : role;
}

function resolveSecretRef(secretRef: string): string {
  if (secretRef.startsWith("env://")) {
    const envName = secretRef.slice("env://".length);
    const value = process.env[envName];
    if (!value) {
      throw new Error(`Missing OIDC client secret environment variable ${envName}`);
    }
    return value;
  }
  throw new Error("OIDC client secret references must use env:// in this runtime.");
}

function oidcSessionCookie(config: ReturnType<typeof getConfig>): string {
  return `${config.sessionCookieName}_oidc_session`;
}

function oidcStateSecret(config: ReturnType<typeof getConfig>): string {
  return `${config.sessionCookieName}:${config.kms.localMasterKeyBase64}`;
}

function safeReturnTo(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/chat";
}
