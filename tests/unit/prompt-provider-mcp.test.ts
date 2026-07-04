import { describe, expect, it } from "vitest";
import { compileEffectivePolicy } from "@agent-platform/policy";
import { compilePromptStack } from "@agent-platform/prompts";
import { buildRetentionContext } from "@agent-platform/retention";
import { MockProvider, ProviderGateway } from "@agent-platform/providers";
import { createTestRuntime } from "@agent-platform/test-utils";
import { HttpMcpTransportAdapter, StdioMcpTransportAdapter } from "@agent-platform/mcp-gateway";

describe("prompt compiler", () => {
  it("compiles fragments in deterministic priority order", () => {
    const prompt = compilePromptStack([
      { id: "user", scopeType: "user", name: "User", content: "User prompt", priority: 10, version: 1 },
      { id: "tenant", scopeType: "tenant", name: "Tenant", content: "Tenant prompt", priority: 100, version: 1 }
    ]);

    expect(prompt.fragmentIds).toEqual(["tenant", "user"]);
    expect(prompt.systemMessages[0]?.content).toBe("Tenant prompt");
  });
});

describe("provider gateway", () => {
  it("selects an allowed provider and rejects disallowed provider/model requests", async () => {
    const gateway = new ProviderGateway();
    gateway.register(new MockProvider());
    const policy = compileEffectivePolicy(
      {
        deploymentMode: "single_company",
        tenantId: "tenant_1",
        userId: "user_1",
        groupIds: []
      },
      {
        platform: {
          allowedProviderIds: ["mock"],
          allowedModelIds: ["mock-chat"],
          defaultProviderId: "mock",
          defaultModelId: "mock-chat"
        },
        tenant: {
          allowedProviderIds: ["mock"],
          allowedModelIds: ["mock-chat"]
        }
      },
      {
        providers: [{ id: "mock", modelIds: ["mock-chat"], enabled: true }],
        toolIds: []
      }
    );

    const result = await gateway.completeChat(policy, {
      requestId: "req_1",
      tenantId: "tenant_1",
      userId: "user_1",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      retention: buildRetentionContext("retained")
    });
    expect(result.content).toContain("hello");

    expect(() =>
      gateway.resolve({
        ...policy,
        selectedProviderId: "disallowed"
      })
    ).toThrow("not allowed");
  });
});

describe("mcp gateway", () => {
  it("runs allowed mock tools, denies disallowed tools, and gates dangerous tools", async () => {
    const runtime = await createTestRuntime();
    const user = runtime.devUser;
    const allowedPolicy = compileEffectivePolicy(
      {
        deploymentMode: runtime.config.deploymentMode,
        tenantId: runtime.tenant.id,
        userId: user.id,
        groupIds: [],
        requestedToolIds: ["mock.read_context"]
      },
      runtime.policyDocuments,
      runtime.inventory
    );

    const allowed = await runtime.mcp.executeTool({
      tenantId: runtime.tenant.id,
      userId: user.id,
      requestId: "req_tool_allowed",
      toolId: "mock.read_context",
      args: { query: "policy" },
      policy: allowedPolicy,
      retention: buildRetentionContext("retained")
    });
    expect(allowed.status).toBe("completed");

    const denied = await runtime.mcp.executeTool({
      tenantId: runtime.tenant.id,
      userId: user.id,
      requestId: "req_tool_denied",
      toolId: "not.installed",
      args: {},
      policy: allowedPolicy,
      retention: buildRetentionContext("retained")
    });
    expect(denied.status).toBe("denied");

    const dangerousPolicy = compileEffectivePolicy(
      {
        deploymentMode: runtime.config.deploymentMode,
        tenantId: runtime.tenant.id,
        userId: user.id,
        groupIds: [],
        requestedToolIds: ["mock.dangerous_action"]
      },
      runtime.policyDocuments,
      runtime.inventory
    );
    const dangerous = await runtime.mcp.executeTool({
      tenantId: runtime.tenant.id,
      userId: user.id,
      requestId: "req_tool_dangerous",
      toolId: "mock.dangerous_action",
      args: {},
      policy: dangerousPolicy,
      retention: buildRetentionContext("retained")
    });
    expect(dangerous.status).toBe("requires_confirmation");
  });

  it("keeps HTTP and stdio MCP transports disabled behind explicit adapter boundaries", async () => {
    const http = new HttpMcpTransportAdapter({
      serverUrl: "https://mcp.example.test",
      allowExternalExecution: false
    });
    const stdio = new StdioMcpTransportAdapter({
      command: "dangerous-local-command",
      args: [],
      allowLocalProcessExecution: false
    });

    await expect(http.listTools()).rejects.toThrow("disabled by default");
    await expect(stdio.invokeTool({ toolId: "tool", args: {} })).rejects.toThrow("disabled by default");
  });
});
