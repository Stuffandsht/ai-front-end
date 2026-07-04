import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { EnvelopeContentCrypto, LocalKmsProvider } from "@agent-platform/crypto";
import { SqlEncryptionKeyStore, SqlRuntimeDatabase } from "@agent-platform/db";
import { createMockTools, McpGateway } from "@agent-platform/mcp-gateway";
import type { PolicyDocuments, ProviderInventory } from "@agent-platform/policy";
import { MockProvider, ProviderGateway } from "@agent-platform/providers";
import { ChatRuntime, type RuntimeServices } from "@agent-platform/runtime";
import { testConfig, uniqueSentinel } from "@agent-platform/test-utils";

describe("sql-backed chat runtime", () => {
  it("persists retained chat content encrypted in SQL and reloads through repository services", async () => {
    const services = await createSqlRuntimeServices();
    const sentinel = uniqueSentinel("SQL_RETAINED_SECRET");
    const result = await services.runtime.runChat(services.user, {
      message: sentinel,
      requestedRetentionMode: "retained"
    });

    expect(result.conversation?.id).toBeTruthy();
    expect(await services.repo.rawSearch(sentinel)).toBe(false);
    const messages = await services.repo.listMessages(services.tenant.id, result.conversation?.id ?? "");
    expect(messages.some((message) => message.content.includes(sentinel))).toBe(true);

    const rawMessages = await services.sql.query("select * from messages");
    expect(rawMessages.rows).toHaveLength(2);
    expect(JSON.stringify(rawMessages.rows)).not.toContain(sentinel);
  });

  it("runs ephemeral chat through SQL without persisted content", async () => {
    const services = await createSqlRuntimeServices();
    const sentinel = uniqueSentinel();
    const result = await services.runtime.runChat(services.user, {
      message: `${sentinel} use tool`,
      requestedRetentionMode: "ephemeral",
      enabledToolIds: ["mock.read_context"]
    });

    expect(result.conversation).toBeNull();
    expect(await services.repo.rawSearch(sentinel)).toBe(false);

    const messages = await services.sql.query("select * from messages");
    const conversations = await services.sql.query("select * from conversations");
    const toolInvocations = await services.sql.query<{ args_ciphertext_nullable: unknown; result_ciphertext_nullable: unknown }>("select * from tool_invocations");
    const auditEvents = await services.sql.query<{ audit_content_mode: string; content_json: unknown }>("select * from audit_events where retention_mode = 'ephemeral'");

    expect(messages.rows).toHaveLength(0);
    expect(conversations.rows).toHaveLength(0);
    expect(toolInvocations.rows.every((row) => row.args_ciphertext_nullable == null && row.result_ciphertext_nullable == null)).toBe(true);
    expect(auditEvents.rows.some((row) => row.audit_content_mode === "metadata_only" && row.content_json == null)).toBe(true);
  });
});

async function createSqlRuntimeServices() {
  const sql = new PGlite();
  await sql.exec(await readFile("db/migrations/0001_initial.sql", "utf8"));

  const keyStore = new SqlEncryptionKeyStore(sql);
  const crypto = new EnvelopeContentCrypto(new LocalKmsProvider("sql-runtime-master-key"), keyStore);
  const repo = new SqlRuntimeDatabase(sql, crypto);
  const config = testConfig({ APP_DEPLOYMENT_MODE: "single_company" });
  const tenant = await repo.createTenantDirect({
    slug: config.singleCompany.tenantSlug,
    name: config.singleCompany.tenantName,
    primaryDomain: config.singleCompany.primaryDomain ?? null,
    allowedHostnames: config.singleCompany.primaryDomain ? [config.singleCompany.primaryDomain] : []
  });
  const user = await repo.upsertUser({
    email: config.devAuth.email,
    displayName: config.devAuth.displayName
  });
  await repo.upsertMembership({
    tenantId: tenant.id,
    userId: user.id,
    role: "company_admin"
  });

  const provider = await repo.createProviderConfig({
    tenantId: tenant.id,
    scopeType: "tenant",
    scopeId: tenant.id,
    providerType: "mock",
    displayName: "Mock Provider",
    baseUrl: null,
    authMode: "none",
    credentialRef: null,
    retentionPolicyClass: "standard",
    supportsStreaming: true,
    supportsToolCalling: true,
    supportsJsonSchema: true,
    supportsEmbeddings: false,
    enabled: true
  });
  await repo.createModelConfig({
    tenantId: tenant.id,
    providerConfigId: provider.id,
    modelKey: "mock-chat",
    displayName: "Mock Chat",
    contextWindow: 8192,
    maxOutputTokens: 1024,
    supportsTools: true,
    supportsStreaming: true,
    supportsJsonSchema: true,
    inputModalitiesJson: ["text"],
    outputModalitiesJson: ["text"],
    enabled: true
  });

  const companyPrompt = await repo.createPromptFragment({
    tenantId: tenant.id,
    scopeType: "tenant",
    scopeId: tenant.id,
    name: "Company Prompt",
    content: "Answer as the SQL-backed company assistant.",
    priority: 100,
    createdBy: user.id
  });
  const userPrompt = await repo.createPromptFragment({
    tenantId: tenant.id,
    scopeType: "user",
    scopeId: user.id,
    name: "User Preference",
    content: "Use direct language.",
    priority: 20,
    createdBy: user.id
  });

  await repo.createToolPermission({
    tenantId: tenant.id,
    toolId: "mock.read_context",
    subjectType: "tenant",
    subjectId: tenant.id,
    permission: "use",
    requiresConfirmation: false
  });

  const providers = new ProviderGateway();
  providers.register(new MockProvider());
  const mcp = new McpGateway(repo);
  for (const tool of createMockTools()) {
    mcp.registerTool(tool);
  }

  const inventory: ProviderInventory = {
    providers: [{ id: "mock", modelIds: ["mock-chat"], enabled: true }],
    toolIds: ["mock.read_context", "mock.dangerous_action"]
  };
  const policyDocuments: PolicyDocuments = {
    platform: {
      allowedProviderIds: ["mock"],
      defaultProviderId: "mock",
      allowedModelIds: ["mock-chat"],
      defaultModelId: "mock-chat",
      allowedToolIds: ["mock.read_context", "mock.dangerous_action"],
      enabledToolIds: ["mock.read_context"],
      userByoProviderAllowed: false,
      defaultRetentionMode: "retained"
    },
    tenant: {
      allowedProviderIds: ["mock"],
      defaultProviderId: "mock",
      allowedModelIds: ["mock-chat"],
      defaultModelId: "mock-chat",
      allowedToolIds: ["mock.read_context", "mock.dangerous_action"],
      enabledToolIds: ["mock.read_context"],
      userByoProviderAllowed: false,
      promptFragments: [
        { id: companyPrompt.id, priority: companyPrompt.priority },
        { id: userPrompt.id, priority: userPrompt.priority }
      ]
    }
  };
  const runtimeServices: RuntimeServices<SqlRuntimeDatabase> = {
    config,
    db: repo,
    providers,
    mcp,
    inventory,
    policyDocuments
  };
  const runtime = new ChatRuntime(runtimeServices);

  return {
    sql,
    repo,
    runtime,
    tenant,
    user
  };
}
