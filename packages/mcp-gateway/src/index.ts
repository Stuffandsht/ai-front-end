import type { ToolInvocation, ToolPermission } from "@agent-platform/db";
import type { EffectivePolicy } from "@agent-platform/policy";
import type { RetentionContext } from "@agent-platform/retention";

type MaybePromise<T> = T | Promise<T>;

export type McpGatewayDatabase = {
  createToolInvocation(input: {
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
  }): MaybePromise<ToolInvocation>;
  listToolPermissions(tenantId: string): MaybePromise<ToolPermission[]>;
};

export type ToolDefinition = {
  id: string;
  name: string;
  description: string;
  riskLevel: "low" | "medium" | "high";
  requiresConfirmation: boolean;
  execute: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

export type McpTransportAdapter = {
  readonly transportType: "http" | "stdio";
  listTools(): Promise<Array<Pick<ToolDefinition, "id" | "name" | "description" | "riskLevel" | "requiresConfirmation">>>;
  invokeTool(args: { toolId: string; args: Record<string, unknown> }): Promise<Record<string, unknown>>;
};

export class HttpMcpTransportAdapter implements McpTransportAdapter {
  readonly transportType = "http" as const;

  constructor(private readonly config: { serverUrl: string; allowExternalExecution: boolean }) {}

  async listTools(): Promise<Array<Pick<ToolDefinition, "id" | "name" | "description" | "riskLevel" | "requiresConfirmation">>> {
    if (!this.config.allowExternalExecution) {
      throw new Error("HTTP MCP transport is disabled by default until explicitly enabled by service policy");
    }
    throw new Error(`HTTP MCP protocol client is not implemented for ${this.config.serverUrl}`);
  }

  async invokeTool(_args: { toolId: string; args: Record<string, unknown> }): Promise<Record<string, unknown>> {
    if (!this.config.allowExternalExecution) {
      throw new Error("HTTP MCP transport is disabled by default until explicitly enabled by service policy");
    }
    throw new Error(`HTTP MCP protocol client is not implemented for ${this.config.serverUrl}`);
  }
}

export class StdioMcpTransportAdapter implements McpTransportAdapter {
  readonly transportType = "stdio" as const;

  constructor(private readonly config: { command: string; args: string[]; allowLocalProcessExecution: boolean }) {}

  async listTools(): Promise<Array<Pick<ToolDefinition, "id" | "name" | "description" | "riskLevel" | "requiresConfirmation">>> {
    if (!this.config.allowLocalProcessExecution) {
      throw new Error("stdio MCP transport is disabled by default and will not execute local commands in MVP");
    }
    throw new Error(`stdio MCP protocol client is not implemented for ${this.config.command}`);
  }

  async invokeTool(_args: { toolId: string; args: Record<string, unknown> }): Promise<Record<string, unknown>> {
    if (!this.config.allowLocalProcessExecution) {
      throw new Error("stdio MCP transport is disabled by default and will not execute local commands in MVP");
    }
    throw new Error(`stdio MCP protocol client is not implemented for ${this.config.command}`);
  }
}

export type ToolExecutionRequest = {
  tenantId: string;
  userId: string;
  conversationId?: string | null;
  requestId: string;
  toolId: string;
  args: Record<string, unknown>;
  confirmed?: boolean;
  policy: EffectivePolicy;
  retention: RetentionContext;
};

export type ToolExecutionResult =
  | {
      status: "completed";
      toolId: string;
      result: Record<string, unknown>;
      invocation: ToolInvocation;
    }
  | {
      status: "denied" | "requires_confirmation";
      toolId: string;
      reason: string;
      invocation: ToolInvocation;
    };

export class McpGateway {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(private readonly db: McpGatewayDatabase) {}

  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.id, tool);
  }

  listTools(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  async executeTool(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const tool = this.tools.get(request.toolId);
    if (!tool) {
      return this.denied(request, `Tool ${request.toolId} is not registered`);
    }
    if (!request.policy.enabledToolIds.includes(request.toolId) || !request.policy.allowedToolIds.includes(request.toolId)) {
      return this.denied(request, `Tool ${request.toolId} is not allowed by effective policy`);
    }

    const permission = await this.findPermission(request.tenantId, request.userId, request.toolId);
    if (!permission) {
      return this.denied(request, `Tool ${request.toolId} is not permitted for this user or tenant`);
    }

    const needsConfirmation = tool.requiresConfirmation || permission.requiresConfirmation;
    if (needsConfirmation && !request.confirmed) {
      const invocation = await this.db.createToolInvocation({
        tenantId: request.tenantId,
        userId: request.userId,
        conversationId: request.conversationId,
        requestId: request.requestId,
        toolId: request.toolId,
        status: "requires_confirmation",
        args: request.args,
        result: null,
        metadata: {
          toolName: tool.name,
          riskLevel: tool.riskLevel
        },
        retention: request.retention
      });
      return {
        status: "requires_confirmation",
        toolId: request.toolId,
        reason: `Tool ${request.toolId} requires confirmation`,
        invocation
      };
    }

    try {
      const result = await tool.execute(request.args);
      const invocation = await this.db.createToolInvocation({
        tenantId: request.tenantId,
        userId: request.userId,
        conversationId: request.conversationId,
        requestId: request.requestId,
        toolId: request.toolId,
        status: "completed",
        args: request.args,
        result,
        metadata: {
          toolName: tool.name,
          riskLevel: tool.riskLevel
        },
        retention: request.retention
      });
      return {
        status: "completed",
        toolId: request.toolId,
        result,
        invocation
      };
    } catch (error) {
      const invocation = await this.db.createToolInvocation({
        tenantId: request.tenantId,
        userId: request.userId,
        conversationId: request.conversationId,
        requestId: request.requestId,
        toolId: request.toolId,
        status: "failed",
        args: request.args,
        result: null,
        metadata: {
          errorClass: error instanceof Error ? error.name : "UnknownError"
        },
        retention: request.retention
      });
      return {
        status: "denied",
        toolId: request.toolId,
        reason: "Tool execution failed",
        invocation
      };
    }
  }

  private async denied(request: ToolExecutionRequest, reason: string): Promise<ToolExecutionResult> {
    const invocation = await this.db.createToolInvocation({
      tenantId: request.tenantId,
      userId: request.userId,
      conversationId: request.conversationId,
      requestId: request.requestId,
      toolId: request.toolId,
      status: "denied",
      args: request.args,
      result: null,
      metadata: {
        reason
      },
      retention: request.retention
    });
    return {
      status: "denied",
      toolId: request.toolId,
      reason,
      invocation
    };
  }

  private async findPermission(tenantId: string, userId: string, toolId: string): Promise<ToolPermission | null> {
    const permissions = (await this.db.listToolPermissions(tenantId)).filter((permission) => permission.toolId === toolId && permission.permission === "use");
    return (
      permissions.find((permission) => permission.subjectType === "user" && permission.subjectId === userId) ??
      permissions.find((permission) => permission.subjectType === "tenant" && permission.subjectId === tenantId) ??
      null
    );
  }
}

export function createMockTools(): ToolDefinition[] {
  return [
    {
      id: "mock.read_context",
      name: "Read Context",
      description: "Returns deterministic read-only context for tests and local development.",
      riskLevel: "low",
      requiresConfirmation: false,
      execute: async (args) => ({
        context: `mock context for ${String(args["query"] ?? "request")}`,
        source: "mock"
      })
    },
    {
      id: "mock.dangerous_action",
      name: "Dangerous Action",
      description: "A mock high-risk tool used to verify confirmation gates.",
      riskLevel: "high",
      requiresConfirmation: true,
      execute: async () => ({
        status: "confirmed-noop"
      })
    }
  ];
}
