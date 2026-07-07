import { authorizedJson } from "@/lib/api";
import { getRuntime } from "@/lib/runtime";
import { OpenRouterProvider } from "@agent-platform/providers";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authorizedJson("provider:configure_tenant", async () => {
    const runtime = await getRuntime();
    const { id } = await params;
    const snapshot = await runtime.db.snapshot();
    const provider = snapshot.providerConfigs.find((item) => item.id === id && item.tenantId === runtime.tenant.id && item.deletedAt == null);
    if (!provider) {
      throw new Error(`Provider ${id} not found`);
    }
    if (provider.providerType !== "openrouter") {
      throw new Error("Model sync is currently implemented for OpenRouter providers");
    }

    const apiKey =
      provider.authMode === "none"
        ? ""
        : await runtime.db.getProviderCredentialSecret({
            tenantId: provider.tenantId,
            providerConfigId: provider.id,
            credentialRef: provider.credentialRef
          });
    const openRouter = new OpenRouterProvider({
      id: provider.id,
      apiKey: apiKey ?? "",
      baseUrl: provider.baseUrl ?? "https://openrouter.ai/api/v1",
      appUrl: runtime.config.publicBaseUrl,
      appTitle: runtime.tenant.name
    });
    const models = await openRouter.listModels();
    const synced = [];
    for (const model of models) {
      const existing = snapshot.modelConfigs.find((item) => item.providerConfigId === provider.id && item.modelKey === model.id && item.deletedAt == null);
      const modelInput = {
        displayName: model.displayName,
        contextWindow: model.contextWindow ?? 8192,
        maxOutputTokens: model.maxOutputTokens ?? 1024,
        supportsTools: model.supportsTools,
        supportsStreaming: model.supportsStreaming,
        supportsJsonSchema: model.supportsJsonSchema ?? false,
        inputModalitiesJson: model.inputModalities ?? ["text"],
        outputModalitiesJson: model.outputModalities ?? ["text"],
        enabled: true
      };
      const row = existing
        ? await runtime.db.updateModelConfig(existing.id, modelInput)
        : await runtime.db.createModelConfig({
            tenantId: runtime.tenant.id,
            providerConfigId: provider.id,
            modelKey: model.id,
            ...modelInput
          });
      if (row) {
        synced.push({
          id: row.id,
          modelKey: row.modelKey,
          displayName: row.displayName,
          supportsTools: row.supportsTools,
          supportsStreaming: row.supportsStreaming,
          contextWindow: row.contextWindow
        });
      }
    }
    await runtime.refreshAdminState();
    return {
      providerId: provider.id,
      syncedCount: synced.length,
      models: synced
    };
  });
}
