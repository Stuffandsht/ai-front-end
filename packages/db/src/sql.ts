import { createAuditEvent, type AuditEvent, type AuditEventType } from "@agent-platform/audit";
import type { ContentCrypto, EncryptedBlob, EncryptionKeyMetadata, EncryptionKeyStore, WrappedKey } from "@agent-platform/crypto";
import type { RetentionContext } from "@agent-platform/retention";
import type {
  Conversation,
  Message,
  PromptCompilation,
  PromptFragment,
  PromptFragmentVersion,
  Tenant,
  TenantMembership,
  ToolInvocation,
  ToolPermission,
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

  async createProviderConfig(input: {
    tenantId: string;
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
  }): Promise<{ id: string }> {
    const id = input.providerType === "mock" ? "mock" : this.nextId("provider");
    await this.sql.query(
      `insert into provider_configs (
        id, tenant_id, scope_type, scope_id, provider_type, display_name, base_url,
        auth_mode, credential_ref, retention_policy_class, supports_streaming,
        supports_tool_calling, supports_json_schema, supports_embeddings, enabled
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      on conflict (id) do nothing`,
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
    return { id };
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
  }): Promise<{ id: string }> {
    const id = `${input.providerConfigId}:${input.modelKey}`;
    await this.sql.query(
      `insert into model_configs (
        id, tenant_id, provider_config_id, model_key, display_name, context_window,
        max_output_tokens, supports_tools, supports_streaming, supports_json_schema,
        input_modalities_json, output_modalities_json, enabled
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      on conflict (id) do nothing`,
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
    return { id };
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

  async rawSearch(needle: string): Promise<boolean> {
    const tables = [
      "tenants",
      "users",
      "tenant_memberships",
      "provider_credentials",
      "prompt_fragments",
      "prompt_compilations",
      "conversations",
      "messages",
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
    return `${prefix}_sql_${this.idCounter.toString().padStart(6, "0")}`;
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

type EncryptedContentRow = {
  content_ciphertext: string;
  content_nonce: string;
  content_tag: string;
  content_key_id: string;
  content_hash: string;
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
