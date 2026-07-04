import { requirePagePermission } from "@/lib/page-auth";
import { getRuntime } from "@/lib/runtime";

export default async function PluginsPage() {
  await requirePagePermission("mcp:install_tenant");
  const runtime = await getRuntime();
  return (
    <>
      <div className="topline">
        <h1 className="page-title">Plugins</h1>
        <span className="badge warn">external execution disabled by default</span>
      </div>
      <div className="grid two">
        {runtime.mcp.listTools().map((tool) => (
          <section className="panel" key={tool.id}>
            <div className="panel-header">
              <h2 className="panel-title">{tool.name}</h2>
              <span className={tool.riskLevel === "high" ? "badge warn" : "badge ok"}>{tool.riskLevel}</span>
            </div>
            <div className="panel-body grid">
              <div>{tool.description}</div>
              <label><input type="checkbox" defaultChecked={tool.id === "mock.read_context"} /> Enabled</label>
              <label><input type="checkbox" defaultChecked={tool.requiresConfirmation} /> Requires confirmation</label>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
