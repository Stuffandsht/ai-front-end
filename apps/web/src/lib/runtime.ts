import { cookies } from "next/headers";
import { readAppConfig } from "@agent-platform/config";
import { createRuntime } from "@agent-platform/runtime";

type RuntimeBundle = Awaited<ReturnType<typeof createRuntime>>;

let runtimePromise: Promise<RuntimeBundle> | null = null;

export function getConfig() {
  return readAppConfig();
}

export async function getRuntime(): Promise<RuntimeBundle> {
  runtimePromise ??= createRuntime(getConfig());
  return runtimePromise;
}

export async function getCurrentUser() {
  const runtime = await getRuntime();
  const config = getConfig();
  const cookieStore = await cookies();
  const session = cookieStore.get(config.sessionCookieName)?.value;
  if (!session) {
    return null;
  }
  return runtime.db.findUserById(session);
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}
