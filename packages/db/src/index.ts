import { createAuditEvent, type AuditEvent, type AuditEventType } from "@agent-platform/audit";
import type { AppConfig, DeploymentMode } from "@agent-platform/config";
import type { ContentCrypto, EncryptedBlob, EncryptionKeyMetadata } from "@agent-platform/crypto";
import type { RetentionContext, RetentionMode } from "@agent-platform/retention";

export type RoleName = "service_admin" | "company_admin" | "tenant_admin" | "workspace_admin" | "user" | "auditor";

export type ScopeType = "service" | "tenant" | "company" | "group" | "user" | "conversation";

export type TimestampedTenantRecord = {
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type Tenant = {
  id: string;
  slug: string;
  name: string;
  primaryDomain: string | null;
  allowedHostnames: string[];
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type User = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TenantMembership = TimestampedTenantRecord & {
  id: string;
  userId: string;
  role: RoleName;
  externalSubject: string | null;
  externalGroupsJson: string[];
};

export type IdentityProvider = TimestampedTenantRecord & {
  id: string;
  providerType: "oidc" | "microsoft_entra";
  issuerUrl: string;
  clientId: string;
  clientSecretRef: string;
  allowedEmailDomains: string[];
  claimMappingJson: Record<string, string>;
  enabled: boolean;
};

export type ProviderConfig = TimestampedTenantRecord & {
  id: string;
  scopeType: "service" | "tenant" | "user";
  scopeId: string;
  providerType: "mock" | "openai_compatible" | "anthropic_compatible" | "azure_openai" | "ollama" | "custom_http";
  displayName: string;
  baseUrl: string | null;
  authMode: "none" | "service_key" | "tenant_key" | "user_key";
  credentialRef: string | null;
  retentionPolicyClass: "standard" | "metadata_only_required";
  supportsStreaming: boolean;
  supportsToolCalling: boolean;
  supportsJsonSchema: boolean;
  supportsEmbeddings: boolean;
  enabled: boolean;
};

export type ProviderCredential = TimestampedTenantRecord & {
  id: string;
  providerConfigId: string;
  userId: string | null;
  credentialRef: string;
  credentialCiphertext: EncryptedBlob;
};

export type ModelConfig = TimestampedTenantRecord & {
  id: string;
  providerConfigId: string;
  modelKey: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsJsonSchema: boolean;
  inputModalitiesJson: string[];
  outputModalitiesJson: string[];
  enabled: boolean;
};

export type UserProviderPreference = TimestampedTenantRecord & {
  id: string;
  userId: string;
  defaultProviderId: string;
  defaultModelId: string;
};

export type PromptFragment = TimestampedTenantRecord & {
  id: string;
  scopeType: ScopeType;
  scopeId: string;
  name: string;
  contentCiphertext: EncryptedBlob;
  contentHash: string;
  priority: number;
  enabled: boolean;
  version: number;
  createdBy: string;
};

export type PromptFragmentVersion = TimestampedTenantRecord & {
  id: string;
  promptFragmentId: string;
  version: number;
  contentCiphertext: EncryptedBlob;
  contentHash: string;
  createdBy: string;
};

export type PromptCompilation = TimestampedTenantRecord & {
  id: string;
  conversationId: string | null;
  fragmentIds: string[];
  fragmentVersions: number[];
  compiledHash: string;
  compiledPromptCiphertext: EncryptedBlob | null;
  retentionMode: RetentionMode;
};

export type RetentionPolicyRecord = TimestampedTenantRecord & {
  id: string;
  subjectType: "tenant" | "group" | "user";
  subjectId: string;
  defaultRetentionMode: RetentionMode;
  mandatoryRetentionMode: RetentionMode | null;
};

export type EffectivePolicySnapshot = TimestampedTenantRecord & {
  id: string;
  userId: string;
  conversationId: string | null;
  policyHash: string;
  selectedProviderId: string;
  selectedModelId: string;
  retentionMode: RetentionMode;
  reasonsJson: Record<string, unknown>[];
};

export type Conversation = TimestampedTenantRecord & {
  id: string;
  userId: string;
  title: string;
  retentionMode: RetentionMode;
};

export type Message = TimestampedTenantRecord & {
  id: string;
  conversationId: string;
  userId: string;
  role: "user" | "assistant" | "system" | "tool";
  contentCiphertext: EncryptedBlob;
  contentHash: string;
  contentKeyId: string;
  retentionMode: RetentionMode;
};

export type MessagePart = TimestampedTenantRecord & {
  id: string;
  messageId: string;
  type: "text" | "tool_call" | "tool_result";
  contentCiphertext: EncryptedBlob | null;
  contentHash: string | null;
  contentKeyId: string | null;
  retentionMode: RetentionMode;
};

export type Attachment = TimestampedTenantRecord & {
  id: string;
  conversationId: string;
  objectKey: string | null;
  metadataJson: Record<string, unknown>;
  contentHash: string | null;
  contentKeyId: string | null;
  retentionMode: RetentionMode;
};

export type McpServer = {
  id: string;
  name: string;
  description: string;
  transportType: "mock" | "http" | "stdio";
  serverUrl: string | null;
  containerImage: string | null;
  command: string | null;
  argsJson: string[];
  envSecretRefsJson: string[];
  riskLevel: "low" | "medium" | "high";
  retentionPolicyClass: "standard" | "metadata_only_required";
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type PluginInstallation = TimestampedTenantRecord & {
  id: string;
  scopeType: "service" | "tenant" | "user";
  scopeId: string;
  mcpServerId: string;
  configCiphertext: EncryptedBlob | null;
  enabled: boolean;
  installedBy: string;
  approvedBy: string | null;
};

export type ToolPermission = TimestampedTenantRecord & {
  id: string;
  toolId: string;
  subjectType: "tenant" | "group" | "user";
  subjectId: string;
  permission: "use" | "administer";
  requiresConfirmation: boolean;
};

export type ToolInvocation = TimestampedTenantRecord & {
  id: string;
  userId: string;
  conversationId: string | null;
  requestId: string;
  toolId: string;
  status: "completed" | "denied" | "requires_confirmation" | "failed";
  argsCiphertextNullable: EncryptedBlob | null;
  resultCiphertextNullable: EncryptedBlob | null;
  metadataJson: Record<string, unknown>;
  retentionMode: RetentionMode;
};

export type BackgroundJob = TimestampedTenantRecord & {
  id: string;
  queue: string;
  status: "queued" | "running" | "done" | "failed";
  payloadJson: Record<string, unknown> | null;
  metadataJson: Record<string, unknown>;
  retentionMode: RetentionMode;
};

export type DatabaseSnapshot = {
  tenants: Tenant[];
  users: User[];
  tenantMemberships: TenantMembership[];
  identityProviders: IdentityProvider[];
  providerConfigs: ProviderConfig[];
  providerCredentials: ProviderCredential[];
  modelConfigs: ModelConfig[];
  userProviderPreferences: UserProviderPreference[];
  promptFragments: PromptFragment[];
  promptFragmentVersions: PromptFragmentVersion[];
  promptCompilations: PromptCompilation[];
  retentionPolicies: RetentionPolicyRecord[];
  effectivePolicySnapshots: EffectivePolicySnapshot[];
  conversations: Conversation[];
  messages: Message[];
  messageParts: MessagePart[];
  attachments: Attachment[];
  mcpServers: McpServer[];
  pluginInstallations: PluginInstallation[];
  toolPermissions: ToolPermission[];
  toolInvocations: ToolInvocation[];
  auditEvents: AuditEvent[];
  encryptionKeys: EncryptionKeyMetadata[];
  backgroundJobs: BackgroundJob[];
};

export class InMemoryDatabase {
  private readonly snapshotData: DatabaseSnapshot;
  private idCounter = 0;

  constructor(
    private readonly contentCrypto: ContentCrypto,
    private readonly encryptionKeySnapshot: () => EncryptionKeyMetadata[] = () => []
  ) {
    this.snapshotData = {
      tenants: [],
      users: [],
      tenantMemberships: [],
      identityProviders: [],
      providerConfigs: [],
      providerCredentials: [],
      modelConfigs: [],
      userProviderPreferences: [],
      promptFragments: [],
      promptFragmentVersions: [],
      promptCompilations: [],
      retentionPolicies: [],
      effectivePolicySnapshots: [],
      conversations: [],
      messages: [],
      messageParts: [],
      attachments: [],
      mcpServers: [],
      pluginInstallations: [],
      toolPermissions: [],
      toolInvocations: [],
      auditEvents: [],
      encryptionKeys: [],
      backgroundJobs: []
    };
  }

  async seedForConfig(config: AppConfig): Promise<Tenant> {
    if (config.deploymentMode === "single_company") {
      return this.seedSingleCompany(config);
    }
    return this.seedMultiTenant(config);
  }

  async seedSingleCompany(config: AppConfig): Promise<Tenant> {
    const existing = this.snapshotData.tenants.filter((tenant) => tenant.deletedAt == null);
    const matching = existing.find((tenant) => tenant.slug === config.singleCompany.tenantSlug);
    if (existing.length > 1 || (existing.length === 1 && !matching)) {
      throw new Error("single_company mode requires exactly one active tenant");
    }
    if (matching) {
      return matching;
    }
    return this.createTenantDirect({
      slug: config.singleCompany.tenantSlug,
      name: config.singleCompany.tenantName,
      primaryDomain: config.singleCompany.primaryDomain ?? null,
      allowedHostnames: config.singleCompany.primaryDomain ? [config.singleCompany.primaryDomain] : []
    });
  }

  async seedMultiTenant(config: AppConfig): Promise<Tenant> {
    const existing = this.snapshotData.tenants.find((tenant) => tenant.slug === config.multiTenant.defaultTenantSlug && tenant.deletedAt == null);
    if (existing) {
      return existing;
    }
    return this.createTenantDirect({
      slug: config.multiTenant.defaultTenantSlug,
      name: config.multiTenant.defaultTenantName,
      primaryDomain: null,
      allowedHostnames: []
    });
  }

  async createTenantForApi(input: { slug: string; name: string; primaryDomain?: string }, deploymentMode: DeploymentMode): Promise<Tenant> {
    if (deploymentMode === "single_company") {
      throw new Error("Cannot create additional tenants in single_company mode");
    }
    return this.createTenantDirect({
      slug: input.slug,
      name: input.name,
      primaryDomain: input.primaryDomain ?? null,
      allowedHostnames: input.primaryDomain ? [input.primaryDomain] : []
    });
  }

  async createTenantDirect(input: { slug: string; name: string; primaryDomain: string | null; allowedHostnames: string[] }): Promise<Tenant> {
    if (this.snapshotData.tenants.some((tenant) => tenant.slug === input.slug && tenant.deletedAt == null)) {
      throw new Error(`Tenant slug ${input.slug} already exists`);
    }
    const now = new Date();
    const tenant: Tenant = {
      id: this.nextId("tenant"),
      slug: input.slug,
      name: input.name,
      primaryDomain: input.primaryDomain,
      allowedHostnames: input.allowedHostnames,
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    };
    this.snapshotData.tenants.push(tenant);
    return tenant;
  }

  findTenantBySlugOrHost(slugOrHost: string | undefined): Tenant | null {
    if (!slugOrHost) {
      return this.snapshotData.tenants.find((tenant) => tenant.deletedAt == null) ?? null;
    }
    return (
      this.snapshotData.tenants.find(
        (tenant) =>
          tenant.deletedAt == null &&
          (tenant.slug === slugOrHost || tenant.primaryDomain === slugOrHost || tenant.allowedHostnames.includes(slugOrHost))
      ) ?? null
    );
  }

  listTenants(): Tenant[] {
    return this.snapshotData.tenants.filter((tenant) => tenant.deletedAt == null);
  }

  async upsertUser(input: { email: string; displayName: string; avatarUrl?: string | null }): Promise<User> {
    const existing = this.snapshotData.users.find((user) => user.email.toLowerCase() === input.email.toLowerCase());
    if (existing) {
      existing.displayName = input.displayName;
      existing.avatarUrl = input.avatarUrl ?? existing.avatarUrl;
      existing.updatedAt = new Date();
      return existing;
    }

    const now = new Date();
    const user: User = {
      id: this.nextId("user"),
      email: input.email,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl ?? null,
      createdAt: now,
      updatedAt: now
    };
    this.snapshotData.users.push(user);
    return user;
  }

  async upsertMembership(input: { tenantId: string; userId: string; role: RoleName; externalSubject?: string | null; externalGroupsJson?: string[] }): Promise<TenantMembership> {
    const existing = this.snapshotData.tenantMemberships.find(
      (membership) => membership.tenantId === input.tenantId && membership.userId === input.userId && membership.deletedAt == null
    );
    if (existing) {
      existing.role = input.role;
      existing.externalSubject = input.externalSubject ?? existing.externalSubject;
      existing.externalGroupsJson = input.externalGroupsJson ?? existing.externalGroupsJson;
      existing.updatedAt = new Date();
      return existing;
    }

    const membership: TenantMembership = {
      ...tenantRecord(input.tenantId),
      id: this.nextId("membership"),
      userId: input.userId,
      role: input.role,
      externalSubject: input.externalSubject ?? null,
      externalGroupsJson: input.externalGroupsJson ?? []
    };
    this.snapshotData.tenantMemberships.push(membership);
    return membership;
  }

  getMembership(tenantId: string, userId: string): TenantMembership | null {
    return (
      this.snapshotData.tenantMemberships.find(
        (membership) => membership.tenantId === tenantId && membership.userId === userId && membership.deletedAt == null
      ) ?? null
    );
  }

  findUserById(userId: string): User | null {
    return this.snapshotData.users.find((user) => user.id === userId) ?? null;
  }

  async createIdentityProvider(input: Omit<IdentityProvider, keyof TimestampedTenantRecord | "id"> & { tenantId: string }): Promise<IdentityProvider> {
    const provider: IdentityProvider = {
      ...tenantRecord(input.tenantId),
      id: this.nextId("idp"),
      providerType: input.providerType,
      issuerUrl: input.issuerUrl,
      clientId: input.clientId,
      clientSecretRef: input.clientSecretRef,
      allowedEmailDomains: input.allowedEmailDomains,
      claimMappingJson: input.claimMappingJson,
      enabled: input.enabled
    };
    this.snapshotData.identityProviders.push(provider);
    return provider;
  }

  listIdentityProviders(tenantId: string): IdentityProvider[] {
    return this.snapshotData.identityProviders.filter((provider) => provider.tenantId === tenantId && provider.deletedAt == null);
  }

  async updateIdentityProvider(
    id: string,
    input: Partial<Pick<IdentityProvider, "issuerUrl" | "clientId" | "clientSecretRef" | "allowedEmailDomains" | "claimMappingJson" | "enabled">>
  ): Promise<IdentityProvider | null> {
    const provider = this.snapshotData.identityProviders.find((item) => item.id === id && item.deletedAt == null);
    if (!provider) {
      return null;
    }
    provider.issuerUrl = input.issuerUrl ?? provider.issuerUrl;
    provider.clientId = input.clientId ?? provider.clientId;
    provider.clientSecretRef = input.clientSecretRef ?? provider.clientSecretRef;
    provider.allowedEmailDomains = input.allowedEmailDomains ?? provider.allowedEmailDomains;
    provider.claimMappingJson = input.claimMappingJson ?? provider.claimMappingJson;
    provider.enabled = input.enabled ?? provider.enabled;
    provider.updatedAt = new Date();
    return provider;
  }

  async createProviderConfig(input: Omit<ProviderConfig, keyof TimestampedTenantRecord | "id"> & { tenantId: string }): Promise<ProviderConfig> {
    const provider: ProviderConfig = {
      ...tenantRecord(input.tenantId),
      id: input.scopeType === "service" ? `provider_${input.providerType}_${input.scopeId}` : this.nextId("provider"),
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      providerType: input.providerType,
      displayName: input.displayName,
      baseUrl: input.baseUrl,
      authMode: input.authMode,
      credentialRef: input.credentialRef,
      retentionPolicyClass: input.retentionPolicyClass,
      supportsStreaming: input.supportsStreaming,
      supportsToolCalling: input.supportsToolCalling,
      supportsJsonSchema: input.supportsJsonSchema,
      supportsEmbeddings: input.supportsEmbeddings,
      enabled: input.enabled
    };
    this.snapshotData.providerConfigs.push(provider);
    return provider;
  }

  async updateProviderConfig(
    id: string,
    input: Partial<
      Pick<
        ProviderConfig,
        | "displayName"
        | "baseUrl"
        | "authMode"
        | "credentialRef"
        | "retentionPolicyClass"
        | "supportsStreaming"
        | "supportsToolCalling"
        | "supportsJsonSchema"
        | "supportsEmbeddings"
        | "enabled"
      >
    >
  ): Promise<ProviderConfig | null> {
    const provider = this.snapshotData.providerConfigs.find((item) => item.id === id && item.deletedAt == null);
    if (!provider) {
      return null;
    }
    provider.displayName = input.displayName ?? provider.displayName;
    provider.baseUrl = input.baseUrl ?? provider.baseUrl;
    provider.authMode = input.authMode ?? provider.authMode;
    provider.credentialRef = input.credentialRef ?? provider.credentialRef;
    provider.retentionPolicyClass = input.retentionPolicyClass ?? provider.retentionPolicyClass;
    provider.supportsStreaming = input.supportsStreaming ?? provider.supportsStreaming;
    provider.supportsToolCalling = input.supportsToolCalling ?? provider.supportsToolCalling;
    provider.supportsJsonSchema = input.supportsJsonSchema ?? provider.supportsJsonSchema;
    provider.supportsEmbeddings = input.supportsEmbeddings ?? provider.supportsEmbeddings;
    provider.enabled = input.enabled ?? provider.enabled;
    provider.updatedAt = new Date();
    return provider;
  }

  async deleteProviderConfig(id: string): Promise<ProviderConfig | null> {
    const provider = this.snapshotData.providerConfigs.find((item) => item.id === id && item.deletedAt == null);
    if (!provider) {
      return null;
    }
    provider.enabled = false;
    provider.deletedAt = new Date();
    provider.updatedAt = provider.deletedAt;
    return provider;
  }

  async createModelConfig(input: Omit<ModelConfig, keyof TimestampedTenantRecord | "id"> & { tenantId: string }): Promise<ModelConfig> {
    const model: ModelConfig = {
      ...tenantRecord(input.tenantId),
      id: `${input.providerConfigId}:${input.modelKey}`,
      providerConfigId: input.providerConfigId,
      modelKey: input.modelKey,
      displayName: input.displayName,
      contextWindow: input.contextWindow,
      maxOutputTokens: input.maxOutputTokens,
      supportsTools: input.supportsTools,
      supportsStreaming: input.supportsStreaming,
      supportsJsonSchema: input.supportsJsonSchema,
      inputModalitiesJson: input.inputModalitiesJson,
      outputModalitiesJson: input.outputModalitiesJson,
      enabled: input.enabled
    };
    this.snapshotData.modelConfigs.push(model);
    return model;
  }

  async updateModelConfig(
    id: string,
    input: Partial<
      Pick<
        ModelConfig,
        | "displayName"
        | "contextWindow"
        | "maxOutputTokens"
        | "supportsTools"
        | "supportsStreaming"
        | "supportsJsonSchema"
        | "inputModalitiesJson"
        | "outputModalitiesJson"
        | "enabled"
      >
    >
  ): Promise<ModelConfig | null> {
    const model = this.snapshotData.modelConfigs.find((item) => item.id === id && item.deletedAt == null);
    if (!model) {
      return null;
    }
    model.displayName = input.displayName ?? model.displayName;
    model.contextWindow = input.contextWindow ?? model.contextWindow;
    model.maxOutputTokens = input.maxOutputTokens ?? model.maxOutputTokens;
    model.supportsTools = input.supportsTools ?? model.supportsTools;
    model.supportsStreaming = input.supportsStreaming ?? model.supportsStreaming;
    model.supportsJsonSchema = input.supportsJsonSchema ?? model.supportsJsonSchema;
    model.inputModalitiesJson = input.inputModalitiesJson ?? model.inputModalitiesJson;
    model.outputModalitiesJson = input.outputModalitiesJson ?? model.outputModalitiesJson;
    model.enabled = input.enabled ?? model.enabled;
    model.updatedAt = new Date();
    return model;
  }

  async createProviderCredential(input: { tenantId: string; providerConfigId: string; userId?: string | null; credentialRef: string; secret: string }): Promise<ProviderCredential> {
    const encrypted = await this.contentCrypto.encryptForTenant({
      tenantId: input.tenantId,
      plaintext: input.secret,
      purpose: "secret",
      aad: {
        record_type: "provider_credential",
        provider_config_id: input.providerConfigId,
        credential_ref: input.credentialRef
      }
    });
    const credential: ProviderCredential = {
      ...tenantRecord(input.tenantId),
      id: this.nextId("credential"),
      providerConfigId: input.providerConfigId,
      userId: input.userId ?? null,
      credentialRef: input.credentialRef,
      credentialCiphertext: encrypted
    };
    this.snapshotData.providerCredentials.push(credential);
    return credential;
  }

  listProviderCredentials(tenantId: string): ProviderCredential[] {
    return this.snapshotData.providerCredentials.filter((credential) => credential.tenantId === tenantId && credential.deletedAt == null);
  }

  async readProviderCredentialSecret(credential: ProviderCredential): Promise<string> {
    const plaintext = await this.contentCrypto.decryptForTenant({
      tenantId: credential.tenantId,
      blob: credential.credentialCiphertext,
      aad: {
        record_type: "provider_credential",
        provider_config_id: credential.providerConfigId,
        credential_ref: credential.credentialRef
      }
    });
    return String(plaintext);
  }

  async getProviderCredentialSecret(input: { tenantId: string; providerConfigId: string; userId?: string | null; credentialRef?: string | null }): Promise<string | null> {
    const credential =
      this.snapshotData.providerCredentials
        .filter(
          (item) =>
            item.tenantId === input.tenantId &&
            item.providerConfigId === input.providerConfigId &&
            item.deletedAt == null &&
            (input.userId == null ? item.userId == null : item.userId === input.userId) &&
            (input.credentialRef == null || item.credentialRef === input.credentialRef)
        )
        .at(-1) ?? null;
    return credential ? this.readProviderCredentialSecret(credential) : null;
  }

  listProviderConfigs(tenantId: string): ProviderConfig[] {
    return this.snapshotData.providerConfigs.filter((provider) => provider.tenantId === tenantId && provider.enabled && provider.deletedAt == null);
  }

  listModelConfigs(tenantId: string): ModelConfig[] {
    return this.snapshotData.modelConfigs.filter((model) => model.tenantId === tenantId && model.enabled && model.deletedAt == null);
  }

  async createUserProviderPreference(input: { tenantId: string; userId: string; defaultProviderId: string; defaultModelId: string }): Promise<UserProviderPreference> {
    const preference: UserProviderPreference = {
      ...tenantRecord(input.tenantId),
      id: this.nextId("user_provider_preference"),
      userId: input.userId,
      defaultProviderId: input.defaultProviderId,
      defaultModelId: input.defaultModelId
    };
    this.snapshotData.userProviderPreferences.push(preference);
    return preference;
  }

  async createPromptFragment(input: {
    tenantId: string;
    scopeType: ScopeType;
    scopeId: string;
    name: string;
    content: string;
    priority: number;
    createdBy: string;
  }): Promise<PromptFragment> {
    const encrypted = await this.contentCrypto.encryptForTenant({
      tenantId: input.tenantId,
      plaintext: input.content,
      purpose: "prompt",
      aad: {
        record_type: "prompt_fragment",
        scope_type: input.scopeType,
        scope_id: input.scopeId,
        name: input.name
      }
    });
    const fragment: PromptFragment = {
      ...tenantRecord(input.tenantId),
      id: this.nextId("prompt"),
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      name: input.name,
      contentCiphertext: encrypted,
      contentHash: encrypted.contentHash,
      priority: input.priority,
      enabled: true,
      version: 1,
      createdBy: input.createdBy
    };
    const version: PromptFragmentVersion = {
      ...tenantRecord(input.tenantId),
      id: this.nextId("prompt_version"),
      promptFragmentId: fragment.id,
      version: 1,
      contentCiphertext: encrypted,
      contentHash: encrypted.contentHash,
      createdBy: input.createdBy
    };
    this.snapshotData.promptFragments.push(fragment);
    this.snapshotData.promptFragmentVersions.push(version);
    return fragment;
  }

  async updatePromptFragment(
    id: string,
    input: {
      name?: string;
      content?: string;
      priority?: number;
      enabled?: boolean;
      updatedBy: string;
    }
  ): Promise<PromptFragment | null> {
    const fragment = this.snapshotData.promptFragments.find((item) => item.id === id && item.deletedAt == null);
    if (!fragment) {
      return null;
    }
    const nextName = input.name ?? fragment.name;
    const needsReencrypt = input.content != null || input.name != null;
    const nextContent =
      input.content ??
      (needsReencrypt
        ? await this.contentCrypto.decryptForTenant({
            tenantId: fragment.tenantId,
            blob: fragment.contentCiphertext,
            aad: {
              record_type: "prompt_fragment",
              scope_type: fragment.scopeType,
              scope_id: fragment.scopeId,
              name: fragment.name
            }
          })
        : null);
    if (needsReencrypt) {
      const encrypted = await this.contentCrypto.encryptForTenant({
        tenantId: fragment.tenantId,
        plaintext: String(nextContent ?? ""),
        purpose: "prompt",
        aad: {
          record_type: "prompt_fragment",
          scope_type: fragment.scopeType,
          scope_id: fragment.scopeId,
          name: nextName
        }
      });
      fragment.contentCiphertext = encrypted;
      fragment.contentHash = encrypted.contentHash;
      fragment.version += 1;
      this.snapshotData.promptFragmentVersions.push({
        ...tenantRecord(fragment.tenantId),
        id: this.nextId("prompt_version"),
        promptFragmentId: fragment.id,
        version: fragment.version,
        contentCiphertext: encrypted,
        contentHash: encrypted.contentHash,
        createdBy: input.updatedBy
      });
    }
    fragment.name = nextName;
    fragment.priority = input.priority ?? fragment.priority;
    fragment.enabled = input.enabled ?? fragment.enabled;
    fragment.updatedAt = new Date();
    return fragment;
  }

  async deletePromptFragment(id: string): Promise<PromptFragment | null> {
    const fragment = this.snapshotData.promptFragments.find((item) => item.id === id && item.deletedAt == null);
    if (!fragment) {
      return null;
    }
    fragment.enabled = false;
    fragment.deletedAt = new Date();
    fragment.updatedAt = fragment.deletedAt;
    return fragment;
  }

  getPromptFragments(ids: string[]): PromptFragment[] {
    const idSet = new Set(ids);
    return this.snapshotData.promptFragments.filter((fragment) => idSet.has(fragment.id) && fragment.enabled && fragment.deletedAt == null);
  }

  async readPromptFragmentContent(fragment: PromptFragment): Promise<string> {
    const plaintext = await this.contentCrypto.decryptForTenant({
      tenantId: fragment.tenantId,
      blob: fragment.contentCiphertext,
      aad: {
        record_type: "prompt_fragment",
        scope_type: fragment.scopeType,
        scope_id: fragment.scopeId,
        name: fragment.name
      }
    });
    return String(plaintext);
  }

  async createPromptCompilation(input: {
    tenantId: string;
    conversationId?: string | null | undefined;
    fragmentIds: string[];
    fragmentVersions: number[];
    compiledHash: string;
    compiledPromptContent: string;
    retention: RetentionContext;
  }): Promise<PromptCompilation> {
    const encrypted = input.retention.canStoreContent
      ? await this.contentCrypto.encryptForTenant({
          tenantId: input.tenantId,
          plaintext: input.compiledPromptContent,
          purpose: "prompt",
          aad: {
            record_type: "prompt_compilation",
            compiled_hash: input.compiledHash
          }
        })
      : null;
    const compilation: PromptCompilation = {
      ...tenantRecord(input.tenantId),
      id: this.nextId("prompt_compilation"),
      conversationId: input.conversationId ?? null,
      fragmentIds: input.fragmentIds,
      fragmentVersions: input.fragmentVersions,
      compiledHash: input.compiledHash,
      compiledPromptCiphertext: encrypted,
      retentionMode: input.retention.mode
    };
    this.snapshotData.promptCompilations.push(compilation);
    return compilation;
  }

  async createConversation(input: { tenantId: string; userId: string; title: string; retention: RetentionContext }): Promise<Conversation | null> {
    if (!input.retention.canStoreContent) {
      return null;
    }
    const conversation: Conversation = {
      ...tenantRecord(input.tenantId),
      id: this.nextId("conversation"),
      userId: input.userId,
      title: input.title,
      retentionMode: input.retention.mode
    };
    this.snapshotData.conversations.push(conversation);
    return conversation;
  }

  async createMessageFromRequest(input: {
    tenantId: string;
    conversationId: string;
    userId: string;
    role: Message["role"];
    content: string;
    retention: RetentionContext;
  }): Promise<Message | null> {
    if (!input.retention.canStoreContent) {
      return null;
    }
    const encrypted = await this.contentCrypto.encryptForTenant({
      tenantId: input.tenantId,
      plaintext: input.content,
      purpose: "message",
      aad: {
        record_type: "message",
        conversation_id: input.conversationId,
        role: input.role
      }
    });
    const message: Message = {
      ...tenantRecord(input.tenantId),
      id: this.nextId("message"),
      conversationId: input.conversationId,
      userId: input.userId,
      role: input.role,
      contentCiphertext: encrypted,
      contentHash: encrypted.contentHash,
      contentKeyId: encrypted.contentKeyId,
      retentionMode: input.retention.mode
    };
    this.snapshotData.messages.push(message);
    return message;
  }

  listConversations(tenantId: string, userId: string): Conversation[] {
    return this.snapshotData.conversations.filter(
      (conversation) => conversation.tenantId === tenantId && conversation.userId === userId && conversation.deletedAt == null
    );
  }

  async listMessages(tenantId: string, conversationId: string): Promise<Array<Message & { content: string }>> {
    const messages = this.snapshotData.messages.filter(
      (message) => message.tenantId === tenantId && message.conversationId === conversationId && message.deletedAt == null
    );
    const output: Array<Message & { content: string }> = [];
    for (const message of messages) {
      const content = await this.contentCrypto.decryptForTenant({
        tenantId,
        blob: message.contentCiphertext,
        aad: {
          record_type: "message",
          conversation_id: message.conversationId,
          role: message.role
        }
      });
      output.push({
        ...message,
        content: String(content)
      });
    }
    return output;
  }

  async upsertRetentionPolicy(input: {
    tenantId: string;
    subjectType: RetentionPolicyRecord["subjectType"];
    subjectId: string;
    defaultRetentionMode: RetentionPolicyRecord["defaultRetentionMode"];
    mandatoryRetentionMode?: RetentionPolicyRecord["mandatoryRetentionMode"];
  }): Promise<RetentionPolicyRecord> {
    const existing = this.snapshotData.retentionPolicies.find(
      (policy) =>
        policy.tenantId === input.tenantId &&
        policy.subjectType === input.subjectType &&
        policy.subjectId === input.subjectId &&
        policy.deletedAt == null
    );
    if (existing) {
      existing.defaultRetentionMode = input.defaultRetentionMode;
      existing.mandatoryRetentionMode = input.mandatoryRetentionMode ?? null;
      existing.updatedAt = new Date();
      return existing;
    }
    const policy: RetentionPolicyRecord = {
      ...tenantRecord(input.tenantId),
      id: this.nextId("retention_policy"),
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      defaultRetentionMode: input.defaultRetentionMode,
      mandatoryRetentionMode: input.mandatoryRetentionMode ?? null
    };
    this.snapshotData.retentionPolicies.push(policy);
    return policy;
  }

  async getRetentionPolicy(input: { tenantId: string; subjectType: RetentionPolicyRecord["subjectType"]; subjectId: string }): Promise<RetentionPolicyRecord | null> {
    return (
      this.snapshotData.retentionPolicies.find(
        (policy) =>
          policy.tenantId === input.tenantId &&
          policy.subjectType === input.subjectType &&
          policy.subjectId === input.subjectId &&
          policy.deletedAt == null
      ) ?? null
    );
  }

  async createToolInvocation(input: {
    tenantId: string;
    userId: string;
    conversationId?: string | null | undefined;
    requestId: string;
    toolId: string;
    status: ToolInvocation["status"];
    args: Record<string, unknown> | null;
    result: Record<string, unknown> | null;
    metadata: Record<string, unknown>;
    retention: RetentionContext;
  }): Promise<ToolInvocation> {
    const argsCiphertextNullable =
      input.args && input.retention.canStoreToolPayloads
        ? await this.contentCrypto.encryptForTenant({
            tenantId: input.tenantId,
            plaintext: JSON.stringify(input.args),
            purpose: "tool",
            aad: {
              record_type: "tool_invocation_args",
              request_id: input.requestId,
              tool_id: input.toolId
            }
          })
        : null;
    const resultCiphertextNullable =
      input.result && input.retention.canStoreToolPayloads
        ? await this.contentCrypto.encryptForTenant({
            tenantId: input.tenantId,
            plaintext: JSON.stringify(input.result),
            purpose: "tool",
            aad: {
              record_type: "tool_invocation_result",
              request_id: input.requestId,
              tool_id: input.toolId
            }
          })
        : null;
    const invocation: ToolInvocation = {
      ...tenantRecord(input.tenantId),
      id: this.nextId("tool_invocation"),
      userId: input.userId,
      conversationId: input.conversationId ?? null,
      requestId: input.requestId,
      toolId: input.toolId,
      status: input.status,
      argsCiphertextNullable,
      resultCiphertextNullable,
      metadataJson: input.metadata,
      retentionMode: input.retention.mode
    };
    this.snapshotData.toolInvocations.push(invocation);
    return invocation;
  }

  async createToolPermission(input: Omit<ToolPermission, keyof TimestampedTenantRecord | "id"> & { tenantId: string }): Promise<ToolPermission> {
    const permission: ToolPermission = {
      ...tenantRecord(input.tenantId),
      id: this.nextId("tool_permission"),
      toolId: input.toolId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      permission: input.permission,
      requiresConfirmation: input.requiresConfirmation
    };
    this.snapshotData.toolPermissions.push(permission);
    return permission;
  }

  listToolPermissions(tenantId: string): ToolPermission[] {
    return this.snapshotData.toolPermissions.filter((permission) => permission.tenantId === tenantId && permission.deletedAt == null);
  }

  async createMcpServer(input: Omit<McpServer, "id" | "createdAt" | "updatedAt">): Promise<McpServer> {
    const now = new Date();
    const server: McpServer = {
      id: this.nextId("mcp_server"),
      createdAt: now,
      updatedAt: now,
      ...input
    };
    this.snapshotData.mcpServers.push(server);
    return server;
  }

  async createPluginInstallation(input: Omit<PluginInstallation, keyof TimestampedTenantRecord | "id" | "configCiphertext"> & { tenantId: string; config?: string | null }): Promise<PluginInstallation> {
    const configCiphertext =
      input.config && input.config.length > 0
        ? await this.contentCrypto.encryptForTenant({
            tenantId: input.tenantId,
            plaintext: input.config,
            purpose: "secret",
            aad: {
              record_type: "plugin_installation",
              mcp_server_id: input.mcpServerId,
              scope_id: input.scopeId
            }
          })
        : null;
    const installation: PluginInstallation = {
      ...tenantRecord(input.tenantId),
      id: this.nextId("plugin_installation"),
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      mcpServerId: input.mcpServerId,
      configCiphertext,
      enabled: input.enabled,
      installedBy: input.installedBy,
      approvedBy: input.approvedBy
    };
    this.snapshotData.pluginInstallations.push(installation);
    return installation;
  }

  async updatePluginInstallation(id: string, input: { enabled?: boolean; approvedBy?: string | null }): Promise<PluginInstallation | null> {
    const installation = this.snapshotData.pluginInstallations.find((item) => item.id === id && item.deletedAt == null);
    if (!installation) {
      return null;
    }
    installation.enabled = input.enabled ?? installation.enabled;
    installation.approvedBy = input.approvedBy ?? installation.approvedBy;
    installation.updatedAt = new Date();
    return installation;
  }

  async createAudit(input: {
    tenantId: string;
    userId: string;
    type: AuditEventType;
    requestId?: string;
    metadata: Record<string, unknown>;
    content?: Record<string, unknown>;
    retention: RetentionContext;
  }): Promise<AuditEvent> {
    const event = createAuditEvent({
      id: this.nextId("audit"),
      tenantId: input.tenantId,
      userId: input.userId,
      type: input.type,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      metadata: input.metadata,
      ...(input.content ? { content: input.content } : {}),
      retention: input.retention
    });
    this.snapshotData.auditEvents.push(event);
    return event;
  }

  async createBackgroundJob(input: {
    tenantId: string;
    queue: string;
    payload: Record<string, unknown>;
    metadata: Record<string, unknown>;
    retention: RetentionContext;
  }): Promise<BackgroundJob> {
    const job: BackgroundJob = {
      ...tenantRecord(input.tenantId),
      id: this.nextId("job"),
      queue: input.queue,
      status: "queued",
      payloadJson: input.retention.canStoreContent ? input.payload : null,
      metadataJson: input.metadata,
      retentionMode: input.retention.mode
    };
    this.snapshotData.backgroundJobs.push(job);
    return job;
  }

  async createPolicySnapshot(input: {
    tenantId: string;
    userId: string;
    conversationId?: string | null;
    policyHash: string;
    selectedProviderId: string;
    selectedModelId: string;
    retentionMode: RetentionMode;
    reasonsJson: Record<string, unknown>[];
  }): Promise<EffectivePolicySnapshot> {
    const snapshot: EffectivePolicySnapshot = {
      ...tenantRecord(input.tenantId),
      id: this.nextId("policy_snapshot"),
      userId: input.userId,
      conversationId: input.conversationId ?? null,
      policyHash: input.policyHash,
      selectedProviderId: input.selectedProviderId,
      selectedModelId: input.selectedModelId,
      retentionMode: input.retentionMode,
      reasonsJson: input.reasonsJson
    };
    this.snapshotData.effectivePolicySnapshots.push(snapshot);
    return snapshot;
  }

  snapshot(): DatabaseSnapshot {
    this.snapshotData.encryptionKeys = this.encryptionKeySnapshot();
    return structuredClone(this.snapshotData);
  }

  rawSearch(needle: string): boolean {
    this.snapshotData.encryptionKeys = this.encryptionKeySnapshot();
    return JSON.stringify(this.snapshotData).includes(needle);
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}_${this.idCounter.toString().padStart(6, "0")}`;
  }
}

export function tenantRecord(tenantId: string): TimestampedTenantRecord {
  const now = new Date();
  return {
    tenantId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };
}

export * from "./sql";
export * from "./postgres";
