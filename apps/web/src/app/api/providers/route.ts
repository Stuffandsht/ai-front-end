import { authorizedJson } from "@/lib/api";
import { getRuntime } from "@/lib/runtime";

export async function GET() {
  return authorizedJson("provider:configure_tenant", async () => {
    const runtime = await getRuntime();
    return runtime.db.snapshot().providerConfigs.map((provider) => ({
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
    return runtime.db.createProviderConfig({
      tenantId: runtime.tenant.id,
      scopeType: "tenant",
      scopeId: runtime.tenant.id,
      providerType: "openai_compatible",
      displayName: String(body["displayName"] ?? "OpenAI-compatible"),
      baseUrl: String(body["baseUrl"] ?? ""),
      authMode: "tenant_key",
      credentialRef: String(body["credentialRef"] ?? "secret://tenant/provider"),
      retentionPolicyClass: "standard",
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsJsonSchema: true,
      supportsEmbeddings: false,
      enabled: true
    });
  });
}
