import { authorizedJson } from "@/lib/api";
import { getRuntime } from "@/lib/runtime";

export async function GET() {
  return authorizedJson("tenant:read", async () => {
    const runtime = await getRuntime();
    if (runtime.config.deploymentMode === "single_company") {
      throw new Error("Tenant list is hidden in single_company mode");
    }
    return runtime.db.listTenants();
  });
}

export async function POST(request: Request) {
  return authorizedJson("tenant:create", async () => {
    const runtime = await getRuntime();
    const body = await request.json() as Record<string, unknown>;
    const tenantInput: { slug: string; name: string; primaryDomain?: string } = {
      slug: String(body["slug"] ?? ""),
      name: String(body["name"] ?? "")
    };
    const primaryDomain = optionalString(body["primaryDomain"]);
    if (primaryDomain) {
      tenantInput.primaryDomain = primaryDomain;
    }
    return runtime.db.createTenantForApi(tenantInput, runtime.config.deploymentMode);
  });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
