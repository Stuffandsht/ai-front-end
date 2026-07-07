import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
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
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: { serverUrl: string; allowExternalExecution: boolean; fetchImpl?: typeof fetch }) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async listTools(): Promise<Array<Pick<ToolDefinition, "id" | "name" | "description" | "riskLevel" | "requiresConfirmation">>> {
    if (!this.config.allowExternalExecution) {
      throw new Error("HTTP MCP transport is disabled by default until explicitly enabled by service policy");
    }
    const response = await this.fetchImpl(new URL("/tools", normalizedServerUrl(this.config.serverUrl)));
    const payload = await readJsonResponse(response, "HTTP MCP tool list");
    return normalizeToolList(payload);
  }

  async invokeTool(args: { toolId: string; args: Record<string, unknown> }): Promise<Record<string, unknown>> {
    if (!this.config.allowExternalExecution) {
      throw new Error("HTTP MCP transport is disabled by default until explicitly enabled by service policy");
    }
    const response = await this.fetchImpl(new URL(`/tools/${encodeURIComponent(args.toolId)}/invoke`, normalizedServerUrl(this.config.serverUrl)), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ args: args.args })
    });
    const payload = await readJsonResponse(response, `HTTP MCP tool ${args.toolId}`);
    return normalizeToolResult(payload);
  }
}

export class StdioMcpTransportAdapter implements McpTransportAdapter {
  readonly transportType = "stdio" as const;

  constructor(private readonly config: { command: string; args: string[]; allowLocalProcessExecution: boolean; timeoutMs?: number }) {}

  async listTools(): Promise<Array<Pick<ToolDefinition, "id" | "name" | "description" | "riskLevel" | "requiresConfirmation">>> {
    if (!this.config.allowLocalProcessExecution) {
      throw new Error("stdio MCP transport is disabled by default and will not execute local commands in MVP");
    }
    return normalizeToolList(await this.call({ method: "tools/list" }));
  }

  async invokeTool(args: { toolId: string; args: Record<string, unknown> }): Promise<Record<string, unknown>> {
    if (!this.config.allowLocalProcessExecution) {
      throw new Error("stdio MCP transport is disabled by default and will not execute local commands in MVP");
    }
    return normalizeToolResult(
      await this.call({
        method: "tools/call",
        params: {
          name: args.toolId,
          arguments: args.args
        }
      })
    );
  }

  private async call(payload: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child: ChildProcessWithoutNullStreams = spawn(this.config.command, this.config.args, {
        stdio: ["pipe", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`stdio MCP command timed out: ${this.config.command}`));
      }, this.config.timeoutMs ?? 5000);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code: number | null) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`stdio MCP command failed with exit ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          reject(new Error(`stdio MCP command returned invalid JSON: ${stdout.slice(0, 500)}`));
        }
      });
      child.stdin.end(`${JSON.stringify(payload)}\n`);
    });
  }
}

function normalizedServerUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("HTTP MCP server URL must use http or https");
  }
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}

async function readJsonResponse(response: Response, label: string): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? (JSON.parse(text) as unknown) : {};
}

function normalizeToolList(payload: unknown): Array<Pick<ToolDefinition, "id" | "name" | "description" | "riskLevel" | "requiresConfirmation">> {
  const tools = Array.isArray(payload) ? payload : payload && typeof payload === "object" && "tools" in payload && Array.isArray(payload.tools) ? payload.tools : [];
  return tools.flatMap((tool) => {
    if (!tool || typeof tool !== "object") {
      return [];
    }
    const record = tool as Record<string, unknown>;
    const id = stringValue(record["id"] ?? record["name"]);
    const name = stringValue(record["name"] ?? id);
    if (!id || !name) {
      return [];
    }
    return [
      {
        id,
        name,
        description: stringValue(record["description"]) ?? "",
        riskLevel: riskLevel(record["riskLevel"] ?? record["risk_level"]),
        requiresConfirmation: Boolean(record["requiresConfirmation"] ?? record["requires_confirmation"])
      }
    ];
  });
}

function normalizeToolResult(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object" && "result" in payload) {
    const result = (payload as Record<string, unknown>)["result"];
    return result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : { value: result };
  }
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : { value: payload };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function riskLevel(value: unknown): ToolDefinition["riskLevel"] {
  return value === "medium" || value === "high" ? value : "low";
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
