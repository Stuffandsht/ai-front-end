import { authorizedJson } from "@/lib/api";
import { getRuntime } from "@/lib/runtime";

export async function GET() {
  return authorizedJson("provider:configure_tenant", async () => {
    const runtime = await getRuntime();
    return runtime.db.snapshot().modelConfigs;
  });
}

export async function POST(request: Request) {
  return authorizedJson("provider:configure_tenant", async () => {
    const runtime = await getRuntime();
    const body = await request.json() as Record<string, unknown>;
    return runtime.db.createModelConfig({
      tenantId: runtime.tenant.id,
      providerConfigId: String(body["providerConfigId"] ?? "mock"),
      modelKey: String(body["modelKey"] ?? "custom-model"),
      displayName: String(body["displayName"] ?? "Custom Model"),
      contextWindow: Number(body["contextWindow"] ?? 8192),
      maxOutputTokens: Number(body["maxOutputTokens"] ?? 1024),
      supportsTools: true,
      supportsStreaming: true,
      supportsJsonSchema: true,
      inputModalitiesJson: ["text"],
      outputModalitiesJson: ["text"],
      enabled: true
    });
  });
}
