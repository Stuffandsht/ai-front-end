import { requirePagePermission } from "@/lib/page-auth";
import { getRuntime } from "@/lib/runtime";

export default async function CompanyAdminPage() {
  await requirePagePermission("tenant:update");
  const runtime = await getRuntime();
  return (
    <>
      <div className="topline">
        <h1 className="page-title">{runtime.config.deploymentMode === "single_company" ? "Company Admin" : "Tenant Admin"}</h1>
        <span className="badge">{runtime.tenant.slug}</span>
      </div>
      <div className="grid two">
        <section className="panel">
          <div className="panel-header"><h2 className="panel-title">Company</h2></div>
          <div className="panel-body grid">
            <div className="field"><label>Name</label><input className="input" defaultValue={runtime.tenant.name} /></div>
            <div className="field"><label>Primary domain</label><input className="input" defaultValue={runtime.tenant.primaryDomain ?? ""} /></div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header"><h2 className="panel-title">OIDC</h2></div>
          <div className="panel-body grid">
            <div className="field"><label>Issuer URL</label><input className="input" placeholder="https://login.microsoftonline.com/.../v2.0" /></div>
            <div className="field"><label>Client ID</label><input className="input" placeholder="Application client ID" /></div>
            <div className="field"><label>Secret reference</label><input className="input" placeholder="secret://tenant/oidc-client-secret" /></div>
          </div>
        </section>
      </div>
    </>
  );
}
