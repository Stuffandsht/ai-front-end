import { requirePagePermission } from "@/lib/page-auth";
import { getRuntime } from "@/lib/runtime";

export default async function PromptsPage() {
  await requirePagePermission("prompt:configure_tenant");
  const runtime = await getRuntime();
  const prompts = runtime.db.snapshot().promptFragments;
  return (
    <>
      <div className="topline">
        <h1 className="page-title">Prompts</h1>
        <span className="badge">encrypted at rest</span>
      </div>
      <div className="grid two">
        {prompts.map((prompt) => (
          <section className="panel" key={prompt.id}>
            <div className="panel-header">
              <h2 className="panel-title">{prompt.name}</h2>
              <span className="badge">{runtime.config.deploymentMode === "single_company" && prompt.scopeType === "tenant" ? "company" : prompt.scopeType}</span>
            </div>
            <div className="panel-body grid">
              <div>Priority: {prompt.priority}</div>
              <div>Version: {prompt.version}</div>
              <div className="subtle">Ciphertext key: {prompt.contentCiphertext.contentKeyId}</div>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
