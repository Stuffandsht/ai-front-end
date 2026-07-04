import { publicConfig } from "@agent-platform/config";
import { json } from "@/lib/api";
import { getConfig } from "@/lib/runtime";

export async function GET() {
  return json(async () => publicConfig(getConfig()));
}
