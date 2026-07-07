import { createAuditEvent, type AuditEvent, type AuditEventType } from "@agent-platform/audit";
import { randomUUID } from "node:crypto";
import type { AppConfig, DeploymentMode } from "@agent-platform/config";
import type { ContentCrypto, EncryptedBlob, EncryptionKeyMetadata, EncryptionKeyStore, WrappedKey } from "@agent-platform/crypto";
import type { RetentionContext } from "@agent-platform/retention";
import type {
  Attachment,
  BackgroundJob,
  Conversation,
  DatabaseSnapshot,
  EffectivePolicySnapshot,
  IdentityProvider,
  McpServer,
  Message,
  MessagePart,
  ModelConfig,
  PluginInstallation,
  PromptCompilation,
  PromptFragment,
  PromptFragmentVersion,
  ProviderCredential,
  ProviderConfig,
  RetentionPolicyRecord,
  Tenant,
  TenantMembership,
  ToolInvocation,
  ToolPermission,
  UserProviderPreference,
  User
} from "./index";

export type SqlQueryResult<T> = {
  rows: T[];
};

export type SqlExecutor = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<SqlQueryResult<T>>;
};

export class SqlEncryptionKeyStore implements EncryptionKeyStore {
  constructor(private readonly sql: SqlExecutor) {}

  async getActiveKey(tenantId: string, purpose: EncryptionKeyMetadata["keyPurpose"]): Promise<EncryptionKeyMetadata | null> {
    const result = await this.sql.query<EncryptionKeyRow>(
      `select * from encryption_keys
       where tenant_id = $1 and key_purpose = $2 and status = 'active'
       order by created_at desc
       limit 1`,
      [tenantId, purpose]
    );
    const row = result.rows[0];
    return row ? encryptionKeyFromRow(row) : null;
  }

  async saveKey(key: EncryptionKeyMetadata): Promise<void> {
    await this.sql.query(
      `insert into encryption_keys (
        id, tenant_id, key_purpose, wrapped_dek, kms_provider, kms_key_id,
        status, created_at, rotated_at, disabled_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      on conflict (id) do nothing`,
      [
        key.id,
        key.tenantId,
        key.keyPurpose,
        key.wrappedDek,
        key.kmsProvider,
        key.kmsKeyId,
        key.status,
        key.createdAt,
        key.rotatedAt,
        key.disabledAt
      ]
    );
  }

  async getKeyById(keyId: string): Promise<EncryptionKeyMetadata | null> {
    const result = await this.sql.query<EncryptionKeyRow>("select * from encryption_keys where id = $1 limit 1", [keyId]);
    const row = result.rows[0];
    return row ? encryptionKeyFromRow(row) : null;
  }
}

export class SqlRuntimeDatabase {
  private idCounter = 0;

  constructor(
    private readonly sql: SqlExecutor,
    private readonly contentCrypto: ContentCrypto
  ) {}

  async seedForConfig(config: AppConfig): Promise<Tenant> {
    if (config.deploymentMode === "single_company") {
      const existing = await this.listTenants();
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

    const existing = await this.findTenantBySlugOrHost(config.multiTenant.defaultTenantSlug);
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
    const tenant: Tenant = {
      id: this.nextId("tenant"),
      slug: input.slug,
      name: input.name,
      primaryDomain: input.primaryDomain,
      allowedHostnames: input.allowedHostnames,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null
    };
    await this.sql.query(
      `insert into tenants (id, slug, name, primary_domain, allowed_hostnames, created_at, updated_at, deleted_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tenant.id, tenant.slug, tenant.name, tenant.primaryDomain, tenant.allowedHostnames, tenant.createdAt, tenant.updatedAt, tenant.deletedAt]
    );
    return tenant;
  }

  async findTenantBySlugOrHost(slugOrHost: string | undefined): Promise<Tenant | null> {
    const result = slugOrHost
      ? await this.sql.query<TenantRow>(
          `select * from tenants
           where deleted_at is null
             and (slug = $1 or primary_domain = $1 or allowed_hostnames ? $1)
           limit 1`,
          [slugOrHost]
        )
      : await this.sql.query<TenantRow>("select * from tenants where deleted_at is null order by created_at asc limit 1");
    const row = result.rows[0];
    return row ? tenantFromRow(row) : null;
  }

  async listTenants(): Promise<Tenant[]> {
    const result = await this.sql.query<TenantRow>("select * from tenants where deleted_at is null order by created_at asc");
    return result.rows.map(tenantFromRow);
  }

  async upsertUser(input: { email: string; displayName: string; avatarUrl?: string | null }): Promise<User> {
    const existing = await this.sql.query<UserRow>("select * from users where lower(email) = lower($1) limit 1", [input.email]);
    if (existing.rows[0]) {
      const updated = await this.sql.query<UserRow>(
        `update users set display_name = $2, avatar_url = coalesce($3, avatar_url), updated_at = now()
         where id = $1
         returning *`,
        [existing.rows[0].id, input.displayName, input.avatarUrl ?? null]
      );
      return userFromRow(requiredRow(updated.rows[0], "updated user"));
    }
    const user: User = {
      id: this.nextId("user"),
      email: input.email,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl ?? null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await this.sql.query(
      `insert into users (id, email, display_name, avatar_url, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6)`,
      [user.id, user.email, user.displayName, user.avatarUrl, user.createdAt, user.updatedAt]
    );
    return user;
  }

  async findUserById(userId: string): Promise<User | null> {
    const result = await this.sql.query<UserRow>("select * from users where id = $1 limit 1", [userId]);
    const row = result.rows[0];
    return row ? userFromRow(row) : null;
  }

  async upsertMembership(input: {
    tenantId: string;
    userId: string;
    role: TenantMembership["role"];
    externalSubject?: string | null;
    externalGroupsJson?: string[];
  }): Promise<TenantMembership> {
    const existing = await this.sql.query<TenantMembershipRow>(
      `select * from tenant_memberships
       where tenant_id = $1 and user_id = $2 and deleted_at is null
       limit 1`,
      [input.tenantId, input.userId]
    );
    if (existing.rows[0]) {
      const updated = await this.sql.query<TenantMembershipRow>(
        `update tenant_memberships
         set role = $2, external_subject = $3, external_groups_json = $4, updated_at = now()
         where id = $1
         returning *`,
        [existing.rows[0].id, input.role, input.externalSubject ?? null, input.externalGroupsJson ?? []]
      );
      return membershipFromRow(requiredRow(updated.rows[0], "updated membership"));
    }
    const membership: TenantMembership = {
      ...tenantRecord(input.tenantId),
      id: this.nextId("membership"),
      userId: input.userId,
      role: input.role,
      externalSubject: input.externalSubject ?? null,
      externalGroupsJson: input.externalGroupsJson ?? []
    };
    await this.sql.query(
      `insert into tenant_memberships (
        id, tenant_id, user_id, role, external_subject, external_groups_json,
        created_at, updated_at, deleted_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        membership.id,
        membership.tenantId,
        membership.userId,
        membership.role,
        membership.externalSubject,
        membership.externalGroupsJson,
        membership.createdAt,
        membership.updatedAt,
        membership.deletedAt
      ]
    );
    return membership;
  }

  async getMembership(tenantId: string, userId: string): Promise<TenantMembership | null> {
    const result = await this.sql.query<TenantMembershipRow>(
      `select * from tenant_memberships
       where tenant_id = $1 and user_id = $2 and deleted_at is null
       limit 1`,
      [tenantId, userId]
    );
    const row = result.rows[0];
    return row ? membershipFromRow(row) : null;
  }

  async createIdentityProvider(input: Omit<IdentityProvider, "id" | "createdAt" | "updatedAt" | "deletedAt">): Promise<IdentityProvider> {
    const id = this.nextId("idp");
    const result = await this.sql.query<IdentityProviderRow>(
      `insert into identity_providers (
        id, tenant_id, provider_type, issuer_url, client_id, client_secret_ref,
        allowed_email_domains, claim_mapping_json, enabled
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      returning *`,
      [
        id,
        input.tenantId,
        input.providerType,
        input.issuerUrl,
        input.clientId,
        input.clientSecretRef,
        input.allowedEmailDomains,
        input.claimMappingJson,
        input.enabled
      ]
    );
    return identityProviderFromRow(requiredRow(result.rows[0], "created identity provider"));
  }

  async listIdentityProviders(tenantId: string): Promise<IdentityProvider[]> {
    const result = await this.sql.query<IdentityProviderRow>(
      `select * from identity_providers
       where tenant_id = $1 and deleted_at is null
       order by created_at asc`,
      [tenantId]
    );
    return result.rows.map(identityProviderFromRow);
  }

  async updateIdentityProvider(id: string, input: Partial<Pick<IdentityProvider, "issuerUrl" | "clientId" | "clientSecretRef" | "allowedEmailDomains" | "claimMappingJson" | "enabled">>): Promise<IdentityProvider | null> {
    const existing = await this.sql.query<IdentityProviderRow>("select * from identity_providers where id = $1 and deleted_at is null limit 1", [id]);
    if (!existing.rows[0]) {
      return null;
    }
    const current = identityProviderFromRow(existing.rows[0]);
    const result = await this.sql.query<IdentityProviderRow>(
      `update identity_providers
       set issuer_url = $2, client_id = $3, client_secret_ref = $4,
           allowed_email_domains = $5, claim_mapping_json = $6,
           enabled = $7, updated_at = now()
       where id = $1 and deleted_at is null
       returning *`,
      [
        id,
        input.issuerUrl ?? current.issuerUrl,
        input.clientId ?? current.clientId,
        input.clientSecretRef ?? current.clientSecretRef,
        input.allowedEmailDomains ?? current.allowedEmailDomains,
        input.claimMappingJson ?? current.claimMappingJson,
        input.enabled ?? current.enabled
      ]
    );
    return result.rows[0] ? identityProviderFromRow(result.rows[0]) : null;
  }

  async createProviderConfig(input: {
    tenantId: string;
    scopeType: "service" | "tenant" | "user";
    scopeId: string;
    providerType: "mock" | "openrouter" | "openai_compatible" | "anthropic_compatible" | "azure_openai" | "ollama" | "custom_http";
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
  }): Promise<ProviderConfig> {
    const id = input.providerType === "mock" ? "mock" : this.nextId("provider");
    const result = await this.sql.query<ProviderConfigRow>(
      `insert into provider_configs (
        id, tenant_id, scope_type, scope_id, provider_type, display_name, base_url,
        auth_mode, credential_ref, retention_policy_class, supports_streaming,
        supports_tool_calling, supports_json_schema, supports_embeddings, enabled
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      on conflict (id) do update set updated_at = provider_configs.updated_at
      returning *`,
      [
        id,
        input.tenantId,
        input.scopeType,
        input.scopeId,
        input.providerType,
        input.displayName,
        input.baseUrl,
        input.authMode,
        input.credentialRef,
        input.retentionPolicyClass,
        input.supportsStreaming,
        input.supportsToolCalling,
        input.supportsJsonSchema,
        input.supportsEmbeddings,
        input.enabled
      ]
    );
    return providerConfigFromRow(requiredRow(result.rows[0], "created provider config"));
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
    const existing = await this.sql.query<ProviderConfigRow>("select * from provider_configs where id = $1 and deleted_at is null limit 1", [id]);
    if (!existing.rows[0]) {
      return null;
    }
    const current = providerConfigFromRow(existing.rows[0]);
    const result = await this.sql.query<ProviderConfigRow>(
      `update provider_configs
       set display_name = $2, base_url = $3, auth_mode = $4, credential_ref = $5,
           retention_policy_class = $6, supports_streaming = $7,
           supports_tool_calling = $8, supports_json_schema = $9,
           supports_embeddings = $10, enabled = $11, updated_at = now()
       where id = $1 and deleted_at is null
       returning *`,
      [
        id,
        input.displayName ?? current.displayName,
        input.baseUrl ?? current.baseUrl,
        input.authMode ?? current.authMode,
        input.credentialRef ?? current.credentialRef,
        input.retentionPolicyClass ?? current.retentionPolicyClass,
        input.supportsStreaming ?? current.supportsStreaming,
        input.supportsToolCalling ?? current.supportsToolCalling,
        input.supportsJsonSchema ?? current.supportsJsonSchema,
        input.supportsEmbeddings ?? current.supportsEmbeddings,
        input.enabled ?? current.enabled
      ]
    );
    return result.rows[0] ? providerConfigFromRow(result.rows[0]) : null;
  }

  async deleteProviderConfig(id: string): Promise<ProviderConfig | null> {
    const result = await this.sql.query<ProviderConfigRow>(
      `update provider_configs
       set enabled = false, deleted_at = coalesce(deleted_at, now()), updated_at = now()
       where id = $1 and deleted_at is null
       returning *`,
      [id]
    );
    return result.rows[0] ? providerConfigFromRow(result.rows[0]) : null;
  }

  async createModelConfig(input: {
    tenantId: string;
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
  }): Promise<ModelConfig> {
    const id = `${input.providerConfigId}:${input.modelKey}`;
    const result = await this.sql.query<ModelConfigRow>(
      `insert into model_configs (
        id, tenant_id, provider_config_id, model_key, display_name, context_window,
        max_output_tokens, supports_tools, supports_streaming, supports_json_schema,
        input_modalities_json, output_modalities_json, enabled
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      on conflict (id) do update set updated_at = model_configs.updated_at
      returning *`,
      [
        id,
        input.tenantId,
        input.providerConfigId,
        input.modelKey,
        input.displayName,
        input.contextWindow,
        input.maxOutputTokens,
        input.supportsTools,
        input.supportsStreaming,
        input.supportsJsonSchema,
        input.inputModalitiesJson,
        input.outputModalitiesJson,
        input.enabled
      ]
    );
    return modelConfigFromRow(requiredRow(result.rows[0], "created model config"));
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
    const existing = await this.sql.query<ModelConfigRow>("select * from model_configs where id = $1 and deleted_at is null limit 1", [id]);
    if (!existing.rows[0]) {
      return null;
    }
    const current = modelConfigFromRow(existing.rows[0]);
    const result = await this.sql.query<ModelConfigRow>(
      `update model_configs
       set display_name = $2, context_window = $3, max_output_tokens = $4,
           supports_tools = $5, supports_streaming = $6,
           supports_json_schema = $7, input_modalities_json = $8,
           output_modalities_json = $9, enabled = $10, updated_at = now()
       where id = $1 and deleted_at is null
       returning *`,
      [
        id,
        input.displayName ?? current.displayName,
        input.contextWindow ?? current.contextWindow,
        input.maxOutputTokens ?? current.maxOutputTokens,
        input.supportsTools ?? current.supportsTools,
        input.supportsStreaming ?? current.supportsStreaming,
        input.supportsJsonSchema ?? current.supportsJsonSchema,
        input.inputModalitiesJson ?? current.inputModalitiesJson,
        input.outputModalitiesJson ?? current.outputModalitiesJson,
        input.enabled ?? current.enabled
      ]
    );
    return result.rows[0] ? modelConfigFromRow(result.rows[0]) : null;
  }

  async createProviderCredential(input: { tenantId: string; providerConfigId: string; userId?: string | null; credentialRef: string; secret: string }): Promise<ProviderCredential> {
    const encrypted = await this.contentCrypto.encryptForTenant({
      tenantId: input.tenantId,
      plaintext: input.secret,
      purpose: "secret",
      aad: providerCredentialAad(input.providerConfigId, input.credentialRef)
    });
    const result = await this.sql.query<ProviderCredentialRow>(
      `insert into provider_credentials (
        id, tenant_id, provider_config_id, user_id, credential_ref,
        content_ciphertext, content_nonce, content_tag, content_key_id,
        content_hash, retention_mode
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      returning *`,
      [
        this.nextId("credential"),
        input.tenantId,
        input.providerConfigId,
        input.userId ?? null,
        input.credentialRef,
        encrypted.contentCiphertext,
        encrypted.contentNonce,
        encrypted.contentTag,
        encrypted.contentKeyId,
        encrypted.contentHash,
        "retained"
      ]
    );
    return providerCredentialFromRow(requiredRow(result.rows[0], "created provider credential"));
  }

  async listProviderCredentials(tenantId: string): Promise<ProviderCredential[]> {
    const result = await this.sql.query<ProviderCredentialRow>(
      `select * from provider_credentials
       where tenant_id = $1 and deleted_at is null
       order by created_at asc`,
      [tenantId]
    );
    return result.rows.map(providerCredentialFromRow);
  }

  async readProviderCredentialSecret(credential: ProviderCredential): Promise<string> {
    const plaintext = await this.contentCrypto.decryptForTenant({
      tenantId: credential.tenantId,
      blob: credential.credentialCiphertext,
      aad: providerCredentialAad(credential.providerConfigId, credential.credentialRef)
    });
    return String(plaintext);
  }

  async getProviderCredentialSecret(input: { tenantId: string; providerConfigId: string; userId?: string | null; credentialRef?: string | null }): Promise<string | null> {
    const result = await this.sql.query<ProviderCredentialRow>(
      `select * from provider_credentials
       where tenant_id = $1
         and provider_config_id = $2
         and (($3::text is null and user_id is null) or user_id = $3)
         and ($4::text is null or credential_ref = $4)
         and deleted_at is null
       order by created_at desc
       limit 1`,
      [input.tenantId, input.providerConfigId, input.userId ?? null, input.credentialRef ?? null]
    );
    const row = result.rows[0];
    return row ? this.readProviderCredentialSecret(providerCredentialFromRow(row)) : null;
  }

  async createPromptFragment(input: {
    tenantId: string;
    scopeType: PromptFragment["scopeType"];
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
      aad: promptAad(input.scopeType, input.scopeId, input.name)
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
    await this.insertPromptFragment(fragment);
    await this.insertPromptFragmentVersion(version);
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
    const existing = await this.sql.query<PromptFragmentRow>("select * from prompt_fragments where id = $1 and deleted_at is null limit 1", [id]);
    if (!existing.rows[0]) {
      return null;
    }
    const current = promptFragmentFromRow(existing.rows[0]);
    const nextName = input.name ?? current.name;
    const nextPriority = input.priority ?? current.priority;
    const nextEnabled = input.enabled ?? current.enabled;
    const needsReencrypt = input.content != null || input.name != null;
    const nextVersion = needsReencrypt ? current.version + 1 : current.version;
    const nextContent =
      input.content ??
      (needsReencrypt
        ? await this.contentCrypto.decryptForTenant({
            tenantId: current.tenantId,
            blob: current.contentCiphertext,
            aad: promptAad(current.scopeType, current.scopeId, current.name)
          })
        : null);
    const encrypted = needsReencrypt
      ? await this.contentCrypto.encryptForTenant({
          tenantId: current.tenantId,
          plaintext: String(nextContent ?? ""),
          purpose: "prompt",
          aad: promptAad(current.scopeType, current.scopeId, nextName)
        })
      : current.contentCiphertext;
    const result = await this.sql.query<PromptFragmentRow>(
      `update prompt_fragments
       set name = $2, content_ciphertext = $3, content_nonce = $4, content_tag = $5,
           content_key_id = $6, content_hash = $7, priority = $8,
           enabled = $9, version = $10, updated_at = now()
       where id = $1 and deleted_at is null
       returning *`,
      [
        id,
        nextName,
        encrypted.contentCiphertext,
        encrypted.contentNonce,
        encrypted.contentTag,
        encrypted.contentKeyId,
        encrypted.contentHash,
        nextPriority,
        nextEnabled,
        nextVersion
      ]
    );
    const updated = result.rows[0] ? promptFragmentFromRow(result.rows[0]) : null;
    if (updated && needsReencrypt) {
      await this.insertPromptFragmentVersion({
        ...tenantRecord(updated.tenantId),
        id: this.nextId("prompt_version"),
        promptFragmentId: updated.id,
        version: updated.version,
        contentCiphertext: encrypted,
        contentHash: encrypted.contentHash,
        createdBy: input.updatedBy
      });
    }
    return updated;
  }

  async deletePromptFragment(id: string): Promise<PromptFragment | null> {
    const result = await this.sql.query<PromptFragmentRow>(
      `update prompt_fragments
       set enabled = false, deleted_at = coalesce(deleted_at, now()), updated_at = now()
       where id = $1 and deleted_at is null
       returning *`,
      [id]
    );
    return result.rows[0] ? promptFragmentFromRow(result.rows[0]) : null;
  }

  async getPromptFragments(ids: string[]): Promise<PromptFragment[]> {
    if (ids.length === 0) {
      return [];
    }
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(",");
    const result = await this.sql.query<PromptFragmentRow>(
      `select * from prompt_fragments
       where id in (${placeholders}) and enabled = true and deleted_at is null`,
      ids
    );
    const byId = new Map(result.rows.map((row) => [row.id, promptFragmentFromRow(row)]));
    return ids.flatMap((id) => {
      const fragment = byId.get(id);
      return fragment ? [fragment] : [];
    });
  }

  async readPromptFragmentContent(fragment: PromptFragment): Promise<string> {
    const plaintext = await this.contentCrypto.decryptForTenant({
      tenantId: fragment.tenantId,
      blob: fragment.contentCiphertext,
      aad: promptAad(fragment.scopeType, fragment.scopeId, fragment.name)
    });
    return String(plaintext);
  }

  async createPromptCompilation(input: {
    tenantId: string;
    conversationId?: string | null;
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
    await this.sql.query(
      `insert into prompt_compilations (
        id, tenant_id, conversation_id, fragment_ids, fragment_versions, compiled_hash,
        content_ciphertext, content_nonce, content_tag, content_key_id, content_hash,
        retention_mode, created_at, updated_at, deleted_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        compilation.id,
        compilation.tenantId,
        compilation.conversationId,
        compilation.fragmentIds,
        compilation.fragmentVersions,
        compilation.compiledHash,
        encrypted?.contentCiphertext ?? null,
        encrypted?.contentNonce ?? null,
        encrypted?.contentTag ?? null,
        encrypted?.contentKeyId ?? null,
        encrypted?.contentHash ?? null,
        compilation.retentionMode,
        compilation.createdAt,
        compilation.updatedAt,
        compilation.deletedAt
      ]
    );
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
    await this.sql.query(
      `insert into conversations (id, tenant_id, user_id, title, retention_mode, created_at, updated_at, deleted_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        conversation.id,
        conversation.tenantId,
        conversation.userId,
        conversation.title,
        conversation.retentionMode,
        conversation.createdAt,
        conversation.updatedAt,
        conversation.deletedAt
      ]
    );
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
      aad: messageAad(input.conversationId, input.role)
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
    await this.sql.query(
      `insert into messages (
        id, tenant_id, conversation_id, user_id, role, content_ciphertext,
        content_nonce, content_tag, content_key_id, content_hash, retention_mode,
        created_at, updated_at, deleted_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        message.id,
        message.tenantId,
        message.conversationId,
        message.userId,
        message.role,
        encrypted.contentCiphertext,
        encrypted.contentNonce,
        encrypted.contentTag,
        encrypted.contentKeyId,
        encrypted.contentHash,
        message.retentionMode,
        message.createdAt,
        message.updatedAt,
        message.deletedAt
      ]
    );
    return message;
  }

  async listConversations(tenantId: string, userId: string): Promise<Conversation[]> {
    const result = await this.sql.query<ConversationRow>(
      `select * from conversations
       where tenant_id = $1 and user_id = $2 and deleted_at is null
       order by created_at desc`,
      [tenantId, userId]
    );
    return result.rows.map(conversationFromRow);
  }

  async listMessages(tenantId: string, conversationId: string): Promise<Array<Message & { content: string }>> {
    const result = await this.sql.query<MessageRow>(
      `select * from messages
       where tenant_id = $1 and conversation_id = $2 and deleted_at is null
       order by created_at asc`,
      [tenantId, conversationId]
    );
    const output: Array<Message & { content: string }> = [];
    for (const row of result.rows) {
      const message = messageFromRow(row);
      const content = await this.contentCrypto.decryptForTenant({
        tenantId,
        blob: message.contentCiphertext,
        aad: messageAad(message.conversationId, message.role)
      });
      output.push({ ...message, content: String(content) });
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
    const existing = await this.sql.query<RetentionPolicyRow>(
      `select * from retention_policies
       where tenant_id = $1 and subject_type = $2 and subject_id = $3 and deleted_at is null
       limit 1`,
      [input.tenantId, input.subjectType, input.subjectId]
    );
    const mandatoryRetentionMode = input.mandatoryRetentionMode ?? null;
    if (existing.rows[0]) {
      const updated = await this.sql.query<RetentionPolicyRow>(
        `update retention_policies
         set default_retention_mode = $2, mandatory_retention_mode = $3, updated_at = now()
         where id = $1 and deleted_at is null
         returning *`,
        [existing.rows[0].id, input.defaultRetentionMode, mandatoryRetentionMode]
      );
      return retentionPolicyFromRow(requiredRow(updated.rows[0], "updated retention policy"));
    }

    const inserted = await this.sql.query<RetentionPolicyRow>(
      `insert into retention_policies (
        id, tenant_id, subject_type, subject_id, default_retention_mode,
        mandatory_retention_mode
      ) values ($1,$2,$3,$4,$5,$6)
      returning *`,
      [
        this.nextId("retention_policy"),
        input.tenantId,
        input.subjectType,
        input.subjectId,
        input.defaultRetentionMode,
        mandatoryRetentionMode
      ]
    );
    return retentionPolicyFromRow(requiredRow(inserted.rows[0], "created retention policy"));
  }

  async getRetentionPolicy(input: { tenantId: string; subjectType: RetentionPolicyRecord["subjectType"]; subjectId: string }): Promise<RetentionPolicyRecord | null> {
    const result = await this.sql.query<RetentionPolicyRow>(
      `select * from retention_policies
       where tenant_id = $1 and subject_type = $2 and subject_id = $3 and deleted_at is null
       limit 1`,
      [input.tenantId, input.subjectType, input.subjectId]
    );
    return result.rows[0] ? retentionPolicyFromRow(result.rows[0]) : null;
  }

  async createToolPermission(input: Omit<ToolPermission, "id" | "createdAt" | "updatedAt" | "deletedAt">): Promise<ToolPermission> {
    const permission: ToolPermission = {
      ...tenantRecord(input.tenantId),
      id: this.nextId("tool_permission"),
      toolId: input.toolId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      permission: input.permission,
      requiresConfirmation: input.requiresConfirmation
    };
    await this.sql.query(
      `insert into tool_permissions (
        id, tenant_id, tool_id, subject_type, subject_id, permission,
        requires_confirmation, created_at, updated_at, deleted_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        permission.id,
        permission.tenantId,
        permission.toolId,
        permission.subjectType,
        permission.subjectId,
        permission.permission,
        permission.requiresConfirmation,
        permission.createdAt,
        permission.updatedAt,
        permission.deletedAt
      ]
    );
    return permission;
  }

  async listToolPermissions(tenantId: string): Promise<ToolPermission[]> {
    const result = await this.sql.query<ToolPermissionRow>(
      "select * from tool_permissions where tenant_id = $1 and deleted_at is null",
      [tenantId]
    );
    return result.rows.map(toolPermissionFromRow);
  }

  async createMcpServer(input: Omit<McpServer, "id" | "createdAt" | "updatedAt">): Promise<McpServer> {
    const result = await this.sql.query<McpServerRow>(
      `insert into mcp_servers (
        id, name, description, transport_type, server_url, container_image,
        command, args_json, env_secret_refs_json, risk_level,
        retention_policy_class, enabled
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      returning *`,
      [
        this.nextId("mcp_server"),
        input.name,
        input.description,
        input.transportType,
        input.serverUrl,
        input.containerImage,
        input.command,
        input.argsJson,
        input.envSecretRefsJson,
        input.riskLevel,
        input.retentionPolicyClass,
        input.enabled
      ]
    );
    return mcpServerFromRow(requiredRow(result.rows[0], "created MCP server"));
  }

  async createPluginInstallation(input: Omit<PluginInstallation, "id" | "createdAt" | "updatedAt" | "deletedAt" | "configCiphertext"> & { config?: string | null }): Promise<PluginInstallation> {
    const configCiphertext =
      input.config && input.config.length > 0
        ? await this.contentCrypto.encryptForTenant({
            tenantId: input.tenantId,
            plaintext: input.config,
            purpose: "secret",
            aad: pluginInstallationAad(input.mcpServerId, input.scopeId)
          })
        : null;
    const result = await this.sql.query<PluginInstallationRow>(
      `insert into plugin_installations (
        id, tenant_id, scope_type, scope_id, mcp_server_id,
        content_ciphertext, content_nonce, content_tag, content_key_id,
        content_hash, enabled, installed_by, approved_by, retention_mode
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      returning *`,
      [
        this.nextId("plugin_installation"),
        input.tenantId,
        input.scopeType,
        input.scopeId,
        input.mcpServerId,
        configCiphertext?.contentCiphertext ?? null,
        configCiphertext?.contentNonce ?? null,
        configCiphertext?.contentTag ?? null,
        configCiphertext?.contentKeyId ?? null,
        configCiphertext?.contentHash ?? null,
        input.enabled,
        input.installedBy,
        input.approvedBy,
        "retained"
      ]
    );
    return pluginInstallationFromRow(requiredRow(result.rows[0], "created plugin installation"));
  }

  async updatePluginInstallation(id: string, input: { enabled?: boolean; approvedBy?: string | null }): Promise<PluginInstallation | null> {
    const existing = await this.sql.query<PluginInstallationRow>("select * from plugin_installations where id = $1 and deleted_at is null limit 1", [id]);
    if (!existing.rows[0]) {
      return null;
    }
    const current = pluginInstallationFromRow(existing.rows[0]);
    const result = await this.sql.query<PluginInstallationRow>(
      `update plugin_installations
       set enabled = $2, approved_by = $3, updated_at = now()
       where id = $1 and deleted_at is null
       returning *`,
      [id, input.enabled ?? current.enabled, input.approvedBy ?? current.approvedBy]
    );
    return result.rows[0] ? pluginInstallationFromRow(result.rows[0]) : null;
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
            aad: toolAad("tool_invocation_args", input.requestId, input.toolId)
          })
        : null;
    const resultCiphertextNullable =
      input.result && input.retention.canStoreToolPayloads
        ? await this.contentCrypto.encryptForTenant({
            tenantId: input.tenantId,
            plaintext: JSON.stringify(input.result),
            purpose: "tool",
            aad: toolAad("tool_invocation_result", input.requestId, input.toolId)
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
    await this.sql.query(
      `insert into tool_invocations (
        id, tenant_id, user_id, conversation_id, request_id, tool_id, status,
        args_ciphertext_nullable, result_ciphertext_nullable, metadata_json,
        retention_mode, created_at, updated_at, deleted_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        invocation.id,
        invocation.tenantId,
        invocation.userId,
        invocation.conversationId,
        invocation.requestId,
        invocation.toolId,
        invocation.status,
        argsCiphertextNullable,
        resultCiphertextNullable,
        invocation.metadataJson,
        invocation.retentionMode,
        invocation.createdAt,
        invocation.updatedAt,
        invocation.deletedAt
      ]
    );
    return invocation;
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
    await this.sql.query(
      `insert into audit_events (
        id, tenant_id, user_id, type, request_id, metadata_json,
        content_json, retention_mode, audit_content_mode, created_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        event.id,
        event.tenantId,
        event.userId,
        event.type,
        event.requestId ?? null,
        event.metadata,
        event.content,
        event.retentionMode,
        event.auditContentMode,
        event.createdAt
      ]
    );
    return event;
  }

  async createPolicySnapshot(input: {
    tenantId: string;
    userId: string;
    conversationId?: string | null;
    policyHash: string;
    selectedProviderId: string;
    selectedModelId: string;
    retentionMode: string;
    reasonsJson: Record<string, unknown>[];
  }): Promise<{ id: string }> {
    const id = this.nextId("policy_snapshot");
    await this.sql.query(
      `insert into effective_policy_snapshots (
        id, tenant_id, user_id, conversation_id, policy_hash, selected_provider_id,
        selected_model_id, retention_mode, reasons_json
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        input.tenantId,
        input.userId,
        input.conversationId ?? null,
        input.policyHash,
        input.selectedProviderId,
        input.selectedModelId,
        input.retentionMode,
        input.reasonsJson
      ]
    );
    return { id };
  }

  async snapshot(): Promise<DatabaseSnapshot> {
    const [
      tenants,
      users,
      memberships,
      identityProviders,
      providers,
      providerCredentials,
      models,
      userProviderPreferences,
      prompts,
      promptVersions,
      promptCompilations,
      retentionPolicies,
      effectivePolicySnapshots,
      conversations,
      messages,
      messageParts,
      attachments,
      mcpServers,
      pluginInstallations,
      toolPermissions,
      toolInvocations,
      auditEvents,
      encryptionKeys,
      backgroundJobs
    ] = await Promise.all([
      this.sql.query<TenantRow>("select * from tenants order by created_at asc"),
      this.sql.query<UserRow>("select * from users order by created_at asc"),
      this.sql.query<TenantMembershipRow>("select * from tenant_memberships order by created_at asc"),
      this.sql.query<IdentityProviderRow>("select * from identity_providers order by created_at asc"),
      this.sql.query<ProviderConfigRow>("select * from provider_configs order by created_at asc"),
      this.sql.query<ProviderCredentialRow>("select * from provider_credentials order by created_at asc"),
      this.sql.query<ModelConfigRow>("select * from model_configs order by created_at asc"),
      this.sql.query<UserProviderPreferenceRow>("select * from user_provider_preferences order by created_at asc"),
      this.sql.query<PromptFragmentRow>("select * from prompt_fragments order by created_at asc"),
      this.sql.query<PromptFragmentVersionRow>("select * from prompt_fragment_versions order by created_at asc"),
      this.sql.query<PromptCompilationRow>("select * from prompt_compilations order by created_at asc"),
      this.sql.query<RetentionPolicyRow>("select * from retention_policies order by created_at asc"),
      this.sql.query<EffectivePolicySnapshotRow>("select * from effective_policy_snapshots order by created_at asc"),
      this.sql.query<ConversationRow>("select * from conversations order by created_at asc"),
      this.sql.query<MessageRow>("select * from messages order by created_at asc"),
      this.sql.query<MessagePartRow>("select * from message_parts order by created_at asc"),
      this.sql.query<AttachmentRow>("select * from attachments order by created_at asc"),
      this.sql.query<McpServerRow>("select * from mcp_servers order by created_at asc"),
      this.sql.query<PluginInstallationRow>("select * from plugin_installations order by created_at asc"),
      this.sql.query<ToolPermissionRow>("select * from tool_permissions order by created_at asc"),
      this.sql.query<ToolInvocationRow>("select * from tool_invocations order by created_at asc"),
      this.sql.query<AuditEventRow>("select * from audit_events order by created_at asc"),
      this.sql.query<EncryptionKeyRow>("select * from encryption_keys order by created_at asc"),
      this.sql.query<BackgroundJobRow>("select * from background_jobs order by created_at asc")
    ]);

    return {
      tenants: tenants.rows.map(tenantFromRow),
      users: users.rows.map(userFromRow),
      tenantMemberships: memberships.rows.map(membershipFromRow),
      identityProviders: identityProviders.rows.map(identityProviderFromRow),
      providerConfigs: providers.rows.map(providerConfigFromRow),
      providerCredentials: providerCredentials.rows.map(providerCredentialFromRow),
      modelConfigs: models.rows.map(modelConfigFromRow),
      userProviderPreferences: userProviderPreferences.rows.map(userProviderPreferenceFromRow),
      promptFragments: prompts.rows.map(promptFragmentFromRow),
      promptFragmentVersions: promptVersions.rows.map(promptFragmentVersionFromRow),
      promptCompilations: promptCompilations.rows.map(promptCompilationFromRow),
      retentionPolicies: retentionPolicies.rows.map(retentionPolicyFromRow),
      effectivePolicySnapshots: effectivePolicySnapshots.rows.map(effectivePolicySnapshotFromRow),
      conversations: conversations.rows.map(conversationFromRow),
      messages: messages.rows.map(messageFromRow),
      messageParts: messageParts.rows.map(messagePartFromRow),
      attachments: attachments.rows.map(attachmentFromRow),
      mcpServers: mcpServers.rows.map(mcpServerFromRow),
      pluginInstallations: pluginInstallations.rows.map(pluginInstallationFromRow),
      toolPermissions: toolPermissions.rows.map(toolPermissionFromRow),
      toolInvocations: toolInvocations.rows.map(toolInvocationFromRow),
      auditEvents: auditEvents.rows.map(auditEventFromRow),
      encryptionKeys: encryptionKeys.rows.map(encryptionKeyFromRow),
      backgroundJobs: backgroundJobs.rows.map(backgroundJobFromRow)
    };
  }

  async rawSearch(needle: string): Promise<boolean> {
    const tables = [
      "tenants",
      "users",
      "tenant_memberships",
      "identity_providers",
      "provider_configs",
      "provider_credentials",
      "model_configs",
      "user_provider_preferences",
      "prompt_fragments",
      "prompt_fragment_versions",
      "prompt_compilations",
      "retention_policies",
      "effective_policy_snapshots",
      "conversations",
      "messages",
      "message_parts",
      "attachments",
      "mcp_servers",
      "plugin_installations",
      "tool_permissions",
      "tool_invocations",
      "audit_events",
      "background_jobs",
      "encryption_keys"
    ];
    for (const table of tables) {
      const result = await this.sql.query(`select * from ${table}`);
      if (JSON.stringify(result.rows).includes(needle)) {
        return true;
      }
    }
    return false;
  }

  private async insertPromptFragment(fragment: PromptFragment): Promise<void> {
    await this.sql.query(
      `insert into prompt_fragments (
        id, tenant_id, scope_type, scope_id, name, content_ciphertext,
        content_nonce, content_tag, content_key_id, content_hash, priority,
        enabled, version, created_by, retention_mode, created_at, updated_at, deleted_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        fragment.id,
        fragment.tenantId,
        fragment.scopeType,
        fragment.scopeId,
        fragment.name,
        fragment.contentCiphertext.contentCiphertext,
        fragment.contentCiphertext.contentNonce,
        fragment.contentCiphertext.contentTag,
        fragment.contentCiphertext.contentKeyId,
        fragment.contentHash,
        fragment.priority,
        fragment.enabled,
        fragment.version,
        fragment.createdBy,
        "retained",
        fragment.createdAt,
        fragment.updatedAt,
        fragment.deletedAt
      ]
    );
  }

  private async insertPromptFragmentVersion(version: PromptFragmentVersion): Promise<void> {
    await this.sql.query(
      `insert into prompt_fragment_versions (
        id, tenant_id, prompt_fragment_id, version, content_ciphertext,
        content_nonce, content_tag, content_key_id, content_hash, created_by,
        retention_mode, created_at, updated_at, deleted_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        version.id,
        version.tenantId,
        version.promptFragmentId,
        version.version,
        version.contentCiphertext.contentCiphertext,
        version.contentCiphertext.contentNonce,
        version.contentCiphertext.contentTag,
        version.contentCiphertext.contentKeyId,
        version.contentHash,
        version.createdBy,
        "retained",
        version.createdAt,
        version.updatedAt,
        version.deletedAt
      ]
    );
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}_sql_${this.idCounter.toString().padStart(6, "0")}_${randomUUID().replaceAll("-", "")}`;
  }
}

function tenantRecord(tenantId: string) {
  const now = new Date();
  return {
    tenantId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };
}

function tenantFromRow(row: TenantRow): Tenant {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    primaryDomain: row.primary_domain,
    allowedHostnames: stringArray(row.allowed_hostnames),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: nullableDate(row.deleted_at)
  };
}

function userFromRow(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at)
  };
}

function membershipFromRow(row: TenantMembershipRow): TenantMembership {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    role: row.role,
    externalSubject: row.external_subject,
    externalGroupsJson: stringArray(row.external_groups_json),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: nullableDate(row.deleted_at)
  };
}

function identityProviderFromRow(row: IdentityProviderRow): IdentityProvider {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    providerType: row.provider_type,
    issuerUrl: row.issuer_url,
    clientId: row.client_id,
    clientSecretRef: row.client_secret_ref,
    allowedEmailDomains: stringArray(row.allowed_email_domains),
    claimMappingJson: stringRecord(row.claim_mapping_json),
    enabled: row.enabled,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: nullableDate(row.deleted_at)
  };
}

function providerConfigFromRow(row: ProviderConfigRow): ProviderConfig {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    providerType: row.provider_type,
    displayName: row.display_name,
    baseUrl: row.base_url,
    authMode: row.auth_mode,
    credentialRef: row.credential_ref,
    retentionPolicyClass: row.retention_policy_class,
    supportsStreaming: row.supports_streaming,
    supportsToolCalling: row.supports_tool_calling,
    supportsJsonSchema: row.supports_json_schema,
    supportsEmbeddings: row.supports_embeddings,
    enabled: row.enabled,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: nullableDate(row.deleted_at)
  };
}

function providerCredentialFromRow(row: ProviderCredentialRow): ProviderCredential {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    providerConfigId: row.provider_config_id,
    userId: row.user_id,
    credentialRef: row.credential_ref,
    credentialCiphertext: encryptedBlobFromRow(row),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: nullableDate(row.deleted_at)
  };
}

function modelConfigFromRow(row: ModelConfigRow): ModelConfig {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    providerConfigId: row.provider_config_id,
    modelKey: row.model_key,
    displayName: row.display_name,
    contextWindow: row.context_window,
    maxOutputTokens: row.max_output_tokens,
    supportsTools: row.supports_tools,
    supportsStreaming: row.supports_streaming,
    supportsJsonSchema: row.supports_json_schema,
    inputModalitiesJson: stringArray(row.input_modalities_json),
    outputModalitiesJson: stringArray(row.output_modalities_json),
    enabled: row.enabled,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: nullableDate(row.deleted_at)
  };
}

function userProviderPreferenceFromRow(row: UserProviderPreferenceRow): UserProviderPreference {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    defaultProviderId: row.default_provider_id,
    defaultModelId: row.default_model_id,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: nullableDate(row.deleted_at)
  };
}

function promptFragmentFromRow(row: PromptFragmentRow): PromptFragment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    name: row.name,
    contentCiphertext: encryptedBlobFromRow(row),
    contentHash: row.content_hash,
    priority: row.priority,
    enabled: row.enabled,
    version: row.version,
    createdBy: row.created_by,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: nullableDate(row.deleted_at)
  };
}

function promptFragmentVersionFromRow(row: PromptFragmentVersionRow): PromptFragmentVersion {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    promptFragmentId: row.prompt_fragment_id,
    version: row.version,
    contentCiphertext: encryptedBlobFromRow(row),
    contentHash: row.content_hash,
    createdBy: row.created_by,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: nullableDate(row.deleted_at)
  };
}

function promptCompilationFromRow(row: PromptCompilationRow): PromptCompilation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    fragmentIds: stringArray(row.fragment_ids),
    fragmentVersions: numberArray(row.fragment_versions),
    compiledHash: row.compiled_hash,
    compiledPromptCiphertext: encryptedBlobFromNullableRow(row),
    retentionMode: row.retention_mode,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: nullableDate(row.deleted_at)
  };
}

function retentionPolicyFromRow(row: RetentionPolicyRow): RetentionPolicyRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    defaultRetentionMode: row.default_retention_mode,
    mandatoryRetentionMode: row.mandatory_retention_mode,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: nullableDate(row.deleted_at)
  };
}

function effectivePolicySnapshotFromRow(row: EffectivePolicySnapshotRow): EffectivePolicySnapshot {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    policyHash: row.policy_hash,
    selectedProviderId: row.selected_provider_id,
    selectedModelId: row.selected_model_id,
    retentionMode: row.retention_mode,
    reasonsJson: jsonArray(row.reasons_json),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: nullableDate(row.deleted_at)
  };
}

function conversationFromRow(row: ConversationRow): Conversation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    title: row.title,
    retentionMode: row.retention_mode,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: nullableDate(row.deleted_at)
  };
}

function messagePartFromRow(row: MessagePartRow): MessagePart {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    messageId: row.message_id,
    type: row.type,
    contentCiphertext: encryptedBlobFromNullableRow(row),
    contentHash: row.content_hash,
    contentKeyId: row.content_key_id,
    retentionMode: row.retention_mode,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: nullableDate(row.deleted_at)
  };
}

function attachmentFromRow(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    objectKey: row.object_key,
    metadataJson: jsonRecord(row.metadata_json),
    contentHash: row.content_hash,
    contentKeyId: row.content_key_id,
    retentionMode: row.retention_mode,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: nullableDate(row.deleted_at)
  };
}

function mcpServerFromRow(row: McpServerRow): McpServer {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    transportType: row.transport_type,
    serverUrl: row.server_url,
    containerImage: row.container_image,
    command: row.command,
    argsJson: stringArray(row.args_json),
    envSecretRefsJson: stringArray(row.env_secret_refs_json),
    riskLevel: row.risk_level,
    retentionPolicyClass: row.retention_policy_class,
    enabled: row.enabled,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at)
  };
}

function pluginInstallationFromRow(row: PluginInstallationRow): PluginInstallation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    mcpServerId: row.mcp_server_id,
    configCiphertext: encryptedBlobFromNullableRow(row),
    enabled: row.enabled,
    installedBy: row.installed_by,
    approvedBy: row.approved_by,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: nullableDate(row.deleted_at)
  };
}

function messageFromRow(row: MessageRow): Message {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    role: row.role,
    contentCiphertext: encryptedBlobFromRow(row),
    contentHash: row.content_hash,
    contentKeyId: row.content_key_id,
    retentionMode: row.retention_mode,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: nullableDate(row.deleted_at)
  };
}

function backgroundJobFromRow(row: BackgroundJobRow): BackgroundJob {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    queue: row.queue,
    status: row.status,
    payloadJson: row.payload_json == null ? null : jsonRecord(row.payload_json),
    metadataJson: jsonRecord(row.metadata_json),
    retentionMode: row.retention_mode,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: nullableDate(row.deleted_at)
  };
}

function toolPermissionFromRow(row: ToolPermissionRow): ToolPermission {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    toolId: row.tool_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    permission: row.permission,
    requiresConfirmation: row.requires_confirmation,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: nullableDate(row.deleted_at)
  };
}

function toolInvocationFromRow(row: ToolInvocationRow): ToolInvocation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    requestId: row.request_id,
    toolId: row.tool_id,
    status: row.status,
    argsCiphertextNullable: encryptedBlobNullable(row.args_ciphertext_nullable),
    resultCiphertextNullable: encryptedBlobNullable(row.result_ciphertext_nullable),
    metadataJson: jsonRecord(row.metadata_json),
    retentionMode: row.retention_mode,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    deletedAt: nullableDate(row.deleted_at)
  };
}

function auditEventFromRow(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    type: row.type,
    ...(row.request_id ? { requestId: row.request_id } : {}),
    metadata: jsonRecord(row.metadata_json),
    content: row.content_json == null ? null : jsonRecord(row.content_json),
    retentionMode: row.retention_mode,
    auditContentMode: row.audit_content_mode,
    createdAt: date(row.created_at)
  };
}

function encryptionKeyFromRow(row: EncryptionKeyRow): EncryptionKeyMetadata {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    keyPurpose: row.key_purpose,
    wrappedDek: row.wrapped_dek,
    kmsProvider: row.kms_provider,
    kmsKeyId: row.kms_key_id,
    status: row.status,
    createdAt: date(row.created_at),
    rotatedAt: nullableDate(row.rotated_at),
    disabledAt: nullableDate(row.disabled_at)
  };
}

function encryptedBlobFromRow(row: EncryptedContentRow): EncryptedBlob {
  return {
    contentCiphertext: row.content_ciphertext,
    contentNonce: row.content_nonce,
    contentTag: row.content_tag,
    contentKeyId: row.content_key_id,
    contentHash: row.content_hash,
    algorithm: "aes-256-gcm"
  };
}

function encryptedBlobFromNullableRow(row: NullableEncryptedContentRow): EncryptedBlob | null {
  if (row.content_ciphertext == null || row.content_nonce == null || row.content_tag == null || row.content_key_id == null || row.content_hash == null) {
    return null;
  }
  return encryptedBlobFromRow({
    content_ciphertext: row.content_ciphertext,
    content_nonce: row.content_nonce,
    content_tag: row.content_tag,
    content_key_id: row.content_key_id,
    content_hash: row.content_hash
  });
}

function encryptedBlobNullable(value: unknown): EncryptedBlob | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return JSON.parse(value) as EncryptedBlob;
  }
  return value as EncryptedBlob;
}

function promptAad(scopeType: string, scopeId: string, name: string): Record<string, string> {
  return {
    record_type: "prompt_fragment",
    scope_type: scopeType,
    scope_id: scopeId,
    name
  };
}

function messageAad(conversationId: string, role: string): Record<string, string> {
  return {
    record_type: "message",
    conversation_id: conversationId,
    role
  };
}

function toolAad(recordType: string, requestId: string, toolId: string): Record<string, string> {
  return {
    record_type: recordType,
    request_id: requestId,
    tool_id: toolId
  };
}

function providerCredentialAad(providerConfigId: string, credentialRef: string): Record<string, string> {
  return {
    record_type: "provider_credential",
    provider_config_id: providerConfigId,
    credential_ref: credentialRef
  };
}

function pluginInstallationAad(mcpServerId: string, scopeId: string): Record<string, string> {
  return {
    record_type: "plugin_installation",
    mcp_server_id: mcpServerId,
    scope_id: scopeId
  };
}

function requiredRow<T>(row: T | undefined, label: string): T {
  if (!row) {
    throw new Error(`Missing ${label}`);
  }
  return row;
}

function date(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function nullableDate(value: unknown): Date | null {
  return value == null ? null : date(value);
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === "string") {
    return JSON.parse(value) as string[];
  }
  return [];
}

function numberArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map(Number);
  }
  if (typeof value === "string") {
    return (JSON.parse(value) as unknown[]).map(Number);
  }
  return [];
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (value == null) {
    return {};
  }
  if (typeof value === "string") {
    return JSON.parse(value) as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function stringRecord(value: unknown): Record<string, string> {
  const record = jsonRecord(value);
  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function jsonArray(value: unknown): Record<string, unknown>[] {
  if (value == null) {
    return [];
  }
  if (typeof value === "string") {
    return JSON.parse(value) as Record<string, unknown>[];
  }
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  primary_domain: string | null;
  allowed_hostnames: unknown;
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  created_at: unknown;
  updated_at: unknown;
};

type TenantMembershipRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  role: TenantMembership["role"];
  external_subject: string | null;
  external_groups_json: unknown;
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type IdentityProviderRow = {
  id: string;
  tenant_id: string;
  provider_type: IdentityProvider["providerType"];
  issuer_url: string;
  client_id: string;
  client_secret_ref: string;
  allowed_email_domains: unknown;
  claim_mapping_json: unknown;
  enabled: boolean;
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type ProviderConfigRow = {
  id: string;
  tenant_id: string;
  scope_type: ProviderConfig["scopeType"];
  scope_id: string;
  provider_type: ProviderConfig["providerType"];
  display_name: string;
  base_url: string | null;
  auth_mode: ProviderConfig["authMode"];
  credential_ref: string | null;
  retention_policy_class: ProviderConfig["retentionPolicyClass"];
  supports_streaming: boolean;
  supports_tool_calling: boolean;
  supports_json_schema: boolean;
  supports_embeddings: boolean;
  enabled: boolean;
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type ProviderCredentialRow = EncryptedContentRow & {
  id: string;
  tenant_id: string;
  provider_config_id: string;
  user_id: string | null;
  credential_ref: string;
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type ModelConfigRow = {
  id: string;
  tenant_id: string;
  provider_config_id: string;
  model_key: string;
  display_name: string;
  context_window: number;
  max_output_tokens: number;
  supports_tools: boolean;
  supports_streaming: boolean;
  supports_json_schema: boolean;
  input_modalities_json: unknown;
  output_modalities_json: unknown;
  enabled: boolean;
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type UserProviderPreferenceRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  default_provider_id: string;
  default_model_id: string;
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type EncryptedContentRow = {
  content_ciphertext: string;
  content_nonce: string;
  content_tag: string;
  content_key_id: string;
  content_hash: string;
};

type NullableEncryptedContentRow = {
  content_ciphertext: string | null;
  content_nonce: string | null;
  content_tag: string | null;
  content_key_id: string | null;
  content_hash: string | null;
};

type PromptFragmentRow = EncryptedContentRow & {
  id: string;
  tenant_id: string;
  scope_type: PromptFragment["scopeType"];
  scope_id: string;
  name: string;
  priority: number;
  enabled: boolean;
  version: number;
  created_by: string;
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type PromptFragmentVersionRow = EncryptedContentRow & {
  id: string;
  tenant_id: string;
  prompt_fragment_id: string;
  version: number;
  created_by: string;
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type PromptCompilationRow = NullableEncryptedContentRow & {
  id: string;
  tenant_id: string;
  conversation_id: string | null;
  fragment_ids: unknown;
  fragment_versions: unknown;
  compiled_hash: string;
  retention_mode: PromptCompilation["retentionMode"];
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type RetentionPolicyRow = {
  id: string;
  tenant_id: string;
  subject_type: RetentionPolicyRecord["subjectType"];
  subject_id: string;
  default_retention_mode: RetentionPolicyRecord["defaultRetentionMode"];
  mandatory_retention_mode: RetentionPolicyRecord["mandatoryRetentionMode"];
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type EffectivePolicySnapshotRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  conversation_id: string | null;
  policy_hash: string;
  selected_provider_id: string;
  selected_model_id: string;
  retention_mode: EffectivePolicySnapshot["retentionMode"];
  reasons_json: unknown;
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type ConversationRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string;
  retention_mode: Conversation["retentionMode"];
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type MessagePartRow = NullableEncryptedContentRow & {
  id: string;
  tenant_id: string;
  message_id: string;
  type: MessagePart["type"];
  retention_mode: MessagePart["retentionMode"];
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type AttachmentRow = {
  id: string;
  tenant_id: string;
  conversation_id: string;
  object_key: string | null;
  metadata_json: unknown;
  content_hash: string | null;
  content_key_id: string | null;
  retention_mode: Attachment["retentionMode"];
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type McpServerRow = {
  id: string;
  name: string;
  description: string;
  transport_type: McpServer["transportType"];
  server_url: string | null;
  container_image: string | null;
  command: string | null;
  args_json: unknown;
  env_secret_refs_json: unknown;
  risk_level: McpServer["riskLevel"];
  retention_policy_class: McpServer["retentionPolicyClass"];
  enabled: boolean;
  created_at: unknown;
  updated_at: unknown;
};

type PluginInstallationRow = NullableEncryptedContentRow & {
  id: string;
  tenant_id: string;
  scope_type: PluginInstallation["scopeType"];
  scope_id: string;
  mcp_server_id: string;
  enabled: boolean;
  installed_by: string;
  approved_by: string | null;
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type MessageRow = EncryptedContentRow & {
  id: string;
  tenant_id: string;
  conversation_id: string;
  user_id: string;
  role: Message["role"];
  retention_mode: Message["retentionMode"];
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type BackgroundJobRow = {
  id: string;
  tenant_id: string;
  queue: string;
  status: BackgroundJob["status"];
  payload_json: unknown;
  metadata_json: unknown;
  retention_mode: BackgroundJob["retentionMode"];
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type ToolPermissionRow = {
  id: string;
  tenant_id: string;
  tool_id: string;
  subject_type: ToolPermission["subjectType"];
  subject_id: string;
  permission: ToolPermission["permission"];
  requires_confirmation: boolean;
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type ToolInvocationRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  conversation_id: string | null;
  request_id: string;
  tool_id: string;
  status: ToolInvocation["status"];
  args_ciphertext_nullable: unknown;
  result_ciphertext_nullable: unknown;
  metadata_json: unknown;
  retention_mode: ToolInvocation["retentionMode"];
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type AuditEventRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  type: AuditEventType;
  request_id: string | null;
  metadata_json: unknown;
  content_json: unknown;
  retention_mode: AuditEvent["retentionMode"];
  audit_content_mode: AuditEvent["auditContentMode"];
  created_at: unknown;
};

type EncryptionKeyRow = {
  id: string;
  tenant_id: string;
  key_purpose: EncryptionKeyMetadata["keyPurpose"];
  wrapped_dek: WrappedKey;
  kms_provider: string;
  kms_key_id: string;
  status: EncryptionKeyMetadata["status"];
  created_at: unknown;
  rotated_at: unknown;
  disabled_at: unknown;
};
