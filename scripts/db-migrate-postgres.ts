import { readFile } from "node:fs/promises";
import { readAppConfig } from "@agent-platform/config";
import { PgSqlExecutor } from "@agent-platform/db";

const config = readAppConfig();
const sql = new PgSqlExecutor(config.databaseUrl);

try {
  const existing = await sql.query<{ exists: boolean }>("select to_regclass('public.tenants') is not null as exists");
  if (existing.rows[0]?.exists) {
    await ensureIncrementalSchema(sql);
    const result = await countPublicTables(sql);
    console.log(`Postgres baseline already present at ${redactDatabaseUrl(config.databaseUrl)}; public tables: ${result}`);
    process.exitCode = 0;
  } else {
    const migration = await readFile(new URL("../db/migrations/0001_initial.sql", import.meta.url), "utf8");
    await sql.query(migration);
    await ensureIncrementalSchema(sql);
    const result = await countPublicTables(sql);
    console.log(`Applied baseline migration to Postgres at ${redactDatabaseUrl(config.databaseUrl)}; public tables: ${result}`);
  }
} finally {
  await sql.close();
}

async function ensureIncrementalSchema(sql: PgSqlExecutor): Promise<void> {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS platform_plugin_installations (
      id text PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id),
      scope_type text NOT NULL,
      scope_id text NOT NULL,
      plugin_id text NOT NULL,
      manifest_json jsonb NOT NULL,
      content_ciphertext text,
      content_nonce text,
      content_tag text,
      content_key_id text,
      content_hash text,
      enabled boolean NOT NULL DEFAULT true,
      installed_by text NOT NULL REFERENCES users(id),
      approved_by text REFERENCES users(id),
      retention_mode text NOT NULL DEFAULT 'retained',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    )
  `);
}

async function countPublicTables(sql: PgSqlExecutor): Promise<string> {
  const result = await sql.query<{ table_count: string }>(
    "select count(*)::text as table_count from information_schema.tables where table_schema = 'public'"
  );
  return result.rows[0]?.table_count ?? "0";
}

function redactDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.password) {
      url.password = "redacted";
    }
    return url.toString();
  } catch {
    return "[redacted database url]";
  }
}
