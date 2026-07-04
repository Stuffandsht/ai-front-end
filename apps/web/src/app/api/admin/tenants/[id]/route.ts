import { authorizedJson } from "@/lib/api";

export async function PATCH(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authorizedJson("tenant:update", async () => ({ id: (await params).id, updated: true }));
}
