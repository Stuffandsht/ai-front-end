export type RetentionMode = "retained" | "limited" | "ephemeral";

export type AuditContentMode = "full" | "redacted" | "metadata_only";

export type RetentionContext = {
  mode: RetentionMode;
  canStoreContent: boolean;
  canStoreToolPayloads: boolean;
  canStoreEmbeddings: boolean;
  canStoreDebugTraces: boolean;
  auditContentMode: AuditContentMode;
};

export const retentionRank: Record<RetentionMode, number> = {
  ephemeral: 0,
  limited: 1,
  retained: 2
};

export function isRetentionMode(value: string | undefined): value is RetentionMode {
  return value === "retained" || value === "limited" || value === "ephemeral";
}

export function stricterRetentionMode(a: RetentionMode, b: RetentionMode): RetentionMode {
  return retentionRank[a] <= retentionRank[b] ? a : b;
}

export function isStricterOrEqual(candidate: RetentionMode, ceiling: RetentionMode): boolean {
  return retentionRank[candidate] <= retentionRank[ceiling];
}

export function buildRetentionContext(mode: RetentionMode): RetentionContext {
  if (mode === "ephemeral") {
    return {
      mode,
      canStoreContent: false,
      canStoreToolPayloads: false,
      canStoreEmbeddings: false,
      canStoreDebugTraces: false,
      auditContentMode: "metadata_only"
    };
  }

  if (mode === "limited") {
    return {
      mode,
      canStoreContent: true,
      canStoreToolPayloads: false,
      canStoreEmbeddings: false,
      canStoreDebugTraces: false,
      auditContentMode: "redacted"
    };
  }

  return {
    mode,
    canStoreContent: true,
    canStoreToolPayloads: true,
    canStoreEmbeddings: true,
    canStoreDebugTraces: true,
    auditContentMode: "full"
  };
}

export function requireContentStorage(ctx: RetentionContext, operation: string): void {
  if (!ctx.canStoreContent) {
    throw new Error(`${operation} cannot store content while retention mode is ${ctx.mode}`);
  }
}

export function retainedOnly<T>(ctx: RetentionContext, value: T): T | null {
  return ctx.canStoreContent ? value : null;
}

export function redactToolPayloadForRetention<T>(ctx: RetentionContext, payload: T): T | null {
  return ctx.canStoreToolPayloads ? payload : null;
}
