import { access, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationPath = new URL("../db/migrations/0001_initial.sql", import.meta.url);

await access(migrationPath);
const sql = await readFile(migrationPath, "utf8");

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
  "tool_permissions",
  "tool_invocations",
  "audit_events",
  "encryption_keys",
  "background_jobs"
];

const missing = requiredTables.filter((table) => !sql.includes(`CREATE TABLE ${table}`));
if (missing.length > 0) {
  console.error(`Migration is missing required tables: ${missing.join(", ")}`);
  process.exit(1);
}

const db = new PGlite();
await db.exec(sql);
const result = await db.query(
  "select table_name from information_schema.tables where table_schema = 'public' order by table_name"
);
const migratedTables = new Set(result.rows.map((row) => String(row.table_name)));
const missingMigratedTables = requiredTables.filter((table) => !migratedTables.has(table));
if (missingMigratedTables.length > 0) {
  console.error(`Migration did not create required tables: ${missingMigratedTables.join(", ")}`);
  process.exit(1);
}

console.log(`Executed migration and verified ${requiredTables.length} required tables in embedded Postgres-compatible database`);
