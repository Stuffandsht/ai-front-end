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
      return {
        id,
        ok: true,
        providerType: provider.providerType,
        credentialVisibleToBrowser: false
      };
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
    return {
      id,
      ok: true,
      providerType: provider.providerType,
      visibleModelCount: models.length,
      credentialVisibleToBrowser: false
    };
  });
}
