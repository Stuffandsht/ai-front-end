import { requirePagePermission } from "@/lib/page-auth";
import { getRuntime } from "@/lib/runtime";

export default async function ProvidersPage() {
  await requirePagePermission("provider:configure_tenant");
  const runtime = await getRuntime();
  const snapshot = await runtime.db.snapshot();
  return (
    <>
      <div className="topline">
        <h1 className="page-title">Providers</h1>
        <span className="badge">server-side credentials</span>
      </div>
      <div className="grid two">
        {snapshot.providerConfigs.map((provider) => (
          <section className="panel" key={provider.id}>
            <div className="panel-header">
              <h2 className="panel-title">{provider.displayName}</h2>
              <span className={provider.enabled ? "badge ok" : "badge"}>{provider.enabled ? "enabled" : "disabled"}</span>
            </div>
            <div className="panel-body grid">
              <div>Type: {provider.providerType}</div>
              <div>Scope: {provider.scopeType}</div>
              <div>Streaming: {provider.supportsStreaming ? "yes" : "no"}</div>
            </div>
          </section>
        ))}
        <section className="panel">
          <div className="panel-header"><h2 className="panel-title">OpenAI-compatible Adapter</h2></div>
          <div className="panel-body grid">
            <input className="input" placeholder="Base URL" />
            <input className="input" placeholder="Credential reference" />
            <button className="button secondary">Test</button>
          </div>
        </section>
      </div>
    </>
  );
}
