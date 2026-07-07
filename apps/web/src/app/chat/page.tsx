import { getCurrentUser, getRuntime } from "@/lib/runtime";
import { requirePageUser } from "@/lib/page-auth";

export default async function ChatPage() {
  const runtime = await getRuntime();
  const user = (await getCurrentUser()) ?? (await requirePageUser());
  const conversations = user ? await runtime.runtime.getConversations(user) : [];
  const snapshot = await runtime.db.snapshot();
  const providers = snapshot.providerConfigs.filter((provider) => provider.enabled);
  const models = snapshot.modelConfigs.filter((model) => model.enabled);
  const audit = snapshot.auditEvents.slice(-4).reverse();
  const tools = runtime.mcp.listTools();
  const toolTimeline = snapshot.toolInvocations.filter((invocation) => invocation.tenantId === runtime.tenant.id).slice(-6).reverse();

  return (
    <>
      <div className="topline">
        <div>
          <h1 className="page-title">Chat</h1>
          <div className="subtle">{runtime.config.deploymentMode === "single_company" ? runtime.tenant.name : "Multi-tenant workspace"}</div>
        </div>
        <span className="badge ok">No chat content in localStorage</span>
      </div>
      <div className="chat-layout">
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Conversations</h2>
            <form action="/chat">
              <button className="button secondary" type="submit">New</button>
            </form>
          </div>
          <div>
            {conversations.length === 0 ? (
              <div className="list-row subtle">No retained conversations yet</div>
            ) : (
              conversations.map((conversation) => (
                <div className="list-row" key={conversation.id}>
                  <strong>{conversation.title}</strong>
                  <span className="subtle">{conversation.retentionMode}</span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Conversation</h2>
            <span className="badge">retained</span>
          </div>
          <div className="panel-body grid">
            <div className="message-stack">
              <div className="message assistant">Mock provider is ready. Select a provider, retention mode, and enabled tools before sending.</div>
              <div className="message user">Ask for a tool to see the mock tool timeline.</div>
            </div>
            <form className="grid" action="/api/chat" method="post">
              <div className="toolbar">
                <select className="select" name="requestedProviderId" aria-label="Provider">
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.displayName}</option>
                  ))}
                </select>
                <select className="select" name="requestedModelId" aria-label="Model">
                  {models.map((model) => (
                    <option key={model.id} value={model.modelKey}>{model.displayName}</option>
                  ))}
                </select>
                <select className="select" name="requestedRetentionMode" aria-label="Retention mode">
                  <option value="retained">Retained</option>
                  <option value="limited">Limited</option>
                  <option value="ephemeral">Ephemeral</option>
                </select>
              </div>
              <div className="subtle">Ephemeral mode avoids local content retention; configured providers and tools may still process the request.</div>
              <div className="toolbar">
                {tools.map((tool) => (
                  <label key={tool.id}>
                    <input type="checkbox" name="enabledToolIds" value={tool.id} defaultChecked={tool.id === "mock.read_context"} /> {tool.name}
                  </label>
                ))}
              </div>
              <div className="toolbar">
                {tools.filter((tool) => tool.requiresConfirmation).map((tool) => (
                  <label key={tool.id}>
                    <input type="checkbox" name="confirmedToolIds" value={tool.id} /> Confirm {tool.name}
                  </label>
                ))}
              </div>
              <textarea className="textarea" name="message" defaultValue="Use tool context for this request." aria-label="Message" />
              <button className="button" type="submit">Send</button>
            </form>
          </div>
        </section>

        <aside className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Tools</h2>
            <span className="badge">policy gated</span>
          </div>
          <div className="panel-body timeline">
            {tools.map((tool) => (
              <div className="timeline-item" key={tool.id}>
                <strong>{tool.name}</strong>
                <div className="subtle">{tool.riskLevel}{tool.requiresConfirmation ? " confirmation required" : ""}</div>
              </div>
            ))}
          </div>
          <div className="panel-header">
            <h2 className="panel-title">Tool timeline</h2>
          </div>
          <div className="panel-body timeline">
            {toolTimeline.length === 0 ? <div className="subtle">No tool calls yet</div> : toolTimeline.map((item) => (
              <div className="timeline-item" key={item.id}>
                <strong>{item.toolId}</strong>
                <div className="subtle">{item.status} · {item.retentionMode}</div>
              </div>
            ))}
          </div>
          <div className="panel-header">
            <h2 className="panel-title">Recent audit</h2>
          </div>
          <div className="panel-body timeline">
            {audit.length === 0 ? <div className="subtle">No events yet</div> : audit.map((event) => (
              <div className="timeline-item" key={event.id}>{event.type} · {event.retentionMode}</div>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}
