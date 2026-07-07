import { authorizedJson } from "@/lib/api";
import { getRuntime, requireCurrentUser } from "@/lib/runtime";

export async function GET() {
  return authorizedJson("prompt:configure_tenant", async () => {
    const runtime = await getRuntime();
    return (await runtime.db.snapshot()).promptFragments.map((prompt) => ({
      id: prompt.id,
      scopeType: prompt.scopeType,
      name: prompt.name,
      priority: prompt.priority,
      version: prompt.version,
      contentHash: prompt.contentHash
    }));
  });
}

export async function POST(request: Request) {
  return authorizedJson("prompt:configure_tenant", async () => {
    const runtime = await getRuntime();
    const user = await requireCurrentUser();
    const body = await request.json() as Record<string, unknown>;
    const prompt = await runtime.db.createPromptFragment({
      tenantId: runtime.tenant.id,
      scopeType: "tenant",
      scopeId: runtime.tenant.id,
      name: String(body["name"] ?? "Company Prompt"),
      content: String(body["content"] ?? ""),
      priority: Number(body["priority"] ?? 10),
      createdBy: user.id
    });
    await runtime.refreshAdminState();
    return {
      id: prompt.id,
      name: prompt.name,
      priority: prompt.priority,
      version: prompt.version,
      contentHash: prompt.contentHash
    };
  });
}
