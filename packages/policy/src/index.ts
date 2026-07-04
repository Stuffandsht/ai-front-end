import { createHash } from "node:crypto";
import type { DeploymentMode } from "@agent-platform/config";
import { buildRetentionContext, isStricterOrEqual, retentionRank, stricterRetentionMode, type RetentionMode } from "@agent-platform/retention";

export type PolicyInput = {
  deploymentMode: DeploymentMode;
  tenantId: string;
  userId: string;
  groupIds: string[];
  conversationId?: string;
  requestedProviderId?: string;
  requestedModelId?: string;
  requestedRetentionMode?: RetentionMode;
  requestedToolIds?: string[];
};

export type EffectivePolicy = {
  id: string;
  deploymentMode: DeploymentMode;
  tenantId: string;
  userId: string;
  allowedProviderIds: string[];
  defaultProviderId: string;
  selectedProviderId: string;
  allowedModelIds: string[];
  defaultModelId: string;
  selectedModelId: string;
  allowedToolIds: string[];
  enabledToolIds: string[];
  retentionMode: RetentionMode;
  tracePolicy: "full" | "redacted" | "metadata_only" | "none";
  promptFragmentIds: string[];
  userByoProviderAllowed: boolean;
  reasons: PolicyReason[];
};

export type PolicyReason = {
  code: string;
  severity: "info" | "warning" | "deny";
  message: string;
  sourceScope: PolicySourceScope;
};

export type PolicySourceScope = "platform" | "service" | "tenant" | "company" | "group" | "user" | "conversation" | "request";

export type ProviderInventory = {
  providers: Array<{
    id: string;
    modelIds: string[];
    enabled: boolean;
    byo?: boolean;
  }>;
  toolIds: string[];
};

export type PolicyScopeConfig = {
  allowedProviderIds?: string[];
  deniedProviderIds?: string[];
  defaultProviderId?: string;
  allowedModelIds?: string[];
  deniedModelIds?: string[];
  defaultModelId?: string;
  allowedToolIds?: string[];
  deniedToolIds?: string[];
  enabledToolIds?: string[];
  promptFragments?: Array<{
    id: string;
    priority: number;
  }>;
  userByoProviderAllowed?: boolean;
  defaultRetentionMode?: RetentionMode;
  mandatoryRetentionMode?: RetentionMode;
  tracePolicy?: EffectivePolicy["tracePolicy"];
};

export type PolicyDocuments = {
  platform?: PolicyScopeConfig;
  service?: PolicyScopeConfig;
  tenant?: PolicyScopeConfig;
  groups?: Record<string, PolicyScopeConfig>;
  user?: PolicyScopeConfig;
  conversation?: PolicyScopeConfig;
};

type ResolvedScope = {
  source: PolicySourceScope;
  config: PolicyScopeConfig;
};

type MutablePolicyState = {
  allowedProviderIds: Set<string>;
  deniedProviderIds: Set<string>;
  defaultProviderId: string;
  selectedProviderId: string | null;
  allowedModelIds: Set<string>;
  deniedModelIds: Set<string>;
  defaultModelId: string;
  selectedModelId: string | null;
  allowedToolIds: Set<string>;
  deniedToolIds: Set<string>;
  enabledToolIds: Set<string>;
  defaultRetentionMode: RetentionMode;
  mandatoryRetentionMode: RetentionMode | null;
  tracePolicy: EffectivePolicy["tracePolicy"];
  promptFragments: Array<{
    id: string;
    priority: number;
    source: PolicySourceScope;
  }>;
  userByoProviderAllowed: boolean;
  userByoProviderForbidden: boolean;
  reasons: PolicyReason[];
};

export function compileEffectivePolicy(input: PolicyInput, documents: PolicyDocuments, inventory: ProviderInventory): EffectivePolicy {
  const enabledProviders = inventory.providers.filter((provider) => provider.enabled);
  const providerIds = enabledProviders.map((provider) => provider.id);
  const modelIds = [...new Set(enabledProviders.flatMap((provider) => provider.modelIds))];
  const platform = documents.platform ?? {};
  const initialDefaultProvider = platform.defaultProviderId ?? providerIds[0] ?? "mock";
  const initialDefaultModel = platform.defaultModelId ?? modelIds[0] ?? "mock-chat";

  const state: MutablePolicyState = {
    allowedProviderIds: new Set(providerIds),
    deniedProviderIds: new Set(),
    defaultProviderId: initialDefaultProvider,
    selectedProviderId: null,
    allowedModelIds: new Set(modelIds),
    deniedModelIds: new Set(),
    defaultModelId: initialDefaultModel,
    selectedModelId: null,
    allowedToolIds: new Set(inventory.toolIds),
    deniedToolIds: new Set(),
    enabledToolIds: new Set(),
    defaultRetentionMode: platform.defaultRetentionMode ?? "retained",
    mandatoryRetentionMode: platform.mandatoryRetentionMode ?? null,
    tracePolicy: platform.tracePolicy ?? "full",
    promptFragments: [],
    userByoProviderAllowed: platform.userByoProviderAllowed ?? false,
    userByoProviderForbidden: platform.userByoProviderAllowed === false,
    reasons: []
  };

  for (const scope of scopesFor(input, documents)) {
    mergeScope(input, state, scope, inventory);
  }

  const requestedProviderId = input.requestedProviderId;
  if (requestedProviderId && state.allowedProviderIds.has(requestedProviderId)) {
    state.selectedProviderId = requestedProviderId;
    state.reasons.push(reason("PROVIDER_REQUEST_ACCEPTED", "info", `Requested provider ${requestedProviderId} is allowed.`, "request"));
  } else if (requestedProviderId) {
    state.reasons.push(reason("PROVIDER_DENIED", "deny", `Requested provider ${requestedProviderId} is not allowed by effective policy.`, "request"));
  }

  state.selectedProviderId = state.selectedProviderId ?? firstAllowed([state.defaultProviderId, ...state.allowedProviderIds], state.allowedProviderIds);
  if (!state.selectedProviderId) {
    state.reasons.push(reason("NO_PROVIDER_AVAILABLE", "deny", "No provider is available after policy denies and restrictions.", "platform"));
    state.selectedProviderId = "unavailable";
  }

  const providerModels = enabledProviders.find((provider) => provider.id === state.selectedProviderId)?.modelIds ?? modelIds;
  state.allowedModelIds = new Set([...state.allowedModelIds].filter((modelId) => providerModels.includes(modelId) && !state.deniedModelIds.has(modelId)));

  const requestedModelId = input.requestedModelId;
  if (requestedModelId && state.allowedModelIds.has(requestedModelId)) {
    state.selectedModelId = requestedModelId;
    state.reasons.push(reason("MODEL_REQUEST_ACCEPTED", "info", `Requested model ${requestedModelId} is allowed.`, "request"));
  } else if (requestedModelId) {
    state.reasons.push(reason("MODEL_DENIED", "deny", `Requested model ${requestedModelId} is not allowed by effective policy.`, "request"));
  }

  state.selectedModelId = state.selectedModelId ?? firstAllowed([state.defaultModelId, ...state.allowedModelIds], state.allowedModelIds);
  if (!state.selectedModelId) {
    state.reasons.push(reason("NO_MODEL_AVAILABLE", "deny", "No model is available after policy denies and restrictions.", "platform"));
    state.selectedModelId = "unavailable";
  }

  const requestedRetention = input.requestedRetentionMode;
  let retentionMode = requestedRetention ?? state.defaultRetentionMode;
  if (state.mandatoryRetentionMode && !isStricterOrEqual(retentionMode, state.mandatoryRetentionMode)) {
    state.reasons.push(
      reason(
        "RETENTION_STRICTEST_WINS",
        requestedRetention ? "deny" : "warning",
        `Retention ${retentionMode} is looser than mandatory ${state.mandatoryRetentionMode}; using ${state.mandatoryRetentionMode}.`,
        input.deploymentMode === "single_company" ? "company" : "tenant"
      )
    );
    retentionMode = state.mandatoryRetentionMode;
  }
  if (requestedRetention && retentionRank[requestedRetention] < retentionRank[state.defaultRetentionMode]) {
    state.reasons.push(reason("RETENTION_REQUEST_STRICTER", "info", `Requested stricter retention ${requestedRetention} was accepted.`, "request"));
    retentionMode = stricterRetentionMode(retentionMode, requestedRetention);
  }

  const retention = buildRetentionContext(retentionMode);
  const tracePolicy: EffectivePolicy["tracePolicy"] =
    retention.mode === "ephemeral" ? "metadata_only" : retention.mode === "limited" ? "redacted" : state.tracePolicy;

  const requestedToolIds = input.requestedToolIds ?? [];
  const enabledToolIds = requestedToolIds.length > 0 ? requestedToolIds : [...state.enabledToolIds];
  const deniedRequestedTools = enabledToolIds.filter((toolId) => !state.allowedToolIds.has(toolId));
  for (const toolId of deniedRequestedTools) {
    state.reasons.push(reason("TOOL_DENIED", "deny", `Requested tool ${toolId} is not allowed by effective policy.`, "request"));
  }

  const promptFragmentIds = state.promptFragments
    .sort((a, b) => b.priority - a.priority || scopeOrder(a.source) - scopeOrder(b.source) || a.id.localeCompare(b.id))
    .map((fragment) => fragment.id);

  const policyWithoutId = {
    deploymentMode: input.deploymentMode,
    tenantId: input.tenantId,
    userId: input.userId,
    allowedProviderIds: [...state.allowedProviderIds].sort(),
    defaultProviderId: state.defaultProviderId,
    selectedProviderId: state.selectedProviderId,
    allowedModelIds: [...state.allowedModelIds].sort(),
    defaultModelId: state.defaultModelId,
    selectedModelId: state.selectedModelId,
    allowedToolIds: [...state.allowedToolIds].sort(),
    enabledToolIds: enabledToolIds.filter((toolId) => state.allowedToolIds.has(toolId)).sort(),
    retentionMode,
    tracePolicy,
    promptFragmentIds,
    userByoProviderAllowed: state.userByoProviderAllowed,
    reasons: state.reasons
  };

  return {
    id: policyId(policyWithoutId),
    ...policyWithoutId
  };
}

export function summarizePolicy(policy: EffectivePolicy): {
  id: string;
  deploymentMode: DeploymentMode;
  tenantId: string;
  selectedProviderId: string;
  selectedModelId: string;
  enabledToolIds: string[];
  retentionMode: RetentionMode;
  tracePolicy: EffectivePolicy["tracePolicy"];
  reasons: PolicyReason[];
  userByoProviderAllowed: boolean;
} {
  return {
    id: policy.id,
    deploymentMode: policy.deploymentMode,
    tenantId: policy.tenantId,
    selectedProviderId: policy.selectedProviderId,
    selectedModelId: policy.selectedModelId,
    enabledToolIds: policy.enabledToolIds,
    retentionMode: policy.retentionMode,
    tracePolicy: policy.tracePolicy,
    reasons: policy.reasons,
    userByoProviderAllowed: policy.userByoProviderAllowed
  };
}

function mergeScope(input: PolicyInput, state: MutablePolicyState, scope: ResolvedScope, inventory: ProviderInventory): void {
  const config = scope.config;

  if (config.deniedProviderIds) {
    for (const providerId of config.deniedProviderIds) {
      state.deniedProviderIds.add(providerId);
      state.allowedProviderIds.delete(providerId);
      state.reasons.push(reason("PROVIDER_DENY_OVERRIDE", "info", `Provider ${providerId} denied at ${scope.source} scope.`, scope.source));
    }
  }

  if (config.allowedProviderIds && scope.source !== "user") {
    state.allowedProviderIds = intersectSet(state.allowedProviderIds, new Set(config.allowedProviderIds));
    for (const denied of state.deniedProviderIds) {
      state.allowedProviderIds.delete(denied);
    }
  }

  if (config.userByoProviderAllowed != null) {
    if (config.userByoProviderAllowed && !state.userByoProviderForbidden) {
      state.userByoProviderAllowed = true;
    } else if (!config.userByoProviderAllowed && scope.source !== "user") {
      state.userByoProviderAllowed = false;
      state.userByoProviderForbidden = true;
      for (const provider of inventory.providers) {
        if (provider.byo) {
          state.allowedProviderIds.delete(provider.id);
        }
      }
      state.reasons.push(reason("BYO_PROVIDER_FORBIDDEN", "info", `User BYO provider disabled at ${scope.source} scope.`, scope.source));
    } else if (config.userByoProviderAllowed && state.userByoProviderForbidden) {
      state.reasons.push(reason("BYO_PROVIDER_DENIED", "deny", "User BYO provider cannot be enabled because a higher scope forbids it.", scope.source));
    }
  }

  if (scope.source === "user" && config.allowedProviderIds) {
    const byoProviders = inventory.providers.filter((provider) => provider.byo).map((provider) => provider.id);
    for (const providerId of config.allowedProviderIds) {
      if (byoProviders.includes(providerId) && state.userByoProviderAllowed && !state.deniedProviderIds.has(providerId)) {
        state.allowedProviderIds.add(providerId);
        state.reasons.push(reason("BYO_PROVIDER_ALLOWED", "info", `User provider ${providerId} allowed by tenant/company policy.`, scope.source));
      } else if (byoProviders.includes(providerId)) {
        state.reasons.push(reason("BYO_PROVIDER_DENIED", "deny", `User provider ${providerId} denied because BYO provider is disabled.`, scope.source));
      }
    }
  }

  if (config.defaultProviderId && state.allowedProviderIds.has(config.defaultProviderId)) {
    state.defaultProviderId = config.defaultProviderId;
  } else if (config.defaultProviderId) {
    state.reasons.push(reason("DEFAULT_PROVIDER_DENIED", "warning", `Default provider ${config.defaultProviderId} is not allowed.`, scope.source));
  }

  if (config.deniedModelIds) {
    for (const modelId of config.deniedModelIds) {
      state.deniedModelIds.add(modelId);
      state.allowedModelIds.delete(modelId);
      state.reasons.push(reason("MODEL_DENY_OVERRIDE", "info", `Model ${modelId} denied at ${scope.source} scope.`, scope.source));
    }
  }

  if (config.allowedModelIds) {
    state.allowedModelIds = intersectSet(state.allowedModelIds, new Set(config.allowedModelIds));
    for (const denied of state.deniedModelIds) {
      state.allowedModelIds.delete(denied);
    }
  }

  if (config.defaultModelId && state.allowedModelIds.has(config.defaultModelId)) {
    state.defaultModelId = config.defaultModelId;
  } else if (config.defaultModelId) {
    state.reasons.push(reason("DEFAULT_MODEL_DENIED", "warning", `Default model ${config.defaultModelId} is not allowed.`, scope.source));
  }

  if (config.deniedToolIds) {
    for (const toolId of config.deniedToolIds) {
      state.deniedToolIds.add(toolId);
      state.allowedToolIds.delete(toolId);
      state.enabledToolIds.delete(toolId);
      state.reasons.push(reason("TOOL_DENY_OVERRIDE", "info", `Tool ${toolId} denied at ${scope.source} scope.`, scope.source));
    }
  }

  if (config.allowedToolIds) {
    state.allowedToolIds = intersectSet(state.allowedToolIds, new Set(config.allowedToolIds));
    for (const denied of state.deniedToolIds) {
      state.allowedToolIds.delete(denied);
    }
  }

  if (config.enabledToolIds) {
    for (const toolId of config.enabledToolIds) {
      if (state.allowedToolIds.has(toolId)) {
        state.enabledToolIds.add(toolId);
      }
    }
  }

  if (config.defaultRetentionMode) {
    state.defaultRetentionMode = config.defaultRetentionMode;
  }

  if (config.mandatoryRetentionMode) {
    state.mandatoryRetentionMode = state.mandatoryRetentionMode
      ? stricterRetentionMode(state.mandatoryRetentionMode, config.mandatoryRetentionMode)
      : config.mandatoryRetentionMode;
  }

  if (config.tracePolicy) {
    state.tracePolicy = config.tracePolicy;
  }

  if (config.promptFragments) {
    for (const fragment of config.promptFragments) {
      state.promptFragments.push({
        ...fragment,
        source: scope.source
      });
    }
  }

  if (input.deploymentMode === "single_company" && scope.source === "service") {
    state.reasons.push(reason("SERVICE_SCOPE_COLLAPSED", "info", "Service defaults are collapsed into company policy in single-company mode.", "company"));
  }
}

function scopesFor(input: PolicyInput, documents: PolicyDocuments): ResolvedScope[] {
  const scopes: ResolvedScope[] = [];
  if (documents.platform) {
    scopes.push({ source: "platform", config: documents.platform });
  }
  if (input.deploymentMode === "multi_tenant" && documents.service) {
    scopes.push({ source: "service", config: documents.service });
  }
  if (documents.tenant) {
    scopes.push({ source: input.deploymentMode === "single_company" ? "company" : "tenant", config: documents.tenant });
  }
  for (const groupId of input.groupIds) {
    const group = documents.groups?.[groupId];
    if (group) {
      scopes.push({ source: "group", config: group });
    }
  }
  if (documents.user) {
    scopes.push({ source: "user", config: documents.user });
  }
  if (documents.conversation) {
    scopes.push({ source: "conversation", config: documents.conversation });
  }
  return scopes;
}

function intersectSet<T>(left: Set<T>, right: Set<T>): Set<T> {
  const output = new Set<T>();
  for (const value of left) {
    if (right.has(value)) {
      output.add(value);
    }
  }
  return output;
}

function firstAllowed(candidates: Iterable<string>, allowed: Set<string>): string | null {
  for (const candidate of candidates) {
    if (allowed.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

function reason(code: string, severity: PolicyReason["severity"], message: string, sourceScope: PolicySourceScope): PolicyReason {
  return {
    code,
    severity,
    message,
    sourceScope
  };
}

function policyId(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function scopeOrder(scope: PolicySourceScope): number {
  const order: Record<PolicySourceScope, number> = {
    platform: 0,
    service: 1,
    tenant: 2,
    company: 2,
    group: 3,
    user: 4,
    conversation: 5,
    request: 6
  };
  return order[scope];
}
