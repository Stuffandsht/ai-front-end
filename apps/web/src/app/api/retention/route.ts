import { authorizedJson } from "@/lib/api";
import { getRuntime } from "@/lib/runtime";
import { isRetentionMode } from "@agent-platform/retention";

export async function GET() {
  return authorizedJson("retention:configure", async () => {
    const runtime = await getRuntime();
    const policy = (await runtime.db.snapshot()).retentionPolicies.find(
      (item) => item.tenantId === runtime.tenant.id && item.subjectType === "tenant" && item.subjectId === runtime.tenant.id && item.deletedAt == null
    );
    return {
      defaultRetentionMode: policy?.defaultRetentionMode ?? runtime.config.singleCompany.defaultRetention,
      mandatoryRetentionMode: policy?.mandatoryRetentionMode ?? null,
      modes: ["retained", "limited", "ephemeral"]
    };
  });
}

export async function PATCH(request: Request) {
  return authorizedJson("retention:configure", async () => {
    const runtime = await getRuntime();
    const body = await request.json() as Record<string, unknown>;
    const defaultRetentionMode = String(body["defaultRetentionMode"] ?? "retained");
    const mandatoryRetentionMode = typeof body["mandatoryRetentionMode"] === "string" ? body["mandatoryRetentionMode"] : null;
    if (!isRetentionMode(defaultRetentionMode) || (mandatoryRetentionMode != null && !isRetentionMode(mandatoryRetentionMode))) {
      throw new Error("Invalid retention mode");
    }
    const policy = await runtime.db.upsertRetentionPolicy({
      tenantId: runtime.tenant.id,
      subjectType: "tenant",
      subjectId: runtime.tenant.id,
      defaultRetentionMode,
      mandatoryRetentionMode
    });
    await runtime.refreshAdminState();
    return policy;
  });
}
