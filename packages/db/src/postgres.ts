import { Pool, type QueryResultRow } from "pg";
import type { SqlExecutor, SqlQueryResult } from "./sql";

export class PgSqlExecutor implements SqlExecutor {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl
    });
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlQueryResult<T>> {
    const result = await this.pool.query<QueryResultRow>(sql, params.map(normalizeParam));
    return {
      rows: result.rows as T[]
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function normalizeParam(value: unknown): unknown {
  if (Array.isArray(value) || isPlainObject(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}
