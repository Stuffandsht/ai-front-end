import { describe, expect, it } from "vitest";
import { compileEffectivePolicy } from "@agent-platform/policy";
import { compilePromptStack } from "@agent-platform/prompts";
import { buildRetentionContext } from "@agent-platform/retention";
import { MockProvider, OpenAICompatibleProvider, OpenRouterProvider, ProviderGateway } from "@agent-platform/providers";
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

  it("calls an OpenAI-compatible provider and redacts provider errors", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const provider = new OpenAICompatibleProvider({
      id: "tenant-openai",
      baseUrl: "https://provider.example/v1",
      apiKey: "sk-secret",
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          authorization: new Headers(init?.headers).get("authorization")
        });
        return new Response(
          JSON.stringify({
            id: "chatcmpl_1",
            model: "gpt-compatible",
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: "provider response",
                  tool_calls: [
                    {
                      id: "call_1",
                      function: {
                        name: "mock.read_context",
                        arguments: "{\"query\":\"docs\"}"
                      }
                    }
                  ]
                }
              }
            ],
            usage: {
              prompt_tokens: 3,
              completion_tokens: 4
            }
          })
        );
      }
    });

    const result = await provider.completeChat({
      requestId: "req_openai",
      tenantId: "tenant_1",
      userId: "user_1",
      providerId: "tenant-openai",
      modelId: "gpt-compatible",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ id: "mock.read_context", description: "Read context" }],
      retention: buildRetentionContext("retained")
    });

    expect(requests[0]).toEqual({ url: "https://provider.example/v1/chat/completions", authorization: "Bearer sk-secret" });
    expect(result.content).toBe("provider response");
    expect(result.toolCalls[0]?.args).toEqual({ query: "docs" });
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 4 });

    const failing = new OpenAICompatibleProvider({
      id: "tenant-openai",
      baseUrl: "https://provider.example/v1",
      apiKey: "sk-secret",
      fetchImpl: async () => new Response("bad sk-secret", { status: 401 })
    });
    await expect(
      failing.completeChat({
        requestId: "req_openai_fail",
        tenantId: "tenant_1",
        userId: "user_1",
        providerId: "tenant-openai",
        modelId: "gpt-compatible",
        messages: [{ role: "user", content: "hello" }],
        tools: [],
        retention: buildRetentionContext("retained")
      })
    ).rejects.toThrow("[redacted]");
  });

  it("calls OpenRouter with attribution headers, retention routing, and tool compatibility", async () => {
    const requests: Array<{ url: string; authorization: string | null; referer: string | null; title: string | null; body: Record<string, unknown> }> = [];
    const provider = new OpenRouterProvider({
      id: "tenant-openrouter",
      apiKey: "or-secret",
      appUrl: "https://ai.example.test",
      appTitle: "Example AI",
      fetchImpl: async (url, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(url),
          authorization: headers.get("authorization"),
          referer: headers.get("HTTP-Referer"),
          title: headers.get("X-OpenRouter-Title"),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>
        });
        return new Response(
          JSON.stringify({
            id: "gen_1",
            model: "anthropic/claude-sonnet-4.5",
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: "provider response",
                  tool_calls: [
                    {
                      id: "call_1",
                      function: {
                        name: "mock.read_context",
                        arguments: "{\"query\":\"docs\"}"
                      }
                    }
                  ]
                }
              }
            ],
            usage: {
              prompt_tokens: 3,
              completion_tokens: 4,
              cost: 0.001
            }
          })
        );
      }
    });

    const result = await provider.completeChat({
      requestId: "req_openrouter",
      tenantId: "tenant_1",
      userId: "user_1",
      providerId: "tenant-openrouter",
      modelId: "anthropic/claude-sonnet-4.5",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ id: "mock.read_context", description: "Read context" }],
      retention: buildRetentionContext("ephemeral")
    });

    expect(requests[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(requests[0]?.authorization).toBe("Bearer or-secret");
    expect(requests[0]?.referer).toBe("https://ai.example.test");
    expect(requests[0]?.title).toBe("Example AI");
    expect(requests[0]?.body["provider"]).toEqual({ data_collection: "deny", zdr: true });
    expect(JSON.stringify(requests[0]?.body["tools"])).toContain("mock.read_context");
    expect(result.providerMetadata).toMatchObject({ provider: "openrouter", responseId: "gen_1", cost: 0.001 });
    expect(result.toolCalls[0]).toMatchObject({ id: "call_1", toolId: "mock.read_context", args: { query: "docs" } });

    const failing = new OpenRouterProvider({
      apiKey: "or-secret",
      fetchImpl: async () => new Response("bad or-secret", { status: 401 })
    });
    await expect(
      failing.completeChat({
        requestId: "req_openrouter_fail",
        tenantId: "tenant_1",
        userId: "user_1",
        providerId: "openrouter",
        modelId: "openai/gpt-4o",
        messages: [{ role: "user", content: "hello" }],
        tools: [],
        retention: buildRetentionContext("retained")
      })
    ).rejects.toThrow("[redacted]");
  });

  it("lists OpenRouter models and parses streaming chat chunks", async () => {
    const provider = new OpenRouterProvider({
      apiKey: "or-secret",
      fetchImpl: async (url) => {
        if (String(url).endsWith("/models")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "openai/gpt-4o",
                  name: "GPT-4o",
                  context_length: 128000,
                  top_provider: { max_completion_tokens: 4096 },
                  supported_parameters: ["tools", "response_format"],
                  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
                  pricing: { prompt: "0.000005", completion: "0.000015" }
                }
              ]
            })
          );
        }
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"id":"gen_stream","model":"openai/gpt-4o","choices":[{"delta":{"content":"Hello "}}]}\n\n'));
              controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"world"}}],"usage":{"prompt_tokens":2,"completion_tokens":3}}\n\n'));
              controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
              controller.close();
            }
          })
        );
      }
    });

    await expect(provider.listModels()).resolves.toEqual([
      {
        id: "openai/gpt-4o",
        displayName: "GPT-4o",
        contextWindow: 128000,
        maxOutputTokens: 4096,
        supportsTools: true,
        supportsStreaming: true,
        supportsJsonSchema: true,
        inputModalities: ["text"],
        outputModalities: ["text"],
        pricing: { prompt: "0.000005", completion: "0.000015" }
      }
    ]);

    const events = [];
    for await (const event of provider.streamChat({
      requestId: "req_stream",
      tenantId: "tenant_1",
      userId: "user_1",
      providerId: "openrouter",
      modelId: "openai/gpt-4o",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      retention: buildRetentionContext("retained")
    })) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: "delta", delta: "Hello " },
      { type: "delta", delta: "world" },
      {
        type: "done",
        result: {
          content: "Hello world",
          toolCalls: [],
          usage: { inputTokens: 2, outputTokens: 3 },
          providerMetadata: {
            provider: "openrouter",
            responseId: "gen_stream",
            model: "openai/gpt-4o",
            finishReason: null
          }
        }
      }
    ]);
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

  it("runs enabled HTTP and stdio MCP adapters through constrained JSON protocols", async () => {
    const http = new HttpMcpTransportAdapter({
      serverUrl: "https://mcp.example.test",
      allowExternalExecution: true,
      fetchImpl: async (url, init) => {
        if (String(url).endsWith("/tools")) {
          return new Response(JSON.stringify({ tools: [{ id: "remote.search", name: "Search", description: "Search", riskLevel: "low" }] }));
        }
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({ result: { ok: true } }));
      }
    });
    expect(await http.listTools()).toEqual([
      {
        id: "remote.search",
        name: "Search",
        description: "Search",
        riskLevel: "low",
        requiresConfirmation: false
      }
    ]);
    expect(await http.invokeTool({ toolId: "remote.search", args: { query: "policy" } })).toEqual({ ok: true });

    const script = `payload=$(cat)
case "$payload" in
  *tools/list*) printf '%s' '{"tools":[{"id":"stdio.echo","name":"Echo","description":"Echo","riskLevel":"low"}]}' ;;
  *) printf '%s' '{"result":{"ok":true}}' ;;
esac`;
    const stdio = new StdioMcpTransportAdapter({
      command: "/bin/sh",
      args: ["-c", script],
      allowLocalProcessExecution: true
    });
    expect((await stdio.listTools())[0]?.id).toBe("stdio.echo");
    expect(await stdio.invokeTool({ toolId: "stdio.echo", args: { text: "hello" } })).toEqual({
      ok: true
    });
  });
});
