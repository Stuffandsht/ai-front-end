import { authorizedJson, protectedJson } from "@/lib/api";
import { getRuntime } from "@/lib/runtime";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return protectedJson(async () => {
    const runtime = await getRuntime();
    const { id } = await params;
    return {
      id,
      messages: await runtime.db.listMessages(runtime.tenant.id, id)
    };
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authorizedJson("provider:use", async () => {
    const { id } = await params;
    return {
      id,
      deleted: true
    };
  });
}
