import { buildRetentionContext } from "@agent-platform/retention";
import { authorizedJson } from "@/lib/api";
import { getRuntime, requireCurrentUser } from "@/lib/runtime";

export async function GET() {
  return authorizedJson("mcp:install_tenant", async () => {
    const runtime = await getRuntime();
    const snapshot = await runtime.db.snapshot();
    return {
      tools: runtime.mcp.listTools().map((tool) => ({
        id: tool.id,
        name: tool.name,
        riskLevel: tool.riskLevel,
        requiresConfirmation: tool.requiresConfirmation
      })),
      servers: snapshot.mcpServers,
      installations: snapshot.pluginInstallations.filter((installation) => installation.tenantId === runtime.tenant.id && installation.deletedAt == null),
      permissions: snapshot.toolPermissions.filter((permission) => permission.tenantId === runtime.tenant.id && permission.deletedAt == null)
    };
  });
}

export async function POST(request: Request) {
  return authorizedJson("mcp:install_tenant", async () => {
    const runtime = await getRuntime();
    const user = await requireCurrentUser();
    const body = await request.json() as Record<string, unknown>;
    const transportType = body["transportType"] === "stdio" ? "stdio" : "http";
    const serverUrl = optionalString(body["serverUrl"]);
    const command = optionalString(body["command"]);
    if (transportType === "http" && !serverUrl) {
      throw new Error("HTTP MCP servers require serverUrl");
    }
    if (transportType === "stdio" && !command) {
      throw new Error("stdio MCP servers require command");
    }
    const server = await runtime.db.createMcpServer({
      name: String(body["name"] ?? (transportType === "stdio" ? "stdio MCP Server" : "HTTP MCP Server")),
      description: String(body["description"] ?? `Tenant-installed ${transportType} MCP server`),
      transportType,
      serverUrl: transportType === "http" ? serverUrl ?? null : null,
      containerImage: null,
      command: transportType === "stdio" ? command ?? null : null,
      argsJson: stringList(body["argsJson"]),
      envSecretRefsJson: stringList(body["envSecretRefsJson"]),
      riskLevel: riskLevel(body["riskLevel"]),
      retentionPolicyClass: body["retentionPolicyClass"] === "standard" ? "standard" : "metadata_only_required",
      enabled: true
    });
    const scopeType = body["scopeType"] === "user" ? "user" : "tenant";
    const installation = await runtime.db.createPluginInstallation({
      tenantId: runtime.tenant.id,
      scopeType,
      scopeId: scopeType === "user" ? user.id : runtime.tenant.id,
      mcpServerId: server.id,
      enabled: true,
      installedBy: user.id,
      approvedBy: user.id,
      config: typeof body["config"] === "string" ? body["config"] : null
    });
    for (const toolId of stringList(body["toolIds"])) {
      await runtime.db.createToolPermission({
        tenantId: runtime.tenant.id,
        toolId,
        subjectType: "tenant",
        subjectId: runtime.tenant.id,
        permission: "use",
        requiresConfirmation: Boolean(body["requiresConfirmation"]) || riskLevel(body["riskLevel"]) === "high"
      });
    }
    await runtime.db.createAudit({
      tenantId: runtime.tenant.id,
      userId: user.id,
      type: "admin.changed",
      metadata: {
        action: "mcp_plugin_installed",
        transportType,
        mcpServerId: server.id,
        installationId: installation.id,
        toolPermissionCount: stringList(body["toolIds"]).length,
        envSecretRefCount: server.envSecretRefsJson.length
      },
      retention: buildRetentionContext("retained")
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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === "string" && item.length > 0 ? [item] : []));
  }
  if (typeof value !== "string" || value.length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.flatMap((item) => (typeof item === "string" && item.length > 0 ? [item] : []));
    }
  } catch {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}
