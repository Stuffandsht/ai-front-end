import { requirePagePermission } from "@/lib/page-auth";
import { getRuntime } from "@/lib/runtime";

export default async function SettingsPage() {
  await requirePagePermission("settings:read");
  const runtime = await getRuntime();
  const byoAllowed = runtime.policyDocuments.tenant?.userByoProviderAllowed === true;
  return (
    <>
      <div className="topline">
        <h1 className="page-title">Settings</h1>
        <span className={byoAllowed ? "badge ok" : "badge"}>BYO provider {byoAllowed ? "allowed" : "disabled"}</span>
      </div>
      <div className="grid two">
        <section className="panel">
          <div className="panel-header"><h2 className="panel-title">Provider Preference</h2></div>
          <div className="panel-body grid">
            <div className="field">
              <label htmlFor="provider">Provider</label>
              <select className="select" id="provider"><option>Mock Provider</option></select>
            </div>
            {byoAllowed ? (
              <div className="field">
                <label htmlFor="credential">BYO credential reference</label>
                <input className="input" id="credential" placeholder="Stored server-side only" />
              </div>
            ) : null}
          </div>
        </section>
        <section className="panel">
          <div className="panel-header"><h2 className="panel-title">Personal Prompt</h2></div>
          <div className="panel-body">
            <textarea className="textarea" defaultValue="Prefer concise, actionable responses." />
          </div>
        </section>
        <section className="panel">
          <div className="panel-header"><h2 className="panel-title">Retention Preference</h2></div>
          <div className="panel-body">
            <select className="select"><option>Company default</option><option>Limited</option><option>Ephemeral</option></select>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header"><h2 className="panel-title">User Plugins</h2></div>
          <div className="panel-body timeline">
            {runtime.mcp.listTools().map((tool) => <div className="timeline-item" key={tool.id}>{tool.name}</div>)}
          </div>
        </section>
      </div>
    </>
  );
}
