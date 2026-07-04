import type { RetentionContext } from "@agent-platform/retention";

export type AuditEventType =
  | "auth.login"
  | "auth.denied"
  | "policy.evaluated"
  | "provider.selected"
  | "provider.denied"
  | "prompt.compiled"
  | "chat.completed"
  | "tool.invoked"
  | "tool.denied"
  | "retention.selected"
  | "admin.changed";

export type AuditEvent = {
  id: string;
  tenantId: string;
  userId: string;
  type: AuditEventType;
  requestId?: string;
  metadata: Record<string, unknown>;
  content: Record<string, unknown> | null;
  retentionMode: RetentionContext["mode"];
  auditContentMode: RetentionContext["auditContentMode"];
  createdAt: Date;
};

export function createAuditEvent(args: {
  id: string;
  tenantId: string;
  userId: string;
  type: AuditEventType;
  requestId?: string;
  metadata: Record<string, unknown>;
  content?: Record<string, unknown>;
  retention: RetentionContext;
}): AuditEvent {
  return {
    id: args.id,
    tenantId: args.tenantId,
    userId: args.userId,
    type: args.type,
    ...(args.requestId ? { requestId: args.requestId } : {}),
    metadata: scrubSecrets(args.metadata),
    content: contentForRetention(args.retention, args.content),
    retentionMode: args.retention.mode,
    auditContentMode: args.retention.auditContentMode,
    createdAt: new Date()
  };
}

export function scrubSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    const scrubbed = (value as unknown[]).map((item) => scrubSecrets(item));
    return scrubbed as T;
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(key)) {
        output[key] = "[redacted]";
      } else {
        output[key] = scrubSecrets(raw);
      }
    }
    return output as T;
  }

  return value;
}

function contentForRetention(ctx: RetentionContext, content: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!content) {
    return null;
  }
  if (ctx.auditContentMode === "full") {
    return scrubSecrets(content);
  }
  if (ctx.auditContentMode === "redacted") {
    return {
      redacted: true,
      keys: Object.keys(content)
    };
  }
  return null;
}

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.includes("secret") || normalized.includes("token") || normalized.includes("password") || normalized.includes("api_key") || normalized.includes("apikey") || normalized.includes("credential");
}
