import { requirePagePermission } from "@/lib/page-auth";
import { getRuntime } from "@/lib/runtime";

export default async function RetentionPage() {
  await requirePagePermission("retention:configure");
  const runtime = await getRuntime();
  return (
    <>
      <div className="topline">
        <h1 className="page-title">Retention</h1>
        <span className="badge">{runtime.config.singleCompany.defaultRetention}</span>
      </div>
      <div className="grid two">
        <section className="panel">
          <div className="panel-header"><h2 className="panel-title">Defaults</h2></div>
          <div className="panel-body grid">
            <select className="select" defaultValue={runtime.config.singleCompany.defaultRetention}>
              <option value="retained">Retained</option>
              <option value="limited">Limited</option>
              <option value="ephemeral">Ephemeral</option>
            </select>
            <label><input type="checkbox" /> Require ephemeral for all chats</label>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header"><h2 className="panel-title">Guarantees</h2></div>
          <div className="panel-body timeline">
            <div className="timeline-item">Ephemeral: metadata-only audit, no message, prompt, tool payload, job, embedding, or attachment persistence.</div>
            <div className="timeline-item">Limited: message content encrypted, sensitive payloads redacted.</div>
            <div className="timeline-item">Retained: encrypted content and full audit payloads subject to redaction.</div>
          </div>
        </section>
      </div>
    </>
  );
}
