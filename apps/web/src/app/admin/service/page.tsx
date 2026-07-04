import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/page-auth";
import { getRuntime } from "@/lib/runtime";

export default async function ServiceAdminPage() {
  const runtime = await getRuntime();
  if (runtime.config.deploymentMode === "single_company") {
    notFound();
  }
  await requirePagePermission("provider:configure_service");
  return (
    <>
      <div className="topline">
        <h1 className="page-title">Service Admin</h1>
        <span className="badge">multi-tenant only</span>
      </div>
      <section className="panel">
        <div className="panel-header"><h2 className="panel-title">Service Defaults</h2></div>
        <div className="panel-body grid">
          <div className="field"><label>Default provider</label><select className="select"><option>Mock Provider</option></select></div>
          <div className="field"><label>Provider policy ceiling</label><input className="input" defaultValue="mock,user-openai" /></div>
        </div>
      </section>
    </>
  );
}
