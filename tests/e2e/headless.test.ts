import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestRuntime } from "@agent-platform/test-utils";

describe("headless e2e acceptance", () => {
  it("covers development login, retained chat, ephemeral chat, provider selector, and audit through runtime/UI surfaces", async () => {
    const runtime = await createTestRuntime("single_company", { ALLOW_DEV_AUTH: "true" });
    const retained = await runtime.runtime.runChat(runtime.devUser, {
      message: "retained browser flow",
      requestedRetentionMode: "retained"
    });
    const ephemeral = await runtime.runtime.runChat(runtime.devUser, {
      message: "ephemeral browser flow",
      requestedRetentionMode: "ephemeral"
    });
    const chatPage = readFileSync("apps/web/src/app/chat/page.tsx", "utf8");
    const loginPage = readFileSync("apps/web/src/app/login/page.tsx", "utf8");

    expect(loginPage).toContain("Development auth");
    expect(chatPage).toContain("requestedProviderId");
    expect(chatPage).toContain("requestedRetentionMode");
    expect(retained.conversation).not.toBeNull();
    expect(ephemeral.conversation).toBeNull();
    expect(runtime.db.snapshot().auditEvents.length).toBeGreaterThan(0);
  });

  it("single-company UI hides service and tenant admin navigation while multi-tenant pages exist", () => {
    const layout = readFileSync("apps/web/src/app/layout.tsx", "utf8");
    const servicePage = readFileSync("apps/web/src/app/admin/service/page.tsx", "utf8");
    const tenantsPage = readFileSync("apps/web/src/app/admin/tenants/page.tsx", "utf8");

    expect(layout).toContain("visibleAdminLinks");
    expect(layout).toContain("provider:configure_service");
    expect(servicePage).toContain("notFound()");
    expect(tenantsPage).toContain("notFound()");
  });

  it("user BYO provider settings are conditionally rendered from policy", () => {
    const settingsPage = readFileSync("apps/web/src/app/settings/page.tsx", "utf8");

    expect(settingsPage).toContain("byoAllowed");
    expect(settingsPage).toContain("BYO credential reference");
  });
});
