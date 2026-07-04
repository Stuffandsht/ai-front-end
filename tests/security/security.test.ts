import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileEffectivePolicy } from "@agent-platform/policy";
import { createTestRuntime, uniqueSentinel } from "@agent-platform/test-utils";

describe("security regressions", () => {
  it("does not expose raw credentials in provider API-shaped responses", async () => {
    const runtime = await createTestRuntime();
    const secret = uniqueSentinel("CREDENTIAL_SHOULD_NOT_LEAK");
    await runtime.db.createProviderCredential({
      tenantId: runtime.tenant.id,
      providerConfigId: runtime.db.snapshot().providerConfigs[0]?.id ?? "mock",
      credentialRef: "secret://tenant/mock",
      secret
    });

    const apiShape = runtime.db.snapshot().providerConfigs.map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      providerType: provider.providerType,
      enabled: provider.enabled
    }));

    expect(JSON.stringify(apiShape)).not.toContain(secret);
    expect(runtime.db.rawSearch(secret)).toBe(false);
  });

  it("rejects disallowed provider and disallowed tool selections", async () => {
    const runtime = await createTestRuntime();
    const providerPolicy = compileEffectivePolicy(
      {
        deploymentMode: runtime.config.deploymentMode,
        tenantId: runtime.tenant.id,
        userId: runtime.devUser.id,
        groupIds: [],
        requestedProviderId: "user-openai"
      },
      runtime.policyDocuments,
      runtime.inventory
    );
    expect(providerPolicy.selectedProviderId).toBe("mock");
    expect(providerPolicy.reasons.some((reason) => reason.code === "PROVIDER_DENIED" || reason.code === "BYO_PROVIDER_DENIED")).toBe(true);

    const toolPolicy = compileEffectivePolicy(
      {
        deploymentMode: runtime.config.deploymentMode,
        tenantId: runtime.tenant.id,
        userId: runtime.devUser.id,
        groupIds: [],
        requestedToolIds: ["not.allowed"]
      },
      runtime.policyDocuments,
      runtime.inventory
    );
    expect(toolPolicy.enabledToolIds).not.toContain("not.allowed");
    expect(toolPolicy.reasons.some((reason) => reason.code === "TOOL_DENIED")).toBe(true);
  });

  it("has no browser storage writes for chat content", () => {
    const chatPage = readFileSync("apps/web/src/app/chat/page.tsx", "utf8");
    const appSource = readFileSync("apps/web/src/app/globals.css", "utf8");

    expect(chatPage).not.toMatch(/localStorage\.setItem|sessionStorage\.setItem|window\.localStorage/);
    expect(appSource).not.toMatch(/localStorage\.setItem|sessionStorage\.setItem|window\.localStorage/);
  });

  it("gates API mutation routes with backend authorization", () => {
    const routeFiles = walk("apps/web/src/app/api").filter((file) => file.endsWith("/route.ts"));
    const mutationRoutes = routeFiles.filter((file) => {
      const source = readFileSync(file, "utf8");
      return /export async function (POST|PATCH|DELETE)/.test(source) && !file.includes("/api/auth/dev/");
    });

    expect(mutationRoutes.length).toBeGreaterThan(0);
    for (const file of mutationRoutes) {
      const source = readFileSync(file, "utf8");
      const mutationHandlers = [...source.matchAll(/export async function (POST|PATCH|DELETE)[\s\S]*?^}/gm)];
      for (const handler of mutationHandlers) {
        expect(handler[0], `${file} ${handler[1]} must use authorizedJson for mutation handlers`).toContain("authorizedJson(");
      }
    }
  });

  it("gates admin pages with backend page permissions", () => {
    const adminPages = walk("apps/web/src/app/admin").filter((file) => file.endsWith("/page.tsx"));

    expect(adminPages.length).toBeGreaterThan(0);
    for (const file of adminPages) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} must use requirePagePermission`).toContain("requirePagePermission(");
    }
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    return statSync(fullPath).isDirectory() ? walk(fullPath) : [fullPath];
  });
}
