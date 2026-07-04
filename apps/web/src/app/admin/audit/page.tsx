import { requirePagePermission } from "@/lib/page-auth";
import { getRuntime } from "@/lib/runtime";

export default async function AuditPage() {
  await requirePagePermission("audit:read");
  const runtime = await getRuntime();
  const events = runtime.db.snapshot().auditEvents.slice().reverse();
  return (
    <>
      <div className="topline">
        <h1 className="page-title">Audit</h1>
        <span className="badge">metadata-safe</span>
      </div>
      <section className="panel">
        <div className="panel-header"><h2 className="panel-title">Events</h2></div>
        <div>
          {events.length === 0 ? (
            <div className="list-row subtle">No audit events yet</div>
          ) : (
            events.map((event) => (
              <div className="list-row" key={event.id}>
                <strong>{event.type}</strong>
                <span className="subtle">{event.retentionMode} · {event.auditContentMode}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}
