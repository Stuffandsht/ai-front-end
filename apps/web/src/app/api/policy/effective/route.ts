import { compileEffectivePolicy, summarizePolicy } from "@agent-platform/policy";
import { protectedJson } from "@/lib/api";
import { getRuntime, requireCurrentUser } from "@/lib/runtime";

export async function GET() {
  return protectedJson(async () => {
    const runtime = await getRuntime();
    const user = await requireCurrentUser();
    const membership = await runtime.db.getMembership(runtime.tenant.id, user.id);
    const policy = compileEffectivePolicy(
      {
        deploymentMode: runtime.config.deploymentMode,
        tenantId: runtime.tenant.id,
        userId: user.id,
        groupIds: membership?.externalGroupsJson ?? []
      },
      runtime.policyDocuments,
      runtime.inventory
    );
    return summarizePolicy(policy);
  });
}
