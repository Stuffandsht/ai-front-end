import { authorizedJson } from "@/lib/api";
import { getRuntime, requireCurrentUser } from "@/lib/runtime";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authorizedJson("prompt:configure_tenant", async () => {
    const runtime = await getRuntime();
    const user = await requireCurrentUser();
    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;
    const prompt = await runtime.db.updatePromptFragment(id, {
      ...(typeof body["name"] === "string" ? { name: body["name"] } : {}),
      ...(typeof body["content"] === "string" ? { content: body["content"] } : {}),
      ...(typeof body["priority"] === "number" ? { priority: body["priority"] } : {}),
      ...(typeof body["enabled"] === "boolean" ? { enabled: body["enabled"] } : {}),
      updatedBy: user.id
    });
    await runtime.refreshAdminState();
    return { id, updated: Boolean(prompt), version: prompt?.version ?? null };
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authorizedJson("prompt:configure_tenant", async () => {
    const runtime = await getRuntime();
    const { id } = await params;
    const prompt = await runtime.db.deletePromptFragment(id);
    await runtime.refreshAdminState();
    return { id, deleted: Boolean(prompt) };
  });
}
