import { buildRetentionContext } from "@agent-platform/retention";
import { compileEffectivePolicy } from "@agent-platform/policy";
import { authorizedJson } from "@/lib/api";
import { getRuntime, requireCurrentUser } from "@/lib/runtime";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authorizedJson("mcp:use", async () => {
    const runtime = await getRuntime();
    const user = await requireCurrentUser();
    const { id } = await params;
    const policy = compileEffectivePolicy(
      {
        deploymentMode: runtime.config.deploymentMode,
        tenantId: runtime.tenant.id,
        userId: user.id,
        groupIds: [],
        requestedToolIds: [id]
      },
      runtime.policyDocuments,
      runtime.inventory
    );
    return runtime.mcp.executeTool({
      tenantId: runtime.tenant.id,
      userId: user.id,
      requestId: `tooltest_${Date.now()}`,
      toolId: id,
      args: { query: "test" },
      confirmed: false,
      policy,
      retention: buildRetentionContext(policy.retentionMode)
    });
  });
}
