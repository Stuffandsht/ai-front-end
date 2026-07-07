import { NextResponse } from "next/server";
import { assertAuthorized, type Permission } from "@agent-platform/auth";
import { getRuntime, requireCurrentUser } from "./runtime";

export type ApiHandler<T> = () => Promise<T>;

export async function json<T>(handler: ApiHandler<T>): Promise<NextResponse<T | { error: string }>> {
  try {
    return NextResponse.json(await handler());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = message === "Unauthorized" ? 401 : message.startsWith("Forbidden:") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function protectedJson<T>(handler: ApiHandler<T>): Promise<NextResponse<T | { error: string }>> {
  return json(async () => {
    await requireCurrentUser();
    return handler();
  });
}

export async function authorizedJson<T>(permission: Permission, handler: ApiHandler<T>): Promise<NextResponse<T | { error: string }>> {
  return json(async () => {
    const runtime = await getRuntime();
    const user = await requireCurrentUser();
    const membership = await runtime.db.getMembership(runtime.tenant.id, user.id);
    if (!membership) {
      throw new Error("Forbidden: user has no tenant membership");
    }
    assertAuthorized({
      role: membership.role,
      permission,
      deploymentMode: runtime.config.deploymentMode
    });
    return handler();
  });
}
