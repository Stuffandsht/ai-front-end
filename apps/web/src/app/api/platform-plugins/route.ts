import { buildRetentionContext, isRetentionMode } from "@agent-platform/retention";
import type { PlatformPluginManifest } from "@agent-platform/db";
import { authorizedJson } from "@/lib/api";
import { getRuntime, requireCurrentUser } from "@/lib/runtime";

export async function GET() {
  return authorizedJson("mcp:install_tenant", async () => {
    const runtime = await getRuntime();
    const snapshot = await runtime.db.snapshot();
    return snapshot.platformPluginInstallations
      .filter((installation) => installation.tenantId === runtime.tenant.id && installation.deletedAt == null)
      .map((installation) => ({
        id: installation.id,
        pluginId: installation.pluginId,
        scopeType: installation.scopeType,
        scopeId: installation.scopeId,
        manifest: installation.manifestJson,
        enabled: installation.enabled,
        approved: Boolean(installation.approvedBy),
        hasEncryptedConfig: Boolean(installation.configCiphertext)
      }));
  });
}

export async function POST(request: Request) {
  return authorizedJson("mcp:install_tenant", async () => {
    const runtime = await getRuntime();
    const user = await requireCurrentUser();
    const body = await request.json() as Record<string, unknown>;
    const rawManifest = manifestRecord(body["manifest"] ?? body);
    const manifest = normalizeManifest(rawManifest);
    const scopeType = body["scopeType"] === "user" ? "user" : "tenant";
    const installation = await runtime.db.createPlatformPluginInstallation({
      tenantId: runtime.tenant.id,
      scopeType,
      scopeId: scopeType === "user" ? user.id : runtime.tenant.id,
      pluginId: manifest.id,
      manifestJson: manifest,
      enabled: body["enabled"] !== false,
      installedBy: user.id,
      approvedBy: user.id,
      config: typeof body["config"] === "string" ? body["config"] : null
    });

    if (manifest.kind === "prompt_pack") {
      for (const prompt of promptPackPrompts(rawManifest)) {
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

    await runtime.db.createAudit({
      tenantId: runtime.tenant.id,
      userId: user.id,
      type: "admin.changed",
      metadata: {
        action: "platform_plugin_installed",
        pluginId: manifest.id,
        kind: manifest.kind,
        scopeType,
        installationId: installation.id
      },
      retention: buildRetentionContext("retained")
    });
    await runtime.refreshAdminState();
    return {
      id: installation.id,
      pluginId: installation.pluginId,
      enabled: installation.enabled
    };
  });
}

function manifestRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("Platform plugin manifest must be an object");
}

function normalizeManifest(raw: Record<string, unknown>): PlatformPluginManifest {
  const kind = raw["kind"];
  if (kind !== "prompt_pack" && kind !== "provider_preset" && kind !== "policy_bundle" && kind !== "workflow_action") {
    throw new Error("Unsupported platform plugin kind");
  }
  const manifest: PlatformPluginManifest = {
    id: stringValue(raw["id"], `platform-plugin-${Date.now()}`),
    name: stringValue(raw["name"], "Platform Plugin"),
    version: stringValue(raw["version"], "0.1.0"),
    kind,
    ...(typeof raw["description"] === "string" ? { description: raw["description"] } : {})
  };
  if (kind === "prompt_pack") {
    manifest.promptPack = {
      prompts: promptPackPrompts(raw).map((prompt) => ({
        name: prompt.name,
        contentRef: `installed-prompt:${prompt.name}`,
        priority: prompt.priority
      }))
    };
  }
  if (kind === "provider_preset") {
    manifest.providerPreset = providerPreset(raw["providerPreset"]);
  }
  if (kind === "policy_bundle") {
    manifest.policyBundle = policyBundle(raw["policyBundle"] ?? raw["policy"]);
  }
  if (kind === "workflow_action") {
    manifest.workflowActions = workflowActions(raw["workflowActions"]);
  }
  return manifest;
}

function promptPackPrompts(raw: Record<string, unknown>): Array<{ name: string; content: string; priority: number }> {
  const promptPack = raw["promptPack"] && typeof raw["promptPack"] === "object" && !Array.isArray(raw["promptPack"]) ? raw["promptPack"] as Record<string, unknown> : raw;
  const prompts = Array.isArray(promptPack["prompts"]) ? promptPack["prompts"] : [];
  return prompts.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const content = typeof record["content"] === "string" ? record["content"] : "";
    if (!content) {
      return [];
    }
    return [
      {
        name: stringValue(record["name"], "Prompt Pack Fragment"),
        content,
        priority: numberValue(record["priority"], 50)
      }
    ];
  });
}

function providerPreset(value: unknown): NonNullable<PlatformPluginManifest["providerPreset"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const models = Array.isArray(record["models"])
    ? record["models"].flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return [];
        }
        const model = item as Record<string, unknown>;
        const modelKey = typeof model["modelKey"] === "string" ? model["modelKey"] : typeof model["id"] === "string" ? model["id"] : "";
        return modelKey
          ? [
              {
                modelKey,
                displayName: stringValue(model["displayName"] ?? model["name"], modelKey),
                contextWindow: numberValue(model["contextWindow"], 8192),
                maxOutputTokens: numberValue(model["maxOutputTokens"], 1024),
                supportsTools: Boolean(model["supportsTools"])
              }
            ]
          : [];
      })
    : [];
  const preset: NonNullable<PlatformPluginManifest["providerPreset"]> = { models };
  const type = providerType(record["providerType"]);
  if (type) {
    preset.providerType = type;
  }
  if (typeof record["baseUrl"] === "string") {
    preset.baseUrl = record["baseUrl"];
  }
  return preset;
}

function policyBundle(value: unknown): NonNullable<PlatformPluginManifest["policyBundle"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const bundle: NonNullable<PlatformPluginManifest["policyBundle"]> = {
    ...stringListField(record, "allowedProviderIds"),
    ...stringListField(record, "deniedProviderIds"),
    ...stringField(record, "defaultProviderId"),
    ...stringListField(record, "allowedModelIds"),
    ...stringListField(record, "deniedModelIds"),
    ...stringField(record, "defaultModelId"),
    ...stringListField(record, "allowedToolIds"),
    ...stringListField(record, "deniedToolIds"),
    ...stringListField(record, "enabledToolIds")
  };
  const defaultRetentionMode = typeof record["defaultRetentionMode"] === "string" && isRetentionMode(record["defaultRetentionMode"]) ? record["defaultRetentionMode"] : undefined;
  const mandatoryRetentionMode = typeof record["mandatoryRetentionMode"] === "string" && isRetentionMode(record["mandatoryRetentionMode"]) ? record["mandatoryRetentionMode"] : undefined;
  if (defaultRetentionMode) {
    bundle.defaultRetentionMode = defaultRetentionMode;
  }
  if (mandatoryRetentionMode) {
    bundle.mandatoryRetentionMode = mandatoryRetentionMode;
  }
  if (record["tracePolicy"] === "full" || record["tracePolicy"] === "redacted" || record["tracePolicy"] === "metadata_only" || record["tracePolicy"] === "none") {
    bundle.tracePolicy = record["tracePolicy"];
  }
  return bundle;
}

function workflowActions(value: unknown): NonNullable<PlatformPluginManifest["workflowActions"]> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    const id = typeof record["id"] === "string" ? record["id"] : "";
    const name = typeof record["name"] === "string" ? record["name"] : "";
    return id && name
      ? [
          {
            id,
            name,
            ...(typeof record["description"] === "string" ? { description: record["description"] } : {}),
            ...(typeof record["promptRef"] === "string" ? { promptRef: record["promptRef"] } : {}),
            ...stringListField(record, "toolIds")
          }
        ]
      : [];
  });
}

function stringListField(record: Record<string, unknown>, key: string): Record<string, string[]> {
  const value = record[key];
  return Array.isArray(value) ? { [key]: value.flatMap((item) => (typeof item === "string" ? [item] : [])) } : {};
}

function stringField(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? { [key]: value } : {};
}

function providerType(value: unknown): NonNullable<PlatformPluginManifest["providerPreset"]>["providerType"] | undefined {
  return value === "mock" || value === "openrouter" || value === "openai_compatible" || value === "anthropic_compatible" || value === "azure_openai" || value === "ollama" || value === "custom_http"
    ? value
    : undefined;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
