import { authorizedJson } from "@/lib/api";
import { getRuntime } from "@/lib/runtime";

export async function GET() {
  return authorizedJson("provider:configure_tenant", async () => {
    const runtime = await getRuntime();
    return (await runtime.db.snapshot()).providerConfigs.map((provider) => ({
      id: provider.id,
      providerType: provider.providerType,
      displayName: provider.displayName,
      supportsStreaming: provider.supportsStreaming,
      supportsToolCalling: provider.supportsToolCalling,
      enabled: provider.enabled
    }));
  });
}

export async function POST(request: Request) {
  return authorizedJson("provider:configure_tenant", async () => {
    const runtime = await getRuntime();
    const body = await request.json() as Record<string, unknown>;
    const provider = await runtime.db.createProviderConfig({
      tenantId: runtime.tenant.id,
      scopeType: "tenant",
      scopeId: runtime.tenant.id,
      providerType: "openai_compatible",
      displayName: String(body["displayName"] ?? "OpenAI-compatible"),
      baseUrl: String(body["baseUrl"] ?? ""),
      authMode: "tenant_key",
      credentialRef: String(body["credentialRef"] ?? `secret://tenant/provider/${Date.now()}`),
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
      enabled: provider.enabled,
      credentialStored: apiKey.length > 0
    };
  });
}
