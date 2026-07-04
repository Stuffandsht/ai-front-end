import type { AppConfig } from "@agent-platform/config";
import { createLocalContentCrypto } from "@agent-platform/crypto";
import { InMemoryDatabase, type Conversation, type PromptFragment, type Tenant, type TenantMembership, type User } from "@agent-platform/db";
import { createMockTools, McpGateway, type ToolExecutionResult } from "@agent-platform/mcp-gateway";
import {
  compileEffectivePolicy,
  summarizePolicy,
  type EffectivePolicy,
  type PolicyDocuments,
  type PolicyInput,
  type ProviderInventory
} from "@agent-platform/policy";
import { compilePromptStack, loadPromptFragmentSources, renderCompiledPrompt, type CompiledPrompt } from "@agent-platform/prompts";
import { MockProvider, ProviderGateway, type ChatCompletionResult, type ChatMessage, type ToolCallRequest } from "@agent-platform/providers";
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
};

export type SafeToolResultSummary = {
  toolId: string;
  status: ToolExecutionResult["status"];
  metadata: Record<string, unknown>;
};

export type SafeError = {
  code: string;
  message: string;
};

export type ChatStreamEvent =
  | { type: "policy"; policySummary: SafePolicySummary }
  | { type: "message_delta"; delta: string }
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
    const pendingToolCalls: ToolCallRequest[] = [];

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
            delta: event.delta
          });
        }
        if (event.type === "tool_call") {
          pendingToolCalls.push(event.toolCall);
        }
        if (event.type === "done") {
          finalResult = event.result;
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
    }

    for (const toolCall of pendingToolCalls) {
      events.push({
        type: "tool_call_requested",
        toolCall: {
          id: toolCall.id,
          toolId: toolCall.toolId,
          argsPreview: retention.canStoreToolPayloads ? toolCall.args : { redacted: true },
          requiresConfirmation: !request.confirmedToolIds?.includes(toolCall.toolId)
        }
      });
      const toolResult = await this.services.mcp.executeTool({
        tenantId: tenant.id,
        userId: user.id,
        conversationId,
        requestId,
        toolId: toolCall.toolId,
        args: toolCall.args,
        confirmed: request.confirmedToolIds?.includes(toolCall.toolId) ?? false,
        policy,
        retention
      });
      await this.services.db.createAudit({
        tenantId: tenant.id,
        userId: user.id,
        type: toolResult.status === "completed" ? "tool.invoked" : "tool.denied",
        requestId,
        metadata: {
          toolId: toolCall.toolId,
          status: toolResult.status
        },
        retention
      });
      events.push({
        type: "tool_call_completed",
        toolResult: {
          toolId: toolCall.toolId,
          status: toolResult.status,
          metadata: toolResult.status === "completed" ? { resultKeys: Object.keys(toolResult.result) } : { reason: toolResult.reason }
        }
      });
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
        toolCount: pendingToolCalls.length,
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

export async function createLocalRuntime(config: AppConfig): Promise<RuntimeServices<InMemoryDatabase> & { runtime: ChatRuntime; devUser: User; tenant: Tenant }> {
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

  const companyPrompt = await db.createPromptFragment({
    tenantId: tenant.id,
    scopeType: "tenant",
    scopeId: tenant.id,
    name: config.deploymentMode === "single_company" ? "Company Prompt" : "Tenant Prompt",
    content: "Answer as the governed internal AI assistant. Enforce policy outside the model.",
    priority: 100,
    createdBy: devUser.id
  });
  const userPrompt = await db.createPromptFragment({
    tenantId: tenant.id,
    scopeType: "user",
    scopeId: devUser.id,
    name: "User Preference",
    content: "Prefer concise, actionable responses.",
    priority: 20,
    createdBy: devUser.id
  });

  const providers = new ProviderGateway();
  providers.register(new MockProvider());

  const mcp = new McpGateway(db);
  for (const tool of createMockTools()) {
    mcp.registerTool(tool);
  }
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

  const inventory: ProviderInventory = {
    providers: [
      {
        id: "mock",
        modelIds: ["mock-chat", "mock-chat-fast"],
        enabled: true
      },
      {
        id: "user-openai",
        modelIds: ["gpt-compatible"],
        enabled: true,
        byo: true
      }
    ],
    toolIds: ["mock.read_context", "mock.dangerous_action"]
  };

  const policyDocuments: PolicyDocuments = {
    platform: {
      allowedProviderIds: ["mock", "user-openai"],
      defaultProviderId: "mock",
      allowedModelIds: ["mock-chat", "mock-chat-fast", "gpt-compatible"],
      defaultModelId: "mock-chat",
      allowedToolIds: ["mock.read_context", "mock.dangerous_action"],
      enabledToolIds: ["mock.read_context"],
      defaultRetentionMode: "retained",
      userByoProviderAllowed: true
    },
    ...(config.deploymentMode === "multi_tenant"
      ? {
          service: {
            allowedProviderIds: ["mock", "user-openai"],
            defaultProviderId: "mock",
            defaultModelId: "mock-chat"
          }
        }
      : {}),
    tenant: {
      allowedProviderIds: ["mock"],
      defaultProviderId: config.singleCompany.defaultProviderId,
      allowedModelIds: ["mock-chat", "mock-chat-fast"],
      defaultModelId: config.singleCompany.defaultModelId,
      allowedToolIds: ["mock.read_context", "mock.dangerous_action"],
      enabledToolIds: ["mock.read_context"],
      promptFragments: [
        {
          id: companyPrompt.id,
          priority: companyPrompt.priority
        }
      ],
      userByoProviderAllowed: config.singleCompany.allowUserByoProvider,
      defaultRetentionMode: config.singleCompany.defaultRetention
    },
    user: {
      promptFragments: [
        {
          id: userPrompt.id,
          priority: userPrompt.priority
        }
      ]
    }
  };

  const services: RuntimeServices<InMemoryDatabase> = {
    config,
    db,
    providers,
    mcp,
    inventory,
    policyDocuments
  };
  const runtime = new ChatRuntime(services);
  return {
    ...services,
    runtime,
    devUser,
    tenant
  };
}
