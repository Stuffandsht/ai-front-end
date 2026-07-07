import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/page-auth";
import { getRuntime } from "@/lib/runtime";

export default async function TenantsPage() {
  const runtime = await getRuntime();
  if (runtime.config.deploymentMode === "single_company") {
    notFound();
  }
  await requirePagePermission("tenant:create");
  return (
    <>
      <div className="topline">
        <h1 className="page-title">Tenants</h1>
        <span className="badge">multi-tenant</span>
      </div>
      <section className="panel">
        <div className="panel-header"><h2 className="panel-title">Tenant List</h2></div>
        <div>
          {(await runtime.db.listTenants()).map((tenant) => (
            <div className="list-row" key={tenant.id}>
              <strong>{tenant.name}</strong>
              <span className="subtle">{tenant.slug}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
