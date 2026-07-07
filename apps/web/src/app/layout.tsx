import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { authorizeRole, type Permission } from "@agent-platform/auth";
import { getConfig, getCurrentUser, getRuntime } from "@/lib/runtime";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Agent Control Plane",
  description: "Self-hostable tenant-aware AI agent chat platform"
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const config = getConfig();
  const singleCompany = config.deploymentMode === "single_company";
  const user = await getCurrentUser();
  const runtime = user ? await getRuntime() : null;
  const membership = user && runtime ? await runtime.db.getMembership(runtime.tenant.id, user.id) : null;
  const can = (permission: Permission) =>
    membership
      ? authorizeRole({
          role: membership.role,
          permission,
          deploymentMode: config.deploymentMode
        }).allowed
      : false;
  const baseAdminLinks = [
    { href: "/admin/company", label: singleCompany ? "Company" : "Tenant", permission: "tenant:update" },
    { href: "/admin/providers", label: "Providers", permission: "provider:configure_tenant" },
    { href: "/admin/prompts", label: "Prompts", permission: "prompt:configure_tenant" },
    { href: "/admin/plugins", label: "Plugins", permission: "mcp:install_tenant" },
    { href: "/admin/retention", label: "Retention", permission: "retention:configure" },
    { href: "/admin/audit", label: "Audit", permission: "audit:read" }
  ] satisfies Array<{ href: string; label: string; permission: Permission }>;
  const baseServiceLinks = [
    { href: "/admin/service", label: "Service", permission: "provider:configure_service" },
    { href: "/admin/tenants", label: "Tenants", permission: "tenant:create" }
  ] satisfies Array<{ href: string; label: string; permission: Permission }>;
  const adminLinks = baseAdminLinks.filter((link) => can(link.permission));
  const serviceLinks = singleCompany
    ? []
    : baseServiceLinks.filter((link) => can(link.permission));
  const visibleAdminLinks = [...adminLinks, ...serviceLinks];

  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <aside className="side-nav">
            <Link className="brand" href="/chat">
              <span className="brand-mark">AI</span>
              <span>{singleCompany ? config.singleCompany.tenantName : "Agent Platform"}</span>
            </Link>
            <nav className="nav-section" aria-label="Primary">
              <p className="nav-section-title">Workspace</p>
              <Link className="nav-link" href="/chat">Chat</Link>
              <Link className="nav-link" href="/settings">Settings</Link>
            </nav>
            {visibleAdminLinks.length > 0 ? (
              <nav className="nav-section" aria-label="Administration">
                <p className="nav-section-title">{singleCompany ? "Company Admin" : "Admin"}</p>
                {visibleAdminLinks.map((link) => (
                  <Link className="nav-link" href={link.href} key={link.href}>{link.label}</Link>
                ))}
              </nav>
            ) : null}
          </aside>
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
