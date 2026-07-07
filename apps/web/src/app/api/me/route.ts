import { protectedJson } from "@/lib/api";
import { getRuntime, requireCurrentUser } from "@/lib/runtime";

export async function GET() {
  return protectedJson(async () => {
    const runtime = await getRuntime();
    const user = await requireCurrentUser();
    const membership = await runtime.db.getMembership(runtime.tenant.id, user.id);
    return {
      user,
      tenant: runtime.tenant,
      membership
    };
  });
}
