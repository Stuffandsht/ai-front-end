import { protectedJson } from "@/lib/api";
import { getRuntime, requireCurrentUser } from "@/lib/runtime";

export async function GET() {
  return protectedJson(async () => {
    const runtime = await getRuntime();
    const user = await requireCurrentUser();
    return runtime.runtime.getConversations(user);
  });
}
