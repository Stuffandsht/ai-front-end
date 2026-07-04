import { authorizedJson } from "@/lib/api";
import { getRuntime } from "@/lib/runtime";

export async function GET() {
  return authorizedJson("retention:configure", async () => {
    const runtime = await getRuntime();
    return {
      defaultRetentionMode: runtime.config.singleCompany.defaultRetention,
      modes: ["retained", "limited", "ephemeral"]
    };
  });
}

export async function PATCH(request: Request) {
  return authorizedJson("retention:configure", async () => {
    const body = await request.json() as Record<string, unknown>;
    return {
      defaultRetentionMode: String(body["defaultRetentionMode"] ?? "retained"),
      updated: true
    };
  });
}
