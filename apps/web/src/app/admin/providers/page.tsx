import { revalidatePath } from "next/cache";
import { requirePagePermission } from "@/lib/page-auth";
import { getRuntime } from "@/lib/runtime";
import { OpenRouterProvider } from "@agent-platform/providers";

export default async function ProvidersPage() {
  await requirePagePermission("provider:configure_tenant");
  const runtime = await getRuntime();
  const snapshot = await runtime.db.snapshot();
  return (
    <>
      <div className="topline">
        <h1 className="page-title">Providers</h1>
        <span className="badge">server-side credentials</span>
      </div>
      <div className="grid two">
        {snapshot.providerConfigs.map((provider) => (
          <section className="panel" key={provider.id}>
            <div className="panel-header">
              <h2 className="panel-title">{provider.displayName}</h2>
              <span className={provider.enabled ? "badge ok" : "badge"}>{provider.enabled ? "enabled" : "disabled"}</span>
            </div>
            <div className="panel-body grid">
              <div>Type: {provider.providerType}</div>
              <div>Scope: {provider.scopeType}</div>
              <div>Streaming: {provider.supportsStreaming ? "yes" : "no"}</div>
              <div>Models: {snapshot.modelConfigs.filter((model) => model.providerConfigId === provider.id && model.deletedAt == null).length}</div>
              {provider.providerType === "openrouter" ? (
                <form action={syncOpenRouterModelsAction}>
                  <input type="hidden" name="providerId" value={provider.id} />
                  <button className="button secondary" type="submit">Sync models</button>
                </form>
              ) : null}
            </div>
          </section>
        ))}
        <section className="panel">
          <div className="panel-header"><h2 className="panel-title">OpenRouter</h2></div>
          <form className="panel-body grid" action={createOpenRouterProviderAction}>
            <div className="field">
              <label htmlFor="openrouter-display-name">Display name</label>
              <input className="input" id="openrouter-display-name" name="displayName" defaultValue="OpenRouter" />
            </div>
            <div className="field">
              <label htmlFor="openrouter-base-url">Base URL</label>
              <input className="input" id="openrouter-base-url" name="baseUrl" defaultValue="https://openrouter.ai/api/v1" />
            </div>
            <div className="field">
              <label htmlFor="openrouter-credential-ref">Credential reference</label>
              <input className="input" id="openrouter-credential-ref" name="credentialRef" defaultValue="secret://tenant/provider/openrouter" />
            </div>
            <div className="field">
              <label htmlFor="openrouter-api-key">API key</label>
              <input className="input" id="openrouter-api-key" name="apiKey" type="password" />
            </div>
            <button className="button secondary" type="submit">Add OpenRouter</button>
          </form>
        </section>
        <section className="panel">
          <div className="panel-header"><h2 className="panel-title">OpenAI-compatible Adapter</h2></div>
          <form className="panel-body grid" action={createOpenAiCompatibleProviderAction}>
            <div className="field">
              <label htmlFor="openai-compatible-display-name">Display name</label>
              <input className="input" id="openai-compatible-display-name" name="displayName" defaultValue="OpenAI-compatible" />
            </div>
            <div className="field">
              <label htmlFor="openai-compatible-base-url">Base URL</label>
              <input className="input" id="openai-compatible-base-url" name="baseUrl" />
            </div>
            <div className="field">
              <label htmlFor="openai-compatible-credential-ref">Credential reference</label>
              <input className="input" id="openai-compatible-credential-ref" name="credentialRef" />
            </div>
            <div className="field">
              <label htmlFor="openai-compatible-api-key">API key</label>
              <input className="input" id="openai-compatible-api-key" name="apiKey" type="password" />
            </div>
            <button className="button secondary" type="submit">Add adapter</button>
          </form>
        </section>
      </div>
    </>
  );
}

async function createOpenRouterProviderAction(formData: FormData) {
  "use server";
  await requirePagePermission("provider:configure_tenant");
  const runtime = await getRuntime();
  const provider = await runtime.db.createProviderConfig({
    tenantId: runtime.tenant.id,
    scopeType: "tenant",
    scopeId: runtime.tenant.id,
    providerType: "openrouter",
    displayName: formValue(formData, "displayName", "OpenRouter"),
    baseUrl: formValue(formData, "baseUrl", "https://openrouter.ai/api/v1"),
    authMode: "tenant_key",
    credentialRef: formValue(formData, "credentialRef", "secret://tenant/provider/openrouter"),
    retentionPolicyClass: "standard",
    supportsStreaming: true,
    supportsToolCalling: true,
    supportsJsonSchema: true,
    supportsEmbeddings: false,
    enabled: true
  });
  const apiKey = formValue(formData, "apiKey", "");
  if (apiKey.length > 0 && provider.credentialRef) {
    await runtime.db.createProviderCredential({
      tenantId: runtime.tenant.id,
      providerConfigId: provider.id,
      credentialRef: provider.credentialRef,
      secret: apiKey
    });
  }
  await runtime.refreshAdminState();
  revalidatePath("/admin/providers");
}

async function createOpenAiCompatibleProviderAction(formData: FormData) {
  "use server";
  await requirePagePermission("provider:configure_tenant");
  const runtime = await getRuntime();
  const provider = await runtime.db.createProviderConfig({
    tenantId: runtime.tenant.id,
    scopeType: "tenant",
    scopeId: runtime.tenant.id,
    providerType: "openai_compatible",
    displayName: formValue(formData, "displayName", "OpenAI-compatible"),
    baseUrl: formValue(formData, "baseUrl", ""),
    authMode: "tenant_key",
    credentialRef: formValue(formData, "credentialRef", `secret://tenant/provider/${Date.now()}`),
    retentionPolicyClass: "standard",
    supportsStreaming: true,
    supportsToolCalling: true,
    supportsJsonSchema: true,
    supportsEmbeddings: false,
    enabled: true
  });
  const apiKey = formValue(formData, "apiKey", "");
  if (apiKey.length > 0 && provider.credentialRef) {
    await runtime.db.createProviderCredential({
      tenantId: runtime.tenant.id,
      providerConfigId: provider.id,
      credentialRef: provider.credentialRef,
      secret: apiKey
    });
  }
  await runtime.refreshAdminState();
  revalidatePath("/admin/providers");
}

async function syncOpenRouterModelsAction(formData: FormData) {
  "use server";
  await requirePagePermission("provider:configure_tenant");
  const runtime = await getRuntime();
  const providerId = formValue(formData, "providerId", "");
  const snapshot = await runtime.db.snapshot();
  const provider = snapshot.providerConfigs.find((item) => item.id === providerId && item.tenantId === runtime.tenant.id && item.deletedAt == null);
  if (!provider || provider.providerType !== "openrouter") {
    return;
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
    if (existing) {
      await runtime.db.updateModelConfig(existing.id, modelInput);
    } else {
      await runtime.db.createModelConfig({
        tenantId: runtime.tenant.id,
        providerConfigId: provider.id,
        modelKey: model.id,
        ...modelInput
      });
    }
  }
  await runtime.refreshAdminState();
  revalidatePath("/admin/providers");
}

function formValue(formData: FormData, key: string, fallback: string): string {
  const value = formData.get(key);
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
