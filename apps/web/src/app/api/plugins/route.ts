import { authorizedJson } from "@/lib/api";
import { getRuntime } from "@/lib/runtime";

export async function GET() {
  return authorizedJson("mcp:install_tenant", async () => {
    const runtime = await getRuntime();
    return runtime.mcp.listTools().map((tool) => ({
      id: tool.id,
      name: tool.name,
      riskLevel: tool.riskLevel,
      requiresConfirmation: tool.requiresConfirmation
    }));
  });
}

export async function POST(request: Request) {
  return authorizedJson("mcp:install_tenant", async () => {
    const body = await request.json() as Record<string, unknown>;
    return {
      id: String(body["id"] ?? "mock.read_context"),
      enabled: true
    };
  });
}
