import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { createLocalContentCrypto } from "@agent-platform/crypto";
import { uniqueSentinel } from "@agent-platform/test-utils";

const requiredTables = [
  "tenants",
  "users",
  "tenant_memberships",
  "identity_providers",
  "roles",
  "permissions",
  "role_permissions",
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
  "platform_plugin_installations",
  "tool_permissions",
  "tool_invocations",
  "audit_events",
  "encryption_keys",
  "background_jobs"
];

describe("postgres migration", () => {
  it("executes the baseline schema and creates every required table", async () => {
    const db = await migratedDb();
    const result = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name"
    );
    const tables = result.rows.map((row) => row.table_name);

    expect(tables).toEqual(requiredTables.slice().sort());
  });

  it("supports tenant-scoped encrypted retained messages without raw plaintext columns", async () => {
    const db = await migratedDb();
    const { crypto } = createLocalContentCrypto("migration-test-master-key");
    const sentinel = uniqueSentinel("MIGRATION_RETAINED_SECRET");
    const encrypted = await crypto.encryptForTenant({
      tenantId: "tenant_sql",
      plaintext: sentinel,
      purpose: "message",
      aad: {
        record_type: "message",
        conversation_id: "conversation_sql",
        role: "user"
      }
    });

    await seedTenantUserConversation(db);
    await db.query(
      `insert into messages (
        id, tenant_id, conversation_id, user_id, role, content_ciphertext, content_nonce,
        content_tag, content_key_id, content_hash, retention_mode
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        "message_sql",
        "tenant_sql",
        "conversation_sql",
        "user_sql",
        "user",
        encrypted.contentCiphertext,
        encrypted.contentNonce,
        encrypted.contentTag,
        encrypted.contentKeyId,
        encrypted.contentHash,
        "retained"
      ]
    );

    const raw = await db.query("select * from messages");
    expect(JSON.stringify(raw.rows)).not.toContain(sentinel);
    expect(Object.keys(raw.rows[0] ?? {})).not.toContain("content");
  });

  it("supports metadata-only ephemeral audit and null job payloads", async () => {
    const db = await migratedDb();
    const sentinel = uniqueSentinel();
    await seedTenantUserConversation(db);

    await db.query(
      `insert into audit_events (
        id, tenant_id, user_id, type, request_id, metadata_json, content_json,
        retention_mode, audit_content_mode
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        "audit_sql",
        "tenant_sql",
        "user_sql",
        "chat.completed",
        "request_sql",
        { provider_id: "mock", token_counts: { input: 1, output: 1 } },
        null,
        "ephemeral",
        "metadata_only"
      ]
    );
    await db.query(
      `insert into background_jobs (
        id, tenant_id, queue, status, payload_json, metadata_json, retention_mode
      ) values ($1,$2,$3,$4,$5,$6,$7)`,
      ["job_sql", "tenant_sql", "chat", "queued", null, { sentinel_hash: "metadata-only" }, "ephemeral"]
    );

    const audit = await db.query("select * from audit_events");
    const jobs = await db.query("select * from background_jobs");
    expect(audit.rows[0]).toMatchObject({
      retention_mode: "ephemeral",
      audit_content_mode: "metadata_only",
      content_json: null
    });
    expect(jobs.rows[0]).toMatchObject({
      retention_mode: "ephemeral",
      payload_json: null
    });
    expect(JSON.stringify({ audit: audit.rows, jobs: jobs.rows })).not.toContain(sentinel);
  });
});

async function migratedDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(await readFile("db/migrations/0001_initial.sql", "utf8"));
  return db;
}

async function seedTenantUserConversation(db: PGlite): Promise<void> {
  await db.query(
    "insert into tenants (id, slug, name, allowed_hostnames) values ($1,$2,$3,$4) on conflict do nothing",
    ["tenant_sql", "sql", "SQL Tenant", []]
  );
  await db.query(
    "insert into users (id, email, display_name) values ($1,$2,$3) on conflict do nothing",
    ["user_sql", "sql@example.test", "SQL User"]
  );
  await db.query(
    `insert into conversations (id, tenant_id, user_id, title, retention_mode)
     values ($1,$2,$3,$4,$5) on conflict do nothing`,
    ["conversation_sql", "tenant_sql", "user_sql", "SQL Chat", "retained"]
  );
}
