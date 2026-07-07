import { authorizedJson } from "@/lib/api";
import { getRuntime } from "@/lib/runtime";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authorizedJson("provider:configure_tenant", async () => {
    const runtime = await getRuntime();
    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;
    const provider = await runtime.db.updateProviderConfig(id, {
      ...(typeof body["displayName"] === "string" ? { displayName: body["displayName"] } : {}),
      ...(typeof body["baseUrl"] === "string" ? { baseUrl: body["baseUrl"] } : {}),
      ...(typeof body["enabled"] === "boolean" ? { enabled: body["enabled"] } : {})
    });
    if (!provider) {
      return { id, updated: false };
    }
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
      updated: true,
      enabled: provider.enabled,
      credentialStored: apiKey.length > 0
    };
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authorizedJson("provider:configure_tenant", async () => {
    const runtime = await getRuntime();
    const { id } = await params;
    const provider = await runtime.db.deleteProviderConfig(id);
    await runtime.refreshAdminState();
    return { id, deleted: Boolean(provider) };
  });
}
