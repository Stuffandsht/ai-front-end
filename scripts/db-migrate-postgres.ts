import { readFile } from "node:fs/promises";
import { readAppConfig } from "@agent-platform/config";
import { PgSqlExecutor } from "@agent-platform/db";

const config = readAppConfig();
const sql = new PgSqlExecutor(config.databaseUrl);

try {
  const existing = await sql.query<{ exists: boolean }>("select to_regclass('public.tenants') is not null as exists");
  if (existing.rows[0]?.exists) {
    const result = await countPublicTables(sql);
    console.log(`Postgres baseline already present at ${redactDatabaseUrl(config.databaseUrl)}; public tables: ${result}`);
    process.exitCode = 0;
  } else {
    const migration = await readFile(new URL("../db/migrations/0001_initial.sql", import.meta.url), "utf8");
    await sql.query(migration);
    const result = await countPublicTables(sql);
    console.log(`Applied baseline migration to Postgres at ${redactDatabaseUrl(config.databaseUrl)}; public tables: ${result}`);
  }
} finally {
  await sql.close();
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
