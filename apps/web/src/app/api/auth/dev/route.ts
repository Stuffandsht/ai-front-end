import { NextResponse } from "next/server";
import { developmentAuthAllowed } from "@agent-platform/auth";
import { getConfig, getRuntime } from "@/lib/runtime";
import { buildRetentionContext } from "@agent-platform/retention";

export async function POST(request: Request) {
  const config = getConfig();
  const devAuth = developmentAuthAllowed(config);
  if (!devAuth.ok) {
    return NextResponse.json({ error: devAuth.message, code: devAuth.code }, { status: 403 });
  }

  const runtime = await getRuntime();
  const form = await request.formData();
  const email = String(form.get("email") ?? config.devAuth.email);
  const user = await runtime.db.upsertUser({
    email,
    displayName: email === config.devAuth.email ? config.devAuth.displayName : email
  });
  await runtime.db.upsertMembership({
    tenantId: runtime.tenant.id,
    userId: user.id,
    role: config.deploymentMode === "single_company" ? "company_admin" : "service_admin"
  });
  await runtime.db.createAudit({
    tenantId: runtime.tenant.id,
    userId: user.id,
    type: "auth.login",
    metadata: {
      mode: "development",
      unsafeForProduction: true
    },
    retention: buildRetentionContext("ephemeral")
  });

  const response = NextResponse.redirect(new URL("/chat", request.url), 303);
  response.cookies.set(config.sessionCookieName, user.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.publicBaseUrl.startsWith("https://"),
    path: "/"
  });
  return response;
}
