import { notFound, redirect } from "next/navigation";
import { authorizeRole, type Permission } from "@agent-platform/auth";
import { getCurrentUser, getRuntime } from "./runtime";

export async function requirePageUser() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

export async function requirePagePermission(permission: Permission) {
  const user = await requirePageUser();
  const runtime = await getRuntime();
  const membership = runtime.db.getMembership(runtime.tenant.id, user.id);
  if (!membership) {
    notFound();
  }
  const decision = authorizeRole({
    role: membership.role,
    permission,
    deploymentMode: runtime.config.deploymentMode
  });
  if (!decision.allowed) {
    notFound();
  }
  return user;
}
