import { authorizedJson } from "@/lib/api";
import { getRuntime } from "@/lib/runtime";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authorizedJson("provider:configure_tenant", async () => {
    const runtime = await getRuntime();
    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;
    const model = await runtime.db.updateModelConfig(id, {
      ...(typeof body["displayName"] === "string" ? { displayName: body["displayName"] } : {}),
      ...(typeof body["contextWindow"] === "number" ? { contextWindow: body["contextWindow"] } : {}),
      ...(typeof body["maxOutputTokens"] === "number" ? { maxOutputTokens: body["maxOutputTokens"] } : {}),
      ...(typeof body["enabled"] === "boolean" ? { enabled: body["enabled"] } : {})
    });
    await runtime.refreshAdminState();
    return { id, updated: Boolean(model) };
  });
}
