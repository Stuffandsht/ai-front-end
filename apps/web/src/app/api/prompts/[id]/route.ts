import { authorizedJson } from "@/lib/api";

export async function PATCH(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authorizedJson("prompt:configure_tenant", async () => ({ id: (await params).id, updated: true }));
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authorizedJson("prompt:configure_tenant", async () => ({ id: (await params).id, deleted: true }));
}
