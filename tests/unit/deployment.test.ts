import { describe, expect, it } from "vitest";
import { createTestRuntime, testConfig } from "@agent-platform/test-utils";

describe("deployment modes", () => {
  it("reads single-company mode as a first-class config value", () => {
    const config = testConfig({ APP_DEPLOYMENT_MODE: "single_company" });

    expect(config.deploymentMode).toBe("single_company");
    expect(config.singleCompany.tenantSlug).toBe("acme");
  });

  it("seeds exactly one single-company tenant and multiple multi-tenant tenants", async () => {
    const single = await createTestRuntime("single_company");
    expect(single.db.listTenants()).toHaveLength(1);

    const multi = await createTestRuntime("multi_tenant");
    await multi.db.createTenantForApi({ slug: "second", name: "Second Tenant" }, "multi_tenant");
    expect(multi.db.listTenants()).toHaveLength(2);
  });

  it("rejects additional tenant creation in single-company mode", async () => {
    const runtime = await createTestRuntime("single_company");

    await expect(runtime.db.createTenantForApi({ slug: "other", name: "Other" }, "single_company")).rejects.toThrow("single_company");
  });
});
