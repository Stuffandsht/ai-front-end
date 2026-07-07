import type { AppConfig } from "@agent-platform/config";
import { createLocalContentCrypto, EnvelopeContentCrypto, LocalKmsProvider, VaultTransitKmsProvider, type KmsProvider } from "@agent-platform/crypto";
import {
  InMemoryDatabase,
  PgSqlExecutor,
  SqlEncryptionKeyStore,
  SqlRuntimeDatabase,
  type Conversation,
  type PlatformPluginInstallation,
  type PromptFragment,
  type Tenant,
  type TenantMembership,
  type User
} from "@agent-platform/db";
import { createMockTools, HttpMcpTransportAdapter, McpGateway, StdioMcpTransportAdapter, type ToolDefinition, type ToolExecutionResult } from "@agent-platform/mcp-gateway";
import {
  compileEffectivePolicy,
  summarizePolicy,
  type EffectivePolicy,
  type PolicyDocuments,
  type PolicyInput,
  type PolicyScopeConfig,
  type ProviderInventory
} from "@agent-platform/policy";
import { compilePromptStack, loadPromptFragmentSources, renderCompiledPrompt, type CompiledPrompt } from "@agent-platform/prompts";
import { MockProvider, OpenAICompatibleProvider, OpenRouterProvider, ProviderGateway, type ChatCompletionResult, type ChatMessage, type ToolCallRequest } from "@agent-platform/providers";
import { buildRetentionContext, type RetentionMode } from "@agent-platform/retention";

type MaybePromise<T> = T | Promise<T>;

export type ChatRequest = {
  tenantSlugOrHost?: string;
  conversationId?: string;
  message: string;
  requestedProviderId?: string;
  requestedModelId?: string;
  requestedRetentionMode?: RetentionMode;
  enabledToolIds?: string[];
  confirmedToolIds?: string[];
};

export type SafePolicySummary = ReturnType<typeof summarizePolicy>;

export type SafeToolCallSummary = {
  id: string;
  toolId: string;
  argsPreview: Record<string, unknown>;
  requiresConfirmation: boolean;
  iteration: number;
};

export type SafeToolResultSummary = {
  toolCallId: string;
  toolId: string;
  status: ToolExecutionResult["status"];
  metadata: Record<string, unknown>;
  resultPreview?: Record<string, unknown>;
  iteration: number;
};

export type SafeError = {
  code: string;
  message: string;
};

export type ChatStreamEvent =
  | { type: "policy"; policySummary: SafePolicySummary }
  | { type: "message_delta"; delta: string; iteration: number }
  | { type: "tool_call_requested"; toolCall: SafeToolCallSummary }
  | { type: "tool_call_completed"; toolResult: SafeToolResultSummary }
  | { type: "message_done"; messageId?: string }
  | { type: "error"; error: SafeError };

export type ChatRunResult = {
  requestId: string;
  tenant: Tenant;
  user: User;
  policy: EffectivePolicy;
  compiledPrompt: CompiledPrompt;
  conversation: Conversation | null;
  events: ChatStreamEvent[];
};

export type RuntimeServices<TDb extends RuntimeDatabase = RuntimeDatabase> = {
  config: AppConfig;
  db: TDb;
  providers: ProviderGateway;
  mcp: McpGateway;
  inventory: ProviderInventory;
  policyDocuments: PolicyDocuments;
};

export type RuntimeBundle<TDb extends RuntimeDatabase = RuntimeDatabase> = RuntimeServices<TDb> & {
  runtime: ChatRuntime;
  devUser: User;
  tenant: Tenant;
  refreshAdminState(): Promise<void>;
};

export type RuntimeDatabase = {
  findTenantBySlugOrHost(slugOrHost: string | undefined): MaybePromise<Tenant | null>;
  getMembership(tenantId: string, userId: string): MaybePromise<TenantMembership | null>;
  createConversation(input: Parameters<InMemoryDatabase["createConversation"]>[0]): ReturnType<InMemoryDatabase["createConversation"]>;
  createMessageFromRequest(input: Parameters<InMemoryDatabase["createMessageFromRequest"]>[0]): ReturnType<InMemoryDatabase["createMessageFromRequest"]>;
  createAudit(input: Parameters<InMemoryDatabase["createAudit"]>[0]): ReturnType<InMemoryDatabase["createAudit"]>;
  createPolicySnapshot(input: Parameters<InMemoryDatabase["createPolicySnapshot"]>[0]): MaybePromise<unknown>;
  createPromptCompilation(input: Parameters<InMemoryDatabase["createPromptCompilation"]>[0]): ReturnType<InMemoryDatabase["createPromptCompilation"]>;
  getPromptFragments(ids: string[]): MaybePromise<PromptFragment[]>;
  readPromptFragmentContent(fragment: PromptFragment): Promise<string>;
  listConversations(tenantId: string, userId: string): MaybePromise<Conversation[]>;
};

type AdminStateDatabase = (InMemoryDatabase | SqlRuntimeDatabase) & {
  snapshot(): MaybePromise<{
    providerConfigs: Array<{
      id: string;
      tenantId: string;
      scopeType: "service" | "tenant" | "user";
      scopeId: string;
      providerType: string;
      baseUrl: string | null;
      authMode: string;
      credentialRef: string | null;
      enabled: boolean;
      deletedAt: Date | null;
    }>;
    modelConfigs: Array<{
      providerConfigId: string;
      modelKey: string;
      enabled: boolean;
      deletedAt: Date | null;
    }>;
    promptFragments: Array<{
      id: string;
      tenantId: string;
      scopeType: string;
      scopeId: string;
      priority: number;
      enabled: boolean;
      deletedAt: Date | null;
    }>;
    retentionPolicies: Array<{
      tenantId: string;
      subjectType: "tenant" | "group" | "user";
      subjectId: string;
      defaultRetentionMode: RetentionMode;
      mandatoryRetentionMode: RetentionMode | null;
      deletedAt: Date | null;
    }>;
    mcpServers: Array<{
      id: string;
      name: string;
      description: string;
      transportType: "mock" | "http" | "stdio";
      serverUrl: string | null;
      command: string | null;
      argsJson: string[];
      envSecretRefsJson: string[];
      riskLevel: "low" | "medium" | "high";
      retentionPolicyClass: "standard" | "metadata_only_required";
      enabled: boolean;
    }>;
    pluginInstallations: Array<{
      scopeType: "service" | "tenant" | "user";
      scopeId: string;
      mcpServerId: string;
      enabled: boolean;
      deletedAt: Date | null;
    }>;
    platformPluginInstallations: PlatformPluginInstallation[];
  }>;
  getProviderCredentialSecret(input: { tenantId: string; providerConfigId: string; userId?: string | null; credentialRef?: string | null }): MaybePromise<string | null>;
};

export class ChatRuntime {
  constructor(private readonly services: RuntimeServices) {}

  async runChat(user: User, request: ChatRequest): Promise<ChatRunResult> {
    const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await this.resolveTenant(request.tenantSlugOrHost);
    const membership = await this.services.db.getMembership(tenant.id, user.id);
    if (!membership) {
      throw new Error("User is not a member of the resolved tenant");
    }

    const policyInput: PolicyInput = {
      deploymentMode: this.services.config.deploymentMode,
      tenantId: tenant.id,
      userId: user.id,
      groupIds: membership.externalGroupsJson,
      ...(request.conversationId ? { conversationId: request.conversationId } : {}),
      ...(request.requestedProviderId ? { requestedProviderId: request.requestedProviderId } : {}),
      ...(request.requestedModelId ? { requestedModelId: request.requestedModelId } : {}),
      ...(request.requestedRetentionMode ? { requestedRetentionMode: request.requestedRetentionMode } : {}),
      requestedToolIds: request.enabledToolIds ?? []
    };
    const policy = compileEffectivePolicy(policyInput, this.services.policyDocuments, this.services.inventory);
    const retention = buildRetentionContext(policy.retentionMode);
    const conversation = await this.services.db.createConversation({
      tenantId: tenant.id,
      userId: user.id,
      title: `Chat ${new Date().toISOString()}`,
      retention
    });
    const conversationId = request.conversationId ?? conversation?.id ?? null;

    await this.services.db.createAudit({
      tenantId: tenant.id,
      userId: user.id,
      type: "retention.selected",
      requestId,
      metadata: {
        retentionMode: retention.mode,
        canStoreContent: retention.canStoreContent
      },
      retention
    });

    await this.services.db.createPolicySnapshot({
      tenantId: tenant.id,
      userId: user.id,
      conversationId,
      policyHash: policy.id,
      selectedProviderId: policy.selectedProviderId,
      selectedModelId: policy.selectedModelId,
      retentionMode: policy.retentionMode,
      reasonsJson: policy.reasons
    });

    await this.services.db.createAudit({
      tenantId: tenant.id,
      userId: user.id,
      type: "policy.evaluated",
      requestId,
      metadata: {
        policyId: policy.id,
        selectedProviderId: policy.selectedProviderId,
        selectedModelId: policy.selectedModelId,
        deniedReasons: policy.reasons.filter((reason) => reason.severity === "deny").map((reason) => reason.code)
      },
      retention
    });

    if (conversationId) {
      await this.services.db.createMessageFromRequest({
        tenantId: tenant.id,
        conversationId,
        userId: user.id,
        role: "user",
        content: request.message,
        retention
      });
    }

    const compiledPrompt = await this.compilePrompt(policy, retention, tenant.id, conversationId);
    const messages = this.messagesForProvider(compiledPrompt, request.message);
    const enabledTools = this.services.mcp
      .listTools()
      .filter((tool) => policy.enabledToolIds.includes(tool.id))
      .map((tool) => ({
        id: tool.id,
        description: tool.description
      }));

    const events: ChatStreamEvent[] = [
      {
        type: "policy",
        policySummary: summarizePolicy(policy)
      }
    ];
    let finalResult: ChatCompletionResult | null = null;
    let totalToolCallCount = 0;

    for (let iteration = 0; iteration <= this.services.config.maxToolIterations; iteration += 1) {
      let roundResult: ChatCompletionResult | null = null;
      const roundToolCalls: ToolCallRequest[] = [];

      try {
        for await (const event of this.services.providers.streamChat(policy, {
          requestId,
          tenantId: tenant.id,
          userId: user.id,
          messages,
          tools: enabledTools,
          retention
        })) {
          if (event.type === "delta") {
            events.push({
              type: "message_delta",
              delta: event.delta,
              iteration
            });
          }
          if (event.type === "tool_call") {
            roundToolCalls.push(event.toolCall);
          }
          if (event.type === "done") {
            roundResult = event.result;
          }
        }
      } catch (error) {
        events.push({
          type: "error",
          error: {
            code: "PROVIDER_ERROR",
            message: error instanceof Error ? error.message : "Provider error"
          }
        });
        break;
      }

      if (!roundResult) {
        break;
      }
      finalResult = roundResult;

      const toolCalls = roundToolCalls.length > 0 ? roundToolCalls : roundResult.toolCalls;
      if (toolCalls.length === 0) {
        break;
      }

      if (iteration >= this.services.config.maxToolIterations) {
        events.push({
          type: "error",
          error: {
            code: "TOOL_ITERATION_LIMIT",
            message: `Stopped after ${this.services.config.maxToolIterations} tool execution rounds.`
          }
        });
        await this.services.db.createAudit({
          tenantId: tenant.id,
          userId: user.id,
          type: "agent.limit_reached",
          requestId,
          metadata: {
            maxToolIterations: this.services.config.maxToolIterations,
            pendingToolCount: toolCalls.length
          },
          retention
        });
        break;
      }

      const completedToolResults: Array<{ toolCall: ToolCallRequest; result: Record<string, unknown> }> = [];
      let stopAfterTools = false;

      for (const toolCall of toolCalls) {
        const confirmed = request.confirmedToolIds?.includes(toolCall.toolId) ?? false;
        const registeredTool = this.services.mcp.listTools().find((tool) => tool.id === toolCall.toolId);
        events.push({
          type: "tool_call_requested",
          toolCall: {
            id: toolCall.id,
            toolId: toolCall.toolId,
            argsPreview: retention.canStoreToolPayloads ? toolCall.args : { redacted: true },
            requiresConfirmation: Boolean(registeredTool?.requiresConfirmation && !confirmed),
            iteration
          }
        });
        const toolResult = await this.services.mcp.executeTool({
          tenantId: tenant.id,
          userId: user.id,
          conversationId,
          requestId,
          toolId: toolCall.toolId,
          args: toolCall.args,
          confirmed,
          policy,
          retention
        });
        totalToolCallCount += 1;
        await this.services.db.createAudit({
          tenantId: tenant.id,
          userId: user.id,
          type: auditTypeForToolResult(toolResult.status),
          requestId,
          metadata: {
            toolCallId: toolCall.id,
            toolId: toolCall.toolId,
            status: toolResult.status,
            iteration
          },
          retention
        });
        events.push({
          type: "tool_call_completed",
          toolResult: {
            toolCallId: toolCall.id,
            toolId: toolCall.toolId,
            status: toolResult.status,
            metadata: toolResult.status === "completed" ? { resultKeys: Object.keys(toolResult.result) } : { reason: toolResult.reason },
            ...(toolResult.status === "completed" ? { resultPreview: retention.canStoreToolPayloads ? toolResult.result : { redacted: true } } : {}),
            iteration
          }
        });

        if (toolResult.status === "completed") {
          completedToolResults.push({ toolCall, result: toolResult.result });
        } else {
          stopAfterTools = true;
        }
      }

      if (stopAfterTools) {
        break;
      }

      messages.push({
        role: "assistant",
        content: roundResult.content,
        toolCalls
      });
      for (const completed of completedToolResults) {
        messages.push({
          role: "tool",
          toolCallId: completed.toolCall.id,
          content: JSON.stringify(completed.result)
        });
      }
    }

    let assistantMessageId: string | undefined;
    if (conversationId && finalResult) {
      const assistantMessage = await this.services.db.createMessageFromRequest({
        tenantId: tenant.id,
        conversationId,
        userId: user.id,
        role: "assistant",
        content: finalResult.content,
        retention
      });
      assistantMessageId = assistantMessage?.id;
    }

    const chatAudit = {
      tenantId: tenant.id,
      userId: user.id,
      type: "chat.completed",
      requestId,
      metadata: {
        providerId: policy.selectedProviderId,
        modelId: policy.selectedModelId,
        tokenCounts: finalResult?.usage ?? null,
        toolCount: totalToolCallCount,
        retentionMode: policy.retentionMode
      },
      retention
    } as const;
    await this.services.db.createAudit(chatAudit);

    events.push({
      type: "message_done",
      ...(assistantMessageId ? { messageId: assistantMessageId } : {})
    });

    return {
      requestId,
      tenant,
      user,
      policy,
      compiledPrompt,
      conversation,
      events
    };
  }

  async getConversations(user: User, tenantSlugOrHost?: string): Promise<Conversation[]> {
    const tenant = await this.resolveTenant(tenantSlugOrHost);
    return this.services.db.listConversations(tenant.id, user.id);
  }

  private async resolveTenant(tenantSlugOrHost: string | undefined): Promise<Tenant> {
    const tenant = await this.services.db.findTenantBySlugOrHost(tenantSlugOrHost);
    if (!tenant) {
      throw new Error("Tenant could not be resolved");
    }
    if (this.services.config.deploymentMode === "single_company" && this.services.config.singleCompany.primaryDomain) {
      const host = tenantSlugOrHost;
      if (host && host.includes(".") && !tenant.allowedHostnames.includes(host) && host !== tenant.primaryDomain) {
        throw new Error("Host is not allowed for single-company mode");
      }
    }
    return tenant;
  }

  private async compilePrompt(policy: EffectivePolicy, retention: ReturnType<typeof buildRetentionContext>, tenantId: string, conversationId: string | null): Promise<CompiledPrompt> {
    const fragments = await this.services.db.getPromptFragments(policy.promptFragmentIds);
    const sources = await loadPromptFragmentSources(fragments, (fragment) => this.services.db.readPromptFragmentContent(fragment));
    const compiled = compilePromptStack(sources);
    await this.services.db.createPromptCompilation({
      tenantId,
      conversationId,
      fragmentIds: compiled.fragmentIds,
      fragmentVersions: compiled.fragmentVersions,
      compiledHash: compiled.compiledHash,
      compiledPromptContent: renderCompiledPrompt(compiled),
      retention
    });
    await this.services.db.createAudit({
      tenantId,
      userId: policy.userId,
      type: "prompt.compiled",
      metadata: {
        fragmentIds: compiled.fragmentIds,
        compiledHash: compiled.compiledHash
      },
      retention
    });
    return compiled;
  }

  private messagesForProvider(prompt: CompiledPrompt, userMessage: string): ChatMessage[] {
    return [
      ...prompt.systemMessages.map((message) => ({
        role: "system" as const,
        name: message.name,
        content: message.content
      })),
      {
        role: "user" as const,
        content: userMessage
      }
    ];
  }
}

export async function createLocalRuntime(config: AppConfig): Promise<RuntimeBundle<InMemoryDatabase>> {
  const localCrypto = createLocalContentCrypto(config.kms.localMasterKeyBase64);
  const db = new InMemoryDatabase(localCrypto.crypto, () => localCrypto.keyStore.snapshot());
  const tenant = await db.seedForConfig(config);
  const devUser = await db.upsertUser({
    email: config.devAuth.email,
    displayName: config.devAuth.displayName
  });
  await db.upsertMembership({
    tenantId: tenant.id,
    userId: devUser.id,
    role: config.deploymentMode === "single_company" && config.devAuth.role === "service_admin" ? "company_admin" : config.devAuth.role
  });
  await ensureConfiguredIdentityProvider(db, config, tenant);

  const mockProvider = await db.createProviderConfig({
    tenantId: tenant.id,
    scopeType: config.deploymentMode === "single_company" ? "tenant" : "service",
    scopeId: config.deploymentMode === "single_company" ? tenant.id : "service-default",
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
  await db.createModelConfig({
    tenantId: tenant.id,
    providerConfigId: mockProvider.id,
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
  await db.createModelConfig({
    tenantId: tenant.id,
    providerConfigId: mockProvider.id,
    modelKey: "mock-chat-fast",
    displayName: "Mock Chat Fast",
    contextWindow: 4096,
    maxOutputTokens: 512,
    supportsTools: true,
    supportsStreaming: true,
    supportsJsonSchema: false,
    inputModalitiesJson: ["text"],
    outputModalitiesJson: ["text"],
    enabled: true
  });

  await db.createPromptFragment({
    tenantId: tenant.id,
    scopeType: "tenant",
    scopeId: tenant.id,
    name: config.deploymentMode === "single_company" ? "Company Prompt" : "Tenant Prompt",
    content: "Answer as the governed internal AI assistant. Enforce policy outside the model.",
    priority: 100,
    createdBy: devUser.id
  });
  await db.createPromptFragment({
    tenantId: tenant.id,
    scopeType: "user",
    scopeId: devUser.id,
    name: "User Preference",
    content: "Prefer concise, actionable responses.",
    priority: 20,
    createdBy: devUser.id
  });

  await db.createToolPermission({
    tenantId: tenant.id,
    toolId: "mock.read_context",
    subjectType: "tenant",
    subjectId: tenant.id,
    permission: "use",
    requiresConfirmation: false
  });
  await db.createToolPermission({
    tenantId: tenant.id,
    toolId: "mock.dangerous_action",
    subjectType: "tenant",
    subjectId: tenant.id,
    permission: "use",
    requiresConfirmation: true
  });

  return createRuntimeBundle(config, db, tenant, devUser);
}

export async function createRuntime(config: AppConfig): Promise<RuntimeBundle<InMemoryDatabase> | RuntimeBundle<SqlRuntimeDatabase>> {
  return config.databaseMode === "postgres" ? createPostgresRuntime(config) : createLocalRuntime(config);
}

export async function createPostgresRuntime(config: AppConfig): Promise<RuntimeBundle<SqlRuntimeDatabase>> {
  const sql = new PgSqlExecutor(config.databaseUrl);
  const keyStore = new SqlEncryptionKeyStore(sql);
  const crypto = new EnvelopeContentCrypto(createKmsProvider(config), keyStore);
  const db = new SqlRuntimeDatabase(sql, crypto);
  const tenant = await db.seedForConfig(config);
  const devUser = await db.upsertUser({
    email: config.devAuth.email,
    displayName: config.devAuth.displayName
  });
  await db.upsertMembership({
    tenantId: tenant.id,
    userId: devUser.id,
    role: config.deploymentMode === "single_company" && config.devAuth.role === "service_admin" ? "company_admin" : config.devAuth.role
  });
  await ensureConfiguredIdentityProvider(db, config, tenant);

  const mockProvider = await db.createProviderConfig({
    tenantId: tenant.id,
    scopeType: config.deploymentMode === "single_company" ? "tenant" : "service",
    scopeId: config.deploymentMode === "single_company" ? tenant.id : "service-default",
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
  await db.createModelConfig({
    tenantId: tenant.id,
    providerConfigId: mockProvider.id,
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
  await db.createModelConfig({
    tenantId: tenant.id,
    providerConfigId: mockProvider.id,
    modelKey: "mock-chat-fast",
    displayName: "Mock Chat Fast",
    contextWindow: 4096,
    maxOutputTokens: 512,
    supportsTools: true,
    supportsStreaming: true,
    supportsJsonSchema: false,
    inputModalitiesJson: ["text"],
    outputModalitiesJson: ["text"],
    enabled: true
  });

  await ensureSqlPromptFragment(db, {
    tenantId: tenant.id,
    scopeType: "tenant",
    scopeId: tenant.id,
    name: config.deploymentMode === "single_company" ? "Company Prompt" : "Tenant Prompt",
    content: "Answer as the governed internal AI assistant. Enforce policy outside the model.",
    priority: 100,
    createdBy: devUser.id
  });
  await ensureSqlPromptFragment(db, {
    tenantId: tenant.id,
    scopeType: "user",
    scopeId: devUser.id,
    name: "User Preference",
    content: "Prefer concise, actionable responses.",
    priority: 20,
    createdBy: devUser.id
  });

  await ensureSqlToolPermission(db, {
    tenantId: tenant.id,
    toolId: "mock.read_context",
    subjectType: "tenant",
    subjectId: tenant.id,
    permission: "use",
    requiresConfirmation: false
  });
  await ensureSqlToolPermission(db, {
    tenantId: tenant.id,
    toolId: "mock.dangerous_action",
    subjectType: "tenant",
    subjectId: tenant.id,
    permission: "use",
    requiresConfirmation: true
  });

  return createRuntimeBundle(config, db, tenant, devUser);
}

async function ensureConfiguredIdentityProvider(db: InMemoryDatabase | SqlRuntimeDatabase, config: AppConfig, tenant: Tenant): Promise<void> {
  if (!config.oidc) {
    return;
  }
  const existing = (await db.snapshot()).identityProviders.find(
    (provider) =>
      provider.tenantId === tenant.id &&
      provider.issuerUrl === config.oidc?.issuerUrl &&
      provider.clientId === config.oidc?.clientId &&
      provider.deletedAt == null
  );
  if (existing) {
    await db.updateIdentityProvider(existing.id, {
      clientSecretRef: config.oidc.clientSecretRef,
      allowedEmailDomains: config.oidc.allowedEmailDomains,
      claimMappingJson: config.oidc.claimMappingJson,
      enabled: config.oidc.enabled
    });
    return;
  }
  await db.createIdentityProvider({
    tenantId: tenant.id,
    providerType: config.oidc.providerType,
    issuerUrl: config.oidc.issuerUrl,
    clientId: config.oidc.clientId,
    clientSecretRef: config.oidc.clientSecretRef,
    allowedEmailDomains: config.oidc.allowedEmailDomains,
    claimMappingJson: config.oidc.claimMappingJson,
    enabled: config.oidc.enabled
  });
}

async function createRuntimeBundle<TDb extends InMemoryDatabase | SqlRuntimeDatabase>(
  config: AppConfig,
  db: TDb,
  tenant: Tenant,
  devUser: User
): Promise<RuntimeBundle<TDb>> {
  const services: RuntimeServices<TDb> = {
    config,
    db,
    providers: new ProviderGateway(),
    mcp: new McpGateway(db),
    inventory: { providers: [], toolIds: [] },
    policyDocuments: {}
  };
  const runtime = new ChatRuntime(services);
  const bundle: RuntimeBundle<TDb> = {
    ...services,
    runtime,
    devUser,
    tenant,
    refreshAdminState: async () => {
      const adminState = await buildAdminState(config, db, tenant);
      services.providers = adminState.providers;
      services.mcp = adminState.mcp;
      services.inventory = adminState.inventory;
      services.policyDocuments = adminState.policyDocuments;
      bundle.providers = adminState.providers;
      bundle.mcp = adminState.mcp;
      bundle.inventory = adminState.inventory;
      bundle.policyDocuments = adminState.policyDocuments;
    }
  };
  await bundle.refreshAdminState();
  return bundle;
}

async function buildAdminState(config: AppConfig, db: AdminStateDatabase, tenant: Tenant): Promise<Pick<RuntimeServices, "providers" | "mcp" | "inventory" | "policyDocuments">> {
  const snapshot = await db.snapshot();
  const providers = new ProviderGateway();
  const mcp = new McpGateway(db);
  const mockTools = createMockTools();
  for (const tool of mockTools) {
    mcp.registerTool(tool);
  }
  const externalTools = await registerExternalMcpTools(mcp, snapshot.mcpServers, snapshot.pluginInstallations, tenant.id);
  const toolIds = unique([...mockTools.map((tool) => tool.id), ...externalTools.map((tool) => tool.id)]);

  const activeProviderConfigs = snapshot.providerConfigs.filter(
    (provider) =>
      provider.enabled &&
      provider.deletedAt == null &&
      provider.tenantId === tenant.id &&
      (provider.scopeType === "service" || provider.scopeId === tenant.id || provider.scopeType === "user")
  );
  const activeModels = snapshot.modelConfigs.filter((model) => model.enabled && model.deletedAt == null);
  const inventoryProviders = new Map<string, { id: string; modelIds: string[]; enabled: boolean; byo?: boolean }>();

  let mockRegistered = false;
  for (const providerConfig of activeProviderConfigs) {
    const providerId = providerRuntimeId(providerConfig);
    const modelIds = activeModels.filter((model) => model.providerConfigId === providerConfig.id).map((model) => model.modelKey);
    if (modelIds.length === 0) {
      continue;
    }

    if (providerConfig.providerType === "mock") {
      if (!mockRegistered) {
        providers.register(new MockProvider());
        mockRegistered = true;
      }
    } else if (providerConfig.providerType === "openai_compatible" || providerConfig.providerType === "openrouter") {
      if (providerConfig.authMode === "user_key") {
        continue;
      }
      const secret =
        providerConfig.authMode === "none"
          ? ""
          : await db.getProviderCredentialSecret({
              tenantId: providerConfig.tenantId,
              providerConfigId: providerConfig.id,
              credentialRef: providerConfig.credentialRef
            });
      if (!providerConfig.baseUrl || (providerConfig.authMode !== "none" && !secret)) {
        continue;
      }
      if (providerConfig.providerType === "openrouter") {
        providers.register(
          new OpenRouterProvider({
            id: providerId,
            baseUrl: providerConfig.baseUrl,
            apiKey: secret ?? "",
            appUrl: config.publicBaseUrl,
            appTitle: tenant.name
          })
        );
      } else {
        providers.register(new OpenAICompatibleProvider({ id: providerId, baseUrl: providerConfig.baseUrl, apiKey: secret ?? "" }));
      }
    } else {
      continue;
    }

    const current = inventoryProviders.get(providerId);
    const nextModelIds = unique([...(current?.modelIds ?? []), ...modelIds]);
    const nextProvider = {
      id: providerId,
      modelIds: nextModelIds,
      enabled: true,
      ...(providerConfig.scopeType === "user" ? { byo: true } : {})
    };
    inventoryProviders.set(providerId, nextProvider);
  }

  const providerInventory = [...inventoryProviders.values()];
  const providerIds = providerInventory.map((provider) => provider.id);
  const modelIds = unique(providerInventory.flatMap((provider) => provider.modelIds));
  const tenantPrompts = snapshot.promptFragments
    .filter((fragment) => fragment.tenantId === tenant.id && fragment.scopeType === "tenant" && fragment.scopeId === tenant.id && fragment.enabled && fragment.deletedAt == null)
    .map((fragment) => ({ id: fragment.id, priority: fragment.priority }));
  const userPrompts = snapshot.promptFragments
    .filter((fragment) => fragment.tenantId === tenant.id && fragment.scopeType === "user" && fragment.enabled && fragment.deletedAt == null)
    .map((fragment) => ({ id: fragment.id, priority: fragment.priority }));
  const retentionPolicy = snapshot.retentionPolicies.find(
    (policy) => policy.tenantId === tenant.id && policy.subjectType === "tenant" && policy.subjectId === tenant.id && policy.deletedAt == null
  );
  const platformPluginPolicy = platformPluginPolicyBundle(snapshot.platformPluginInstallations, tenant.id);
  const defaultRetentionMode = retentionPolicy?.defaultRetentionMode ?? config.singleCompany.defaultRetention;
  const defaultProviderId = chooseDefault(config.singleCompany.defaultProviderId, providerIds) ?? chooseDefault(config.defaultProviderId, providerIds) ?? "mock";
  const defaultModelId = chooseDefault(config.singleCompany.defaultModelId, modelIds) ?? chooseDefault(config.defaultModelId, modelIds) ?? "mock-chat";
  const enabledToolIds = unique([...(platformPluginPolicy.enabledToolIds ?? []), ...toolIds.filter((toolId) => toolId !== "mock.dangerous_action")]).filter((toolId) =>
    toolIds.includes(toolId)
  );
  const tenantAllowedToolIds = platformPluginPolicy.allowedToolIds ? platformPluginPolicy.allowedToolIds.filter((toolId) => toolIds.includes(toolId)) : toolIds;
  const tenantAllowedProviderIds = platformPluginPolicy.allowedProviderIds
    ? platformPluginPolicy.allowedProviderIds.filter((providerId) => providerIds.includes(providerId))
    : providerIds;
  const tenantAllowedModelIds = platformPluginPolicy.allowedModelIds ? platformPluginPolicy.allowedModelIds.filter((modelId) => modelIds.includes(modelId)) : modelIds;
  const tenantMandatoryRetentionMode = platformPluginPolicy.mandatoryRetentionMode ?? retentionPolicy?.mandatoryRetentionMode ?? null;

  return {
    providers,
    mcp,
    inventory: {
      providers: providerInventory,
      toolIds
    },
    policyDocuments: {
      platform: {
        allowedProviderIds: providerIds,
        defaultProviderId: chooseDefault(config.defaultProviderId, providerIds) ?? defaultProviderId,
        allowedModelIds: modelIds,
        defaultModelId: chooseDefault(config.defaultModelId, modelIds) ?? defaultModelId,
        allowedToolIds: toolIds,
        enabledToolIds,
        defaultRetentionMode: "retained",
        userByoProviderAllowed: true
      },
      ...(config.deploymentMode === "multi_tenant"
        ? {
            service: {
              allowedProviderIds: providerIds,
              defaultProviderId,
              allowedModelIds: modelIds,
              defaultModelId,
              allowedToolIds: toolIds,
              enabledToolIds
            }
          }
        : {}),
      tenant: {
        allowedProviderIds: tenantAllowedProviderIds,
        defaultProviderId: chooseDefault(platformPluginPolicy.defaultProviderId ?? defaultProviderId, tenantAllowedProviderIds) ?? defaultProviderId,
        allowedModelIds: tenantAllowedModelIds,
        defaultModelId: chooseDefault(platformPluginPolicy.defaultModelId ?? defaultModelId, tenantAllowedModelIds) ?? defaultModelId,
        allowedToolIds: tenantAllowedToolIds,
        ...(platformPluginPolicy.deniedProviderIds ? { deniedProviderIds: platformPluginPolicy.deniedProviderIds } : {}),
        ...(platformPluginPolicy.deniedModelIds ? { deniedModelIds: platformPluginPolicy.deniedModelIds } : {}),
        ...(platformPluginPolicy.deniedToolIds ? { deniedToolIds: platformPluginPolicy.deniedToolIds } : {}),
        enabledToolIds,
        promptFragments: tenantPrompts,
        userByoProviderAllowed: config.singleCompany.allowUserByoProvider,
        defaultRetentionMode: platformPluginPolicy.defaultRetentionMode ?? defaultRetentionMode,
        ...(platformPluginPolicy.tracePolicy ? { tracePolicy: platformPluginPolicy.tracePolicy } : {}),
        ...(tenantMandatoryRetentionMode ? { mandatoryRetentionMode: tenantMandatoryRetentionMode } : {})
      },
      user: {
        promptFragments: userPrompts
      }
    }
  };
}

function platformPluginPolicyBundle(installations: PlatformPluginInstallation[], tenantId: string): PolicyScopeConfig {
  const output: PolicyScopeConfig = {};
  for (const installation of installations) {
    if (!installation.enabled || installation.deletedAt != null || installation.scopeType !== "tenant" || installation.scopeId !== tenantId) {
      continue;
    }
    const manifest = installation.manifestJson;
    if (manifest.kind !== "policy_bundle" || !manifest.policyBundle) {
      continue;
    }
    const bundle = manifest.policyBundle;
    const allowedProviderIds = mergePolicyList(output.allowedProviderIds, bundle.allowedProviderIds);
    const deniedProviderIds = mergePolicyList(output.deniedProviderIds, bundle.deniedProviderIds);
    const allowedModelIds = mergePolicyList(output.allowedModelIds, bundle.allowedModelIds);
    const deniedModelIds = mergePolicyList(output.deniedModelIds, bundle.deniedModelIds);
    const allowedToolIds = mergePolicyList(output.allowedToolIds, bundle.allowedToolIds);
    const deniedToolIds = mergePolicyList(output.deniedToolIds, bundle.deniedToolIds);
    const enabledToolIds = mergePolicyList(output.enabledToolIds, bundle.enabledToolIds);
    if (allowedProviderIds) output.allowedProviderIds = allowedProviderIds;
    if (deniedProviderIds) output.deniedProviderIds = deniedProviderIds;
    if (allowedModelIds) output.allowedModelIds = allowedModelIds;
    if (deniedModelIds) output.deniedModelIds = deniedModelIds;
    if (allowedToolIds) output.allowedToolIds = allowedToolIds;
    if (deniedToolIds) output.deniedToolIds = deniedToolIds;
    if (enabledToolIds) output.enabledToolIds = enabledToolIds;
    if (bundle.defaultProviderId) output.defaultProviderId = bundle.defaultProviderId;
    if (bundle.defaultModelId) output.defaultModelId = bundle.defaultModelId;
    if (bundle.defaultRetentionMode) output.defaultRetentionMode = bundle.defaultRetentionMode;
    if (bundle.mandatoryRetentionMode) output.mandatoryRetentionMode = bundle.mandatoryRetentionMode;
    if (bundle.tracePolicy) output.tracePolicy = bundle.tracePolicy;
  }
  return output;
}

function mergePolicyList(left: string[] | undefined, right: string[] | undefined): string[] | undefined {
  if (!right || right.length === 0) {
    return left;
  }
  return unique([...(left ?? []), ...right]);
}

async function registerExternalMcpTools(
  mcp: McpGateway,
  servers: Awaited<ReturnType<AdminStateDatabase["snapshot"]>>["mcpServers"],
  installations: Awaited<ReturnType<AdminStateDatabase["snapshot"]>>["pluginInstallations"],
  tenantId: string
): Promise<Array<Pick<ToolDefinition, "id">>> {
  const enabledInstallations = installations.filter(
    (installation) =>
      installation.enabled &&
      installation.deletedAt == null &&
      ((installation.scopeType === "tenant" && installation.scopeId === tenantId) || installation.scopeType === "service")
  );
  const serverById = new Map(servers.filter((server) => server.enabled).map((server) => [server.id, server]));
  const registered: Array<Pick<ToolDefinition, "id">> = [];

  for (const installation of enabledInstallations) {
    const server = serverById.get(installation.mcpServerId);
    if (!server) {
      continue;
    }
    const adapter =
      server.transportType === "http" && server.serverUrl
        ? new HttpMcpTransportAdapter({
            serverUrl: server.serverUrl,
            allowExternalExecution: true
          })
        : server.transportType === "stdio" && server.command
          ? new StdioMcpTransportAdapter({
              command: server.command,
              args: server.argsJson,
              allowLocalProcessExecution: true
            })
          : null;
    if (!adapter) {
      continue;
    }
    try {
      const tools = await adapter.listTools();
      for (const tool of tools) {
        const definition: ToolDefinition = {
          id: tool.id,
          name: tool.name,
          description: tool.description,
          riskLevel: highestRiskLevel(server.riskLevel, tool.riskLevel),
          requiresConfirmation: tool.requiresConfirmation || server.riskLevel === "high",
          execute: (args) => adapter.invokeTool({ toolId: tool.id, args })
        };
        mcp.registerTool(definition);
        registered.push({ id: tool.id });
      }
    } catch {
      continue;
    }
  }
  return registered;
}

function highestRiskLevel(left: ToolDefinition["riskLevel"], right: ToolDefinition["riskLevel"]): ToolDefinition["riskLevel"] {
  const ranks: Record<ToolDefinition["riskLevel"], number> = {
    low: 0,
    medium: 1,
    high: 2
  };
  return ranks[left] >= ranks[right] ? left : right;
}

function auditTypeForToolResult(status: ToolExecutionResult["status"]): "tool.invoked" | "tool.denied" | "tool.confirmation_required" {
  if (status === "completed") {
    return "tool.invoked";
  }
  if (status === "requires_confirmation") {
    return "tool.confirmation_required";
  }
  return "tool.denied";
}

function providerRuntimeId(provider: { id: string; providerType: string }): string {
  return provider.providerType === "mock" ? "mock" : provider.id;
}

function chooseDefault<T extends string>(candidate: T, values: T[]): T | null {
  return values.includes(candidate) ? candidate : values[0] ?? null;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function createKmsProvider(config: AppConfig): KmsProvider {
  if (config.kms.provider === "vault_transit") {
    if (!config.kms.vaultAddr || !config.kms.vaultTransitKey) {
      throw new Error("KMS_PROVIDER=vault_transit requires VAULT_ADDR and VAULT_TRANSIT_KEY");
    }
    return new VaultTransitKmsProvider({
      vaultAddr: config.kms.vaultAddr,
      transitKey: config.kms.vaultTransitKey,
      ...(config.kms.vaultToken ? { vaultToken: config.kms.vaultToken } : {})
    });
  }
  return new LocalKmsProvider(config.kms.localMasterKeyBase64);
}

async function ensureSqlPromptFragment(
  db: SqlRuntimeDatabase,
  input: Parameters<SqlRuntimeDatabase["createPromptFragment"]>[0]
): Promise<PromptFragment> {
  const existing = (await db.snapshot()).promptFragments.find(
    (fragment) =>
      fragment.tenantId === input.tenantId &&
      fragment.scopeType === input.scopeType &&
      fragment.scopeId === input.scopeId &&
      fragment.name === input.name &&
      fragment.deletedAt == null
  );
  return existing ?? db.createPromptFragment(input);
}

async function ensureSqlToolPermission(
  db: SqlRuntimeDatabase,
  input: Parameters<SqlRuntimeDatabase["createToolPermission"]>[0]
): Promise<void> {
  const existing = (await db.listToolPermissions(input.tenantId)).find(
    (permission) =>
      permission.toolId === input.toolId &&
      permission.subjectType === input.subjectType &&
      permission.subjectId === input.subjectId &&
      permission.permission === input.permission
  );
  if (!existing) {
    await db.createToolPermission(input);
  }
}
