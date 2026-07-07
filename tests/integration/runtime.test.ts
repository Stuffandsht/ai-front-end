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

    expect(runtime.db.rawSearch(credential)).toBe(false);
    expect(runtime.db.rawSearch(prompt)).toBe(false);
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
