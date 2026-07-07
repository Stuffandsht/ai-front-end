import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { buildOidcAuthorizationUrl, createCallbackState, fetchOidcDiscovery, oidcConfigFromIdentityProvider } from "@agent-platform/auth";
import { getConfig, getRuntime } from "@/lib/runtime";

export async function GET(request: Request) {
  const config = getConfig();
  const runtime = await getRuntime();
  const provider = (await runtime.db.snapshot()).identityProviders.find((item) => item.tenantId === runtime.tenant.id && item.enabled && item.deletedAt == null);
  if (!provider) {
    return NextResponse.json({ error: "No OIDC identity provider is configured." }, { status: 404 });
  }

  const callbackUrl = new URL("/api/auth/oidc/callback", config.publicBaseUrl).toString();
  const oidcConfig = oidcConfigFromIdentityProvider(provider, callbackUrl);
  const discovery = await fetchOidcDiscovery(oidcConfig);
  const loginSessionId = randomBytes(24).toString("base64url");
  const state = createCallbackState({
    sessionId: loginSessionId,
    tenantId: runtime.tenant.id,
    returnTo: safeReturnTo(new URL(request.url).searchParams.get("returnTo")),
    secret: oidcStateSecret(config)
  });
  const nonce = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(buildOidcAuthorizationUrl(oidcConfig, discovery, { state, nonce }), 303);
  response.cookies.set(oidcSessionCookie(config), loginSessionId, oidcCookieOptions(config));
  return response;
}

function oidcSessionCookie(config: ReturnType<typeof getConfig>): string {
  return `${config.sessionCookieName}_oidc_session`;
}

function oidcCookieOptions(config: ReturnType<typeof getConfig>) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.publicBaseUrl.startsWith("https://"),
    path: "/",
    maxAge: 600
  };
}

function oidcStateSecret(config: ReturnType<typeof getConfig>): string {
  return `${config.sessionCookieName}:${config.kms.localMasterKeyBase64}`;
}

function safeReturnTo(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/chat";
}
