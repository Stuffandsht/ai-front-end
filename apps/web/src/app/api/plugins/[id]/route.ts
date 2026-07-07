import { authorizedJson } from "@/lib/api";
import { getRuntime } from "@/lib/runtime";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authorizedJson("mcp:install_tenant", async () => {
    const runtime = await getRuntime();
    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;
    const installation = await runtime.db.updatePluginInstallation(id, {
      ...(typeof body["enabled"] === "boolean" ? { enabled: body["enabled"] } : {})
    });
    await runtime.refreshAdminState();
    return { id, updated: Boolean(installation), enabled: installation?.enabled ?? null };
  });
}
