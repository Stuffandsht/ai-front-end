import { authorizedJson } from "@/lib/api";
import { getRuntime } from "@/lib/runtime";

export async function GET() {
  return authorizedJson("provider:configure_tenant", async () => {
    const runtime = await getRuntime();
    const snapshot = await runtime.db.snapshot();
    return snapshot.providerConfigs.map((provider) => ({
      id: provider.id,
      providerType: provider.providerType,
      displayName: provider.displayName,
      baseUrl: provider.baseUrl,
      supportsStreaming: provider.supportsStreaming,
      supportsToolCalling: provider.supportsToolCalling,
      modelCount: snapshot.modelConfigs.filter((model) => model.providerConfigId === provider.id && model.deletedAt == null).length,
      enabled: provider.enabled
    }));
  });
}

export async function POST(request: Request) {
  return authorizedJson("provider:configure_tenant", async () => {
    const runtime = await getRuntime();
    const body = await request.json() as Record<string, unknown>;
    const providerType = body["providerType"] === "openrouter" ? "openrouter" : "openai_compatible";
    const displayName = String(body["displayName"] ?? (providerType === "openrouter" ? "OpenRouter" : "OpenAI-compatible"));
    const baseUrl = String(body["baseUrl"] ?? (providerType === "openrouter" ? "https://openrouter.ai/api/v1" : ""));
    const credentialRef = String(body["credentialRef"] ?? `secret://tenant/provider/${providerType}/${Date.now()}`);
    const provider = await runtime.db.createProviderConfig({
      tenantId: runtime.tenant.id,
      scopeType: "tenant",
      scopeId: runtime.tenant.id,
      providerType,
      displayName,
      baseUrl,
      authMode: "tenant_key",
      credentialRef,
      retentionPolicyClass: "standard",
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsJsonSchema: true,
      supportsEmbeddings: false,
      enabled: true
    });
    const apiKey = typeof body["apiKey"] === "string" ? body["apiKey"] : "";
    if (apiKey.length > 0 && provider.credentialRef) {
      await runtime.db.createProviderCredential({
        tenantId: runtime.tenant.id,
        providerConfigId: provider.id,
        credentialRef: provider.credentialRef,
        secret: apiKey
      });
    }
    await runtime.refreshAdminState();
    return {
      id: provider.id,
      providerType: provider.providerType,
      displayName: provider.displayName,
      baseUrl: provider.baseUrl,
      enabled: provider.enabled,
      credentialStored: apiKey.length > 0
    };
  });
}
