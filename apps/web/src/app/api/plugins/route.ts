import { authorizedJson } from "@/lib/api";
import { getRuntime, requireCurrentUser } from "@/lib/runtime";

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
    const runtime = await getRuntime();
    const user = await requireCurrentUser();
    const body = await request.json() as Record<string, unknown>;
    const serverUrl = typeof body["serverUrl"] === "string" ? body["serverUrl"] : "";
    if (!serverUrl) {
      return {
        id: String(body["id"] ?? "mock.read_context"),
        enabled: true,
        persisted: false
      };
    }
    const server = await runtime.db.createMcpServer({
      name: String(body["name"] ?? "HTTP MCP Server"),
      description: String(body["description"] ?? "Tenant-installed HTTP MCP server"),
      transportType: "http",
      serverUrl,
      containerImage: null,
      command: null,
      argsJson: [],
      envSecretRefsJson: [],
      riskLevel: riskLevel(body["riskLevel"]),
      retentionPolicyClass: "metadata_only_required",
      enabled: true
    });
    const installation = await runtime.db.createPluginInstallation({
      tenantId: runtime.tenant.id,
      scopeType: "tenant",
      scopeId: runtime.tenant.id,
      mcpServerId: server.id,
      enabled: true,
      installedBy: user.id,
      approvedBy: user.id,
      config: typeof body["config"] === "string" ? body["config"] : null
    });
    await runtime.refreshAdminState();
    return {
      id: installation.id,
      mcpServerId: server.id,
      enabled: installation.enabled
    };
  });
}

function riskLevel(value: unknown): "low" | "medium" | "high" {
  return value === "medium" || value === "high" ? value : "low";
}
