import { revalidatePath } from "next/cache";
import { buildRetentionContext, isRetentionMode } from "@agent-platform/retention";
import type { PlatformPluginManifest } from "@agent-platform/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getRuntime, requireCurrentUser } from "@/lib/runtime";

export default async function PluginsPage() {
  await requirePagePermission("mcp:install_tenant");
  const runtime = await getRuntime();
  const snapshot = await runtime.db.snapshot();
  const tools = runtime.mcp.listTools();
  const installations = snapshot.pluginInstallations.filter((installation) => installation.tenantId === runtime.tenant.id && installation.deletedAt == null);
  const servers = snapshot.mcpServers;
  const permissions = snapshot.toolPermissions.filter((permission) => permission.tenantId === runtime.tenant.id && permission.deletedAt == null);
  const platformPlugins = snapshot.platformPluginInstallations.filter((plugin) => plugin.tenantId === runtime.tenant.id && plugin.deletedAt == null);
  const timeline = snapshot.toolInvocations.filter((invocation) => invocation.tenantId === runtime.tenant.id).slice(-8).reverse();

  return (
    <>
      <div className="topline">
        <h1 className="page-title">Plugins</h1>
        <span className="badge">tenant scoped</span>
      </div>
      <div className="grid two">
        <section className="panel">
          <div className="panel-header"><h2 className="panel-title">MCP Server</h2></div>
          <form className="panel-body grid" action={createMcpInstallationAction}>
            <div className="field">
              <label htmlFor="mcp-name">Name</label>
              <input className="input" id="mcp-name" name="name" defaultValue="Tenant MCP Server" />
            </div>
            <div className="toolbar">
              <select className="select" name="transportType" aria-label="Transport">
                <option value="http">HTTP</option>
                <option value="stdio">stdio</option>
              </select>
              <select className="select" name="riskLevel" aria-label="Risk">
                <option value="low">Low risk</option>
                <option value="medium">Medium risk</option>
                <option value="high">High risk</option>
              </select>
              <select className="select" name="retentionPolicyClass" aria-label="Retention class">
                <option value="metadata_only_required">Metadata-only tool payloads</option>
                <option value="standard">Standard retention</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="mcp-url">HTTP URL</label>
              <input className="input" id="mcp-url" name="serverUrl" placeholder="https://mcp.example.test" />
            </div>
            <div className="field">
              <label htmlFor="mcp-command">stdio command</label>
              <input className="input" id="mcp-command" name="command" placeholder="/usr/local/bin/mcp-server" />
            </div>
            <div className="field">
              <label htmlFor="mcp-args">Arguments</label>
              <input className="input" id="mcp-args" name="argsJson" placeholder="[&quot;--stdio&quot;]" />
            </div>
            <div className="field">
              <label htmlFor="mcp-env">Environment secret refs</label>
              <input className="input" id="mcp-env" name="envSecretRefsJson" placeholder="[&quot;env://MCP_API_KEY&quot;]" />
            </div>
            <div className="field">
              <label htmlFor="mcp-tool-ids">Tool IDs to permit</label>
              <input className="input" id="mcp-tool-ids" name="toolIds" placeholder="remote.search,remote.read" />
            </div>
            <label><input type="checkbox" name="requiresConfirmation" value="true" /> Requires confirmation</label>
            <div className="field">
              <label htmlFor="mcp-config">Encrypted install config</label>
              <textarea className="textarea" id="mcp-config" name="config" />
            </div>
            <button className="button secondary" type="submit">Install MCP</button>
          </form>
        </section>

        <section className="panel">
          <div className="panel-header"><h2 className="panel-title">Platform Plugin</h2></div>
          <form className="panel-body grid" action={createPlatformPluginAction}>
            <div className="toolbar">
              <select className="select" name="scopeType" aria-label="Scope">
                <option value="tenant">Tenant</option>
                <option value="user">User</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="platform-manifest">Manifest JSON</label>
              <textarea
                className="textarea"
                id="platform-manifest"
                name="manifest"
                defaultValue={JSON.stringify(
                  {
                    id: "policy-safe-tools",
                    name: "Safe Tools Policy",
                    version: "0.1.0",
                    kind: "policy_bundle",
                    policyBundle: {
                      enabledToolIds: ["mock.read_context"],
                      deniedToolIds: ["mock.dangerous_action"]
                    }
                  },
                  null,
                  2
                )}
              />
            </div>
            <div className="field">
              <label htmlFor="platform-config">Encrypted config</label>
              <textarea className="textarea" id="platform-config" name="config" />
            </div>
            <button className="button secondary" type="submit">Install Manifest</button>
          </form>
        </section>
      </div>

      <div className="grid two">
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Tools</h2>
            <span className="badge">{tools.length}</span>
          </div>
          <div className="panel-body timeline">
            {tools.map((tool) => {
              const permission = permissions.find((item) => item.toolId === tool.id && item.permission === "use");
              return (
                <div className="timeline-item" key={tool.id}>
                  <strong>{tool.name}</strong>
                  <div className="subtle">{tool.id} · {tool.riskLevel}{tool.requiresConfirmation ? " · confirmation" : ""}</div>
                  <form className="toolbar" action={createToolPermissionAction}>
                    <input type="hidden" name="toolId" value={tool.id} />
                    <label><input type="checkbox" name="requiresConfirmation" value="true" defaultChecked={permission?.requiresConfirmation ?? tool.requiresConfirmation} /> Confirmation</label>
                    <button className="button secondary" type="submit">{permission ? "Update Permission" : "Permit Tool"}</button>
                  </form>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">MCP Installations</h2>
            <span className="badge">{installations.length}</span>
          </div>
          <div className="panel-body timeline">
            {installations.length === 0 ? <div className="subtle">No MCP installations</div> : installations.map((installation) => {
              const server = servers.find((item) => item.id === installation.mcpServerId);
              return (
                <div className="timeline-item" key={installation.id}>
                  <strong>{server?.name ?? installation.mcpServerId}</strong>
                  <div className="subtle">{server?.transportType ?? "unknown"} · {installation.scopeType} · {installation.enabled ? "enabled" : "disabled"}</div>
                  <form action={toggleMcpInstallationAction}>
                    <input type="hidden" name="id" value={installation.id} />
                    <input type="hidden" name="enabled" value={installation.enabled ? "false" : "true"} />
                    <button className="button secondary" type="submit">{installation.enabled ? "Disable" : "Enable"}</button>
                  </form>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="grid two">
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Platform Manifests</h2>
            <span className="badge">{platformPlugins.length}</span>
          </div>
          <div className="panel-body timeline">
            {platformPlugins.length === 0 ? <div className="subtle">No platform manifests</div> : platformPlugins.map((plugin) => (
              <div className="timeline-item" key={plugin.id}>
                <strong>{plugin.manifestJson.name}</strong>
                <div className="subtle">{plugin.manifestJson.kind} · {plugin.scopeType} · {plugin.enabled ? "enabled" : "disabled"}{plugin.configCiphertext ? " · encrypted config" : ""}</div>
                <form action={togglePlatformPluginAction}>
                  <input type="hidden" name="id" value={plugin.id} />
                  <input type="hidden" name="enabled" value={plugin.enabled ? "false" : "true"} />
                  <button className="button secondary" type="submit">{plugin.enabled ? "Disable" : "Enable"}</button>
                </form>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Tool Timeline</h2>
            <span className="badge">{timeline.length}</span>
          </div>
          <div className="panel-body timeline">
            {timeline.length === 0 ? <div className="subtle">No tool calls</div> : timeline.map((item) => (
              <div className="timeline-item" key={item.id}>
                <strong>{item.toolId}</strong>
                <div className="subtle">{item.status} · {item.retentionMode} · {item.requestId}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

async function createMcpInstallationAction(formData: FormData) {
  "use server";
  await requirePagePermission("mcp:install_tenant");
  const runtime = await getRuntime();
  const user = await requireCurrentUser();
  const transportType = formValue(formData, "transportType", "http") === "stdio" ? "stdio" : "http";
  const server = await runtime.db.createMcpServer({
    name: formValue(formData, "name", transportType === "stdio" ? "stdio MCP Server" : "HTTP MCP Server"),
    description: formValue(formData, "description", `Tenant-installed ${transportType} MCP server`),
    transportType,
    serverUrl: transportType === "http" ? formValue(formData, "serverUrl", "") : null,
    containerImage: null,
    command: transportType === "stdio" ? formValue(formData, "command", "") : null,
    argsJson: stringList(formValue(formData, "argsJson", "")),
    envSecretRefsJson: stringList(formValue(formData, "envSecretRefsJson", "")),
    riskLevel: riskLevel(formValue(formData, "riskLevel", "low")),
    retentionPolicyClass: formValue(formData, "retentionPolicyClass", "metadata_only_required") === "standard" ? "standard" : "metadata_only_required",
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
    config: formValue(formData, "config", "")
  });
  for (const toolId of stringList(formValue(formData, "toolIds", ""))) {
    await runtime.db.createToolPermission({
      tenantId: runtime.tenant.id,
      toolId,
      subjectType: "tenant",
      subjectId: runtime.tenant.id,
      permission: "use",
      requiresConfirmation: formData.get("requiresConfirmation") === "true" || server.riskLevel === "high"
    });
  }
  await auditAdmin("mcp_plugin_installed", { mcpServerId: server.id, installationId: installation.id });
  await runtime.refreshAdminState();
  revalidatePath("/admin/plugins");
}

async function createToolPermissionAction(formData: FormData) {
  "use server";
  await requirePagePermission("mcp:install_tenant");
  const runtime = await getRuntime();
  await runtime.db.createToolPermission({
    tenantId: runtime.tenant.id,
    toolId: formValue(formData, "toolId", ""),
    subjectType: "tenant",
    subjectId: runtime.tenant.id,
    permission: "use",
    requiresConfirmation: formData.get("requiresConfirmation") === "true"
  });
  await auditAdmin("tool_permission_created", { toolId: formValue(formData, "toolId", "") });
  await runtime.refreshAdminState();
  revalidatePath("/admin/plugins");
}

async function toggleMcpInstallationAction(formData: FormData) {
  "use server";
  await requirePagePermission("mcp:install_tenant");
  const runtime = await getRuntime();
  const id = formValue(formData, "id", "");
  await runtime.db.updatePluginInstallation(id, {
    enabled: formValue(formData, "enabled", "false") === "true"
  });
  await auditAdmin("mcp_plugin_updated", { installationId: id });
  await runtime.refreshAdminState();
  revalidatePath("/admin/plugins");
}

async function createPlatformPluginAction(formData: FormData) {
  "use server";
  await requirePagePermission("mcp:install_tenant");
  const runtime = await getRuntime();
  const user = await requireCurrentUser();
  const rawManifest = JSON.parse(formValue(formData, "manifest", "{}")) as Record<string, unknown>;
  const manifest = sanitizeManifest(rawManifest);
  const scopeType = formValue(formData, "scopeType", "tenant") === "user" ? "user" : "tenant";
  const installation = await runtime.db.createPlatformPluginInstallation({
    tenantId: runtime.tenant.id,
    scopeType,
    scopeId: scopeType === "user" ? user.id : runtime.tenant.id,
    pluginId: manifest.id,
    manifestJson: manifest,
    enabled: true,
    installedBy: user.id,
    approvedBy: user.id,
    config: formValue(formData, "config", "")
  });
  if (manifest.kind === "prompt_pack") {
    for (const prompt of promptPackContent(rawManifest)) {
      await runtime.db.createPromptFragment({
        tenantId: runtime.tenant.id,
        scopeType,
        scopeId: scopeType === "user" ? user.id : runtime.tenant.id,
        name: prompt.name,
        content: prompt.content,
        priority: prompt.priority,
        createdBy: user.id
      });
    }
  }
  await auditAdmin("platform_plugin_installed", { pluginId: manifest.id, installationId: installation.id, kind: manifest.kind });
  await runtime.refreshAdminState();
  revalidatePath("/admin/plugins");
}

async function togglePlatformPluginAction(formData: FormData) {
  "use server";
  await requirePagePermission("mcp:install_tenant");
  const runtime = await getRuntime();
  const id = formValue(formData, "id", "");
  await runtime.db.updatePlatformPluginInstallation(id, {
    enabled: formValue(formData, "enabled", "false") === "true"
  });
  await auditAdmin("platform_plugin_updated", { installationId: id });
  await runtime.refreshAdminState();
  revalidatePath("/admin/plugins");
}

async function auditAdmin(action: string, metadata: Record<string, unknown>) {
  const runtime = await getRuntime();
  const user = await requireCurrentUser();
  await runtime.db.createAudit({
    tenantId: runtime.tenant.id,
    userId: user.id,
    type: "admin.changed",
    metadata: {
      action,
      ...metadata
    },
    retention: buildRetentionContext("retained")
  });
}

function sanitizeManifest(raw: Record<string, unknown>): PlatformPluginManifest {
  const kind = raw["kind"];
  if (kind !== "prompt_pack" && kind !== "provider_preset" && kind !== "policy_bundle" && kind !== "workflow_action") {
    throw new Error("Unsupported platform plugin kind");
  }
  const manifest: PlatformPluginManifest = {
    id: typeof raw["id"] === "string" ? raw["id"] : `platform-plugin-${Date.now()}`,
    name: typeof raw["name"] === "string" ? raw["name"] : "Platform Plugin",
    version: typeof raw["version"] === "string" ? raw["version"] : "0.1.0",
    kind
  };
  if (typeof raw["description"] === "string") {
    manifest.description = raw["description"];
  }
  if (kind === "policy_bundle") {
    const policy = objectRecord(raw["policyBundle"] ?? raw["policy"]);
    const policyBundle: NonNullable<PlatformPluginManifest["policyBundle"]> = {
      ...stringListField(policy, "allowedProviderIds"),
      ...stringListField(policy, "deniedProviderIds"),
      ...stringField(policy, "defaultProviderId"),
      ...stringListField(policy, "allowedModelIds"),
      ...stringListField(policy, "deniedModelIds"),
      ...stringField(policy, "defaultModelId"),
      ...stringListField(policy, "allowedToolIds"),
      ...stringListField(policy, "deniedToolIds"),
      ...stringListField(policy, "enabledToolIds")
    };
    const defaultRetentionMode = typeof policy["defaultRetentionMode"] === "string" && isRetentionMode(policy["defaultRetentionMode"]) ? policy["defaultRetentionMode"] : undefined;
    const mandatoryRetentionMode = typeof policy["mandatoryRetentionMode"] === "string" && isRetentionMode(policy["mandatoryRetentionMode"]) ? policy["mandatoryRetentionMode"] : undefined;
    if (defaultRetentionMode) {
      policyBundle.defaultRetentionMode = defaultRetentionMode;
    }
    if (mandatoryRetentionMode) {
      policyBundle.mandatoryRetentionMode = mandatoryRetentionMode;
    }
    manifest.policyBundle = policyBundle;
  }
  if (kind === "prompt_pack") {
    const promptPack = objectRecord(raw["promptPack"]);
    const prompts = Array.isArray(promptPack["prompts"]) ? promptPack["prompts"] : [];
    manifest.promptPack = {
      prompts: prompts.flatMap((item) => {
        const prompt = objectRecord(item);
        const name = typeof prompt["name"] === "string" ? prompt["name"] : "";
        return name ? [{ name, contentRef: `installed-prompt:${name}`, priority: typeof prompt["priority"] === "number" ? prompt["priority"] : 50 }] : [];
      })
    };
  }
  if (kind === "provider_preset") {
    manifest.providerPreset = objectRecord(raw["providerPreset"]);
  }
  if (kind === "workflow_action") {
    manifest.workflowActions = Array.isArray(raw["workflowActions"]) ? raw["workflowActions"] as NonNullable<PlatformPluginManifest["workflowActions"]> : [];
  }
  return manifest;
}

function promptPackContent(raw: Record<string, unknown>): Array<{ name: string; content: string; priority: number }> {
  const promptPack = objectRecord(raw["promptPack"]);
  const prompts = Array.isArray(promptPack["prompts"]) ? promptPack["prompts"] : [];
  return prompts.flatMap((item) => {
    const prompt = objectRecord(item);
    const content = typeof prompt["content"] === "string" ? prompt["content"] : "";
    const name = typeof prompt["name"] === "string" ? prompt["name"] : "Prompt Pack Fragment";
    return content
      ? [
          {
            name,
            content,
            priority: typeof prompt["priority"] === "number" ? prompt["priority"] : 50
          }
        ]
      : [];
  });
}

function stringList(value: string): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.flatMap((item) => (typeof item === "string" ? [item] : []));
    }
  } catch {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function stringListField(record: Record<string, unknown>, key: string): Record<string, string[]> {
  const value = record[key];
  return Array.isArray(value) ? { [key]: value.flatMap((item) => (typeof item === "string" ? [item] : [])) } : {};
}

function stringField(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? { [key]: value } : {};
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function riskLevel(value: string): "low" | "medium" | "high" {
  return value === "medium" || value === "high" ? value : "low";
}

function formValue(formData: FormData, key: string, fallback: string): string {
  const value = formData.get(key);
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
