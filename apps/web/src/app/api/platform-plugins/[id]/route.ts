import { buildRetentionContext } from "@agent-platform/retention";
import { authorizedJson } from "@/lib/api";
import { getRuntime, requireCurrentUser } from "@/lib/runtime";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authorizedJson("mcp:install_tenant", async () => {
    const runtime = await getRuntime();
    const user = await requireCurrentUser();
    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;
    const installation = await runtime.db.updatePlatformPluginInstallation(id, {
      ...(typeof body["enabled"] === "boolean" ? { enabled: body["enabled"] } : {}),
      ...(body["approved"] === true ? { approvedBy: user.id } : {})
    });
    await runtime.db.createAudit({
      tenantId: runtime.tenant.id,
      userId: user.id,
      type: "admin.changed",
      metadata: {
        action: "platform_plugin_updated",
        installationId: id,
        enabled: installation?.enabled ?? null
      },
      retention: buildRetentionContext("retained")
    });
    await runtime.refreshAdminState();
    return { id, updated: Boolean(installation), enabled: installation?.enabled ?? null };
  });
}
