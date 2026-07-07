import { authorizedJson } from "@/lib/api";
import { getRuntime } from "@/lib/runtime";

export async function GET() {
  return authorizedJson("audit:read", async () => {
    const runtime = await getRuntime();
    return (await runtime.db.snapshot()).auditEvents.map((event) => ({
      id: event.id,
      type: event.type,
      requestId: event.requestId ?? null,
      metadata: event.metadata,
      retentionMode: event.retentionMode,
      auditContentMode: event.auditContentMode,
      createdAt: event.createdAt
    }));
  });
}
