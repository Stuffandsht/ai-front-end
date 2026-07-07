import { describe, expect, it } from "vitest";
import { buildRetentionContext } from "@agent-platform/retention";
import { compileEffectivePolicy } from "@agent-platform/policy";
import { createTestRuntime, uniqueSentinel } from "@agent-platform/test-utils";

describe("runtime integration", () => {
  it("persists retained chat messages encrypted and reloads them through repositories", async () => {
    const runtime = await createTestRuntime();
    const sentinel = uniqueSentinel("SENTINEL_RETAINED_ENCRYPTED");
    const result = await runtime.runtime.runChat(runtime.devUser, {
      message: sentinel,
      requestedRetentionMode: "retained"
    });

    expect(result.conversation?.id).toBeTruthy();
    expect(runtime.db.rawSearch(sentinel)).toBe(false);
    const messages = await runtime.db.listMessages(runtime.tenant.id, result.conversation?.id ?? "");
    expect(messages.some((message) => message.content.includes(sentinel))).toBe(true);
  });

  it("does not persist ephemeral sentinel content in database, jobs, vectors, or tool payloads", async () => {
    const runtime = await createTestRuntime();
    const sentinel = uniqueSentinel();
    const result = await runtime.runtime.runChat(runtime.devUser, {
      message: `${sentinel} use tool`,
      requestedRetentionMode: "ephemeral",
      enabledToolIds: ["mock.read_context"]
    });

    expect(result.conversation).toBeNull();
    expect(runtime.db.rawSearch(sentinel)).toBe(false);
    const snapshot = runtime.db.snapshot();
    expect(snapshot.messages).toHaveLength(0);
    expect(snapshot.attachments).toHaveLength(0);
    expect(snapshot.backgroundJobs.every((job) => !JSON.stringify(job.payloadJson).includes(sentinel))).toBe(true);
    expect(snapshot.toolInvocations.every((invocation) => invocation.argsCiphertextNullable == null && invocation.resultCiphertextNullable == null)).toBe(true);
    expect(snapshot.auditEvents.some((event) => event.retentionMode === "ephemeral" && event.auditContentMode === "metadata_only")).toBe(true);
  });

  it("encrypts provider credentials and prompt fragments", async () => {
    const runtime = await createTestRuntime();
    const credential = uniqueSentinel("PROVIDER_SECRET");
    await runtime.db.createProviderCredential({
      tenantId: runtime.tenant.id,
      providerConfigId: runtime.db.snapshot().providerConfigs[0]?.id ?? "mock",
      credentialRef: "secret://tenant/provider",
      secret: credential
    });
    const prompt = uniqueSentinel("PROMPT_SECRET");
    await runtime.db.createPromptFragment({
      tenantId: runtime.tenant.id,
      scopeType: "tenant",
      scopeId: runtime.tenant.id,
      name: "Secret Prompt",
      content: prompt,
      priority: 1,
      createdBy: runtime.devUser.id
    });
    const pluginConfig = uniqueSentinel("MCP_PLUGIN_SECRET");
    const server = await runtime.db.createMcpServer({
      name: "Secret MCP",
      description: "MCP server with encrypted tenant config",
      transportType: "http",
      serverUrl: "https://mcp.example.test",
      containerImage: null,
      command: null,
      argsJson: [],
      envSecretRefsJson: ["env://MCP_API_KEY"],
      riskLevel: "low",
      retentionPolicyClass: "metadata_only_required",
      enabled: true
    });
    await runtime.db.createPluginInstallation({
      tenantId: runtime.tenant.id,
      scopeType: "tenant",
      scopeId: runtime.tenant.id,
      mcpServerId: server.id,
      enabled: true,
      installedBy: runtime.devUser.id,
      approvedBy: runtime.devUser.id,
      config: pluginConfig
    });

    expect(runtime.db.rawSearch(credential)).toBe(false);
    expect(runtime.db.rawSearch(prompt)).toBe(false);
    expect(runtime.db.rawSearch(pluginConfig)).toBe(false);
  });

  it("registers OpenRouter tenant providers and models into effective policy inventory", async () => {
    const runtime = await createTestRuntime();
    const credential = uniqueSentinel("OPENROUTER_SECRET");
    const provider = await runtime.db.createProviderConfig({
      tenantId: runtime.tenant.id,
      scopeType: "tenant",
      scopeId: runtime.tenant.id,
      providerType: "openrouter",
      displayName: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      authMode: "tenant_key",
      credentialRef: "secret://tenant/provider/openrouter",
      retentionPolicyClass: "standard",
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsJsonSchema: true,
      supportsEmbeddings: false,
      enabled: true
    });
    await runtime.db.createProviderCredential({
      tenantId: runtime.tenant.id,
      providerConfigId: provider.id,
      credentialRef: provider.credentialRef ?? "secret://tenant/provider/openrouter",
      secret: credential
    });
    await runtime.db.createModelConfig({
      tenantId: runtime.tenant.id,
      providerConfigId: provider.id,
      modelKey: "openai/gpt-4o",
      displayName: "GPT-4o",
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsTools: true,
      supportsStreaming: true,
      supportsJsonSchema: true,
      inputModalitiesJson: ["text"],
      outputModalitiesJson: ["text"],
      enabled: true
    });
    await runtime.refreshAdminState();

    const policy = compileEffectivePolicy(
      {
        deploymentMode: runtime.config.deploymentMode,
        tenantId: runtime.tenant.id,
        userId: runtime.devUser.id,
        groupIds: [],
        requestedProviderId: provider.id,
        requestedModelId: "openai/gpt-4o"
      },
      runtime.policyDocuments,
      runtime.inventory
    );

    expect(runtime.db.rawSearch(credential)).toBe(false);
    expect(runtime.inventory.providers.some((item) => item.id === provider.id && item.modelIds.includes("openai/gpt-4o"))).toBe(true);
    expect(policy.selectedProviderId).toBe(provider.id);
    expect(policy.selectedModelId).toBe("openai/gpt-4o");
  });

  it("stores tool arguments/results only when retention allows", async () => {
    const runtime = await createTestRuntime();
    await runtime.runtime.runChat(runtime.devUser, {
      message: "use tool with retained payload",
      requestedRetentionMode: "retained",
      enabledToolIds: ["mock.read_context"]
    });
    expect(runtime.db.snapshot().toolInvocations.some((invocation) => invocation.argsCiphertextNullable && invocation.resultCiphertextNullable)).toBe(true);

    const ephemeral = await createTestRuntime();
    await ephemeral.runtime.runChat(ephemeral.devUser, {
      message: "use tool with ephemeral payload",
      requestedRetentionMode: "ephemeral",
      enabledToolIds: ["mock.read_context"]
    });
    expect(ephemeral.db.snapshot().toolInvocations.every((invocation) => invocation.argsCiphertextNullable == null && invocation.resultCiphertextNullable == null)).toBe(true);
  });

  it("runs a multi-step tool loop and feeds completed tool results back to the provider", async () => {
    const runtime = await createTestRuntime();
    const result = await runtime.runtime.runChat(runtime.devUser, {
      message: "use tool context for this request",
      requestedRetentionMode: "retained",
      enabledToolIds: ["mock.read_context"]
    });

    expect(result.events.some((event) => event.type === "tool_call_requested" && event.toolCall.iteration === 0)).toBe(true);
    expect(result.events.some((event) => event.type === "tool_call_completed" && event.toolResult.status === "completed")).toBe(true);
    expect(result.events.some((event) => event.type === "message_delta" && event.iteration === 1)).toBe(true);
    const messages = await runtime.db.listMessages(runtime.tenant.id, result.conversation?.id ?? "");
    expect(messages.at(-1)?.content).toContain("Tool results:");
  });

  it("stops safely when a tool requires confirmation or the tool loop limit is reached", async () => {
    const confirmationRuntime = await createTestRuntime();
    const confirmation = await confirmationRuntime.runtime.runChat(confirmationRuntime.devUser, {
      message: "use tool for a high risk action",
      requestedRetentionMode: "retained",
      enabledToolIds: ["mock.dangerous_action"]
    });
    expect(confirmation.events.some((event) => event.type === "tool_call_completed" && event.toolResult.status === "requires_confirmation")).toBe(true);
    expect(confirmation.events.some((event) => event.type === "message_delta" && event.iteration === 1)).toBe(false);

    const limitedRuntime = await createTestRuntime("single_company", { AGENT_MAX_TOOL_ITERATIONS: "0" });
    const limited = await limitedRuntime.runtime.runChat(limitedRuntime.devUser, {
      message: "use tool but stop immediately",
      requestedRetentionMode: "retained",
      enabledToolIds: ["mock.read_context"]
    });
    expect(limited.events.some((event) => event.type === "error" && event.error.code === "TOOL_ITERATION_LIMIT")).toBe(true);
    expect(limitedRuntime.db.snapshot().toolInvocations).toHaveLength(0);
  });

  it("applies tenant platform policy bundles without registering executable tools", async () => {
    const runtime = await createTestRuntime();
    const secret = uniqueSentinel("PLATFORM_PLUGIN_CONFIG");
    await runtime.db.createPlatformPluginInstallation({
      tenantId: runtime.tenant.id,
      scopeType: "tenant",
      scopeId: runtime.tenant.id,
      pluginId: "deny-context-tool",
      manifestJson: {
        id: "deny-context-tool",
        name: "Deny Context Tool",
        version: "0.1.0",
        kind: "policy_bundle",
        policyBundle: {
          deniedToolIds: ["mock.read_context"]
        }
      },
      enabled: true,
      installedBy: runtime.devUser.id,
      approvedBy: runtime.devUser.id,
      config: secret
    });
    await runtime.refreshAdminState();

    const policy = compileEffectivePolicy(
      {
        deploymentMode: runtime.config.deploymentMode,
        tenantId: runtime.tenant.id,
        userId: runtime.devUser.id,
        groupIds: [],
        requestedToolIds: ["mock.read_context"]
      },
      runtime.policyDocuments,
      runtime.inventory
    );

    expect(policy.enabledToolIds).not.toContain("mock.read_context");
    expect(policy.reasons.some((reason) => reason.code === "TOOL_DENY_OVERRIDE")).toBe(true);
    expect(runtime.db.rawSearch(secret)).toBe(false);
  });

  it("registers tenant-installed stdio MCP tools and executes them through permission policy", async () => {
    const runtime = await createTestRuntime();
    const script = `payload=$(cat)
case "$payload" in
  *tools/list*) printf '%s' '{"tools":[{"id":"stdio.echo","name":"Echo","description":"Echo","riskLevel":"low"}]}' ;;
  *) printf '%s' '{"result":{"echoed":true}}' ;;
esac`;
    const server = await runtime.db.createMcpServer({
      name: "Echo stdio",
      description: "Tenant-installed stdio MCP test server",
      transportType: "stdio",
      serverUrl: null,
      containerImage: null,
      command: "/bin/sh",
      argsJson: ["-c", script],
      envSecretRefsJson: ["env://STDIO_ECHO_TOKEN"],
      riskLevel: "low",
      retentionPolicyClass: "metadata_only_required",
      enabled: true
    });
    await runtime.db.createPluginInstallation({
      tenantId: runtime.tenant.id,
      scopeType: "tenant",
      scopeId: runtime.tenant.id,
      mcpServerId: server.id,
      enabled: true,
      installedBy: runtime.devUser.id,
      approvedBy: runtime.devUser.id,
      config: null
    });
    await runtime.db.createToolPermission({
      tenantId: runtime.tenant.id,
      toolId: "stdio.echo",
      subjectType: "tenant",
      subjectId: runtime.tenant.id,
      permission: "use",
      requiresConfirmation: false
    });
    await runtime.refreshAdminState();

    expect(runtime.inventory.toolIds).toContain("stdio.echo");
    const result = await runtime.runtime.runChat(runtime.devUser, {
      message: "use tool through stdio",
      requestedRetentionMode: "retained",
      enabledToolIds: ["stdio.echo"]
    });
    expect(result.events.some((event) => event.type === "tool_call_completed" && event.toolResult.toolId === "stdio.echo" && event.toolResult.status === "completed")).toBe(true);
  });

  it("writes metadata-only audit events for ephemeral requests", async () => {
    const runtime = await createTestRuntime();
    await runtime.db.createAudit({
      tenantId: runtime.tenant.id,
      userId: runtime.devUser.id,
      type: "auth.login",
      metadata: { provider: "dev" },
      content: { message: "sensitive" },
      retention: buildRetentionContext("ephemeral")
    });

    const event = runtime.db.snapshot().auditEvents.at(-1);
    expect(event?.content).toBeNull();
    expect(event?.auditContentMode).toBe("metadata_only");
  });
});
