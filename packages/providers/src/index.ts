import { scrubSecrets } from "@agent-platform/audit";
import type { EffectivePolicy } from "@agent-platform/policy";
import type { RetentionContext } from "@agent-platform/retention";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
};

export type ToolCallRequest = {
  id: string;
  toolId: string;
  args: Record<string, unknown>;
};

export type ChatCompletionRequest = {
  requestId: string;
  tenantId: string;
  userId: string;
  providerId: string;
  modelId: string;
  messages: ChatMessage[];
  tools: Array<{
    id: string;
    description: string;
  }>;
  retention: RetentionContext;
};

export type ChatCompletionResult = {
  content: string;
  toolCalls: ToolCallRequest[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  providerMetadata: Record<string, unknown>;
};

export type ChatCompletionStreamEvent =
  | {
      type: "delta";
      delta: string;
    }
  | {
      type: "tool_call";
      toolCall: ToolCallRequest;
    }
  | {
      type: "done";
      result: ChatCompletionResult;
    };

export type EmbeddingRequest = {
  input: string[];
  modelId: string;
};

export type EmbeddingResult = {
  embeddings: number[][];
};

export type ModelDescriptor = {
  id: string;
  displayName: string;
  supportsTools: boolean;
  supportsStreaming: boolean;
};

export interface InferenceProvider {
  id: string;
  completeChat(args: ChatCompletionRequest): Promise<ChatCompletionResult>;
  streamChat(args: ChatCompletionRequest): AsyncIterable<ChatCompletionStreamEvent>;
  embed?(args: EmbeddingRequest): Promise<EmbeddingResult>;
  listModels?(): Promise<ModelDescriptor[]>;
}

export class MockProvider implements InferenceProvider {
  readonly id = "mock";

  async completeChat(args: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const userMessage = [...args.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const systemNames = args.messages.filter((message) => message.role === "system").map((message) => message.name ?? "system");
    const toolCalls: ToolCallRequest[] = [];
    if (userMessage.toLowerCase().includes("tool") && args.tools.length > 0) {
      const tool = args.tools[0];
      if (tool) {
        toolCalls.push({
          id: `toolcall_${args.requestId}`,
          toolId: tool.id,
          args: {
            query: userMessage.slice(0, 80)
          }
        });
      }
    }
    return {
      content: `Mock response (${args.modelId})${systemNames.length ? ` with ${systemNames.join(", ")}` : ""}: ${userMessage}`,
      toolCalls,
      usage: {
        inputTokens: estimateTokens(args.messages.map((message) => message.content).join(" ")),
        outputTokens: estimateTokens(userMessage) + 4
      },
      providerMetadata: {
        provider: "mock",
        retentionMode: args.retention.mode
      }
    };
  }

  async *streamChat(args: ChatCompletionRequest): AsyncIterable<ChatCompletionStreamEvent> {
    const result = await this.completeChat(args);
    for (const part of chunkText(result.content, 16)) {
      yield {
        type: "delta",
        delta: part
      };
    }
    for (const toolCall of result.toolCalls) {
      yield {
        type: "tool_call",
        toolCall
      };
    }
    yield {
      type: "done",
      result
    };
  }

  async listModels(): Promise<ModelDescriptor[]> {
    return [
      {
        id: "mock-chat",
        displayName: "Mock Chat",
        supportsTools: true,
        supportsStreaming: true
      },
      {
        id: "mock-chat-fast",
        displayName: "Mock Chat Fast",
        supportsTools: true,
        supportsStreaming: true
      }
    ];
  }
}

export class OpenAICompatibleProvider implements InferenceProvider {
  readonly id: string;

  constructor(
    args: {
      id: string;
      baseUrl: string;
      apiKey: string;
    }
  ) {
    this.id = args.id;
    this.baseUrl = args.baseUrl.replace(/\/$/, "");
    this.apiKey = args.apiKey;
  }

  private readonly baseUrl: string;
  private readonly apiKey: string;

  buildChatRequest(args: ChatCompletionRequest): {
    url: string;
    init: {
      method: "POST";
      headers: Record<string, string>;
      body: string;
    };
  } {
    return {
      url: `${this.baseUrl}/chat/completions`,
      init: {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: args.modelId,
          messages: args.messages.map((message) => ({
            role: message.role,
            content: message.content,
            name: message.name
          })),
          stream: false,
          tools: args.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.id,
              description: tool.description,
              parameters: {
                type: "object"
              }
            }
          }))
        })
      }
    };
  }

  async completeChat(_args: ChatCompletionRequest): Promise<ChatCompletionResult> {
    throw this.redactError(new Error("OpenAI-compatible network execution is disabled without configured credentials and fetch wiring"));
  }

  async *streamChat(args: ChatCompletionRequest): AsyncIterable<ChatCompletionStreamEvent> {
    const result = await this.completeChat(args);
    yield {
      type: "done",
      result
    };
  }

  redactError(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    return new Error(message.replaceAll(this.apiKey, "[redacted]").replaceAll(this.baseUrl, this.baseUrl));
  }
}

export type ProviderGatewayResult = {
  provider: InferenceProvider;
  providerId: string;
  modelId: string;
};

export class ProviderGateway {
  private readonly providers = new Map<string, InferenceProvider>();

  register(provider: InferenceProvider): void {
    this.providers.set(provider.id, provider);
  }

  resolve(policy: EffectivePolicy): ProviderGatewayResult {
    if (!policy.allowedProviderIds.includes(policy.selectedProviderId)) {
      throw new Error(`Provider ${policy.selectedProviderId} is not allowed`);
    }
    if (!policy.allowedModelIds.includes(policy.selectedModelId)) {
      throw new Error(`Model ${policy.selectedModelId} is not allowed`);
    }
    const provider = this.providers.get(policy.selectedProviderId);
    if (!provider) {
      throw new Error(`Provider ${policy.selectedProviderId} is not registered`);
    }
    return {
      provider,
      providerId: policy.selectedProviderId,
      modelId: policy.selectedModelId
    };
  }

  async completeChat(policy: EffectivePolicy, request: Omit<ChatCompletionRequest, "providerId" | "modelId">): Promise<ChatCompletionResult> {
    const resolved = this.resolve(policy);
    try {
      return await resolved.provider.completeChat({
        ...request,
        providerId: resolved.providerId,
        modelId: resolved.modelId
      });
    } catch (error) {
      throw providerSafeError(error);
    }
  }

  async *streamChat(policy: EffectivePolicy, request: Omit<ChatCompletionRequest, "providerId" | "modelId">): AsyncIterable<ChatCompletionStreamEvent> {
    const resolved = this.resolve(policy);
    try {
      yield* resolved.provider.streamChat({
        ...request,
        providerId: resolved.providerId,
        modelId: resolved.modelId
      });
    } catch (error) {
      throw providerSafeError(error);
    }
  }
}

export function providerSafeError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = scrubSecrets({
    error: raw
  });
  return new Error(redacted.error);
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}
