import { authorizedJson } from "@/lib/api";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authorizedJson("provider:configure_tenant", async () => ({
    id: (await params).id,
    ok: true,
    credentialVisibleToBrowser: false
  }));
}
