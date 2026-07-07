import { scrubSecrets } from "@agent-platform/audit";
import type { EffectivePolicy } from "@agent-platform/policy";
import type { RetentionContext } from "@agent-platform/retention";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
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
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsJsonSchema?: boolean;
  inputModalities?: string[];
  outputModalities?: string[];
  pricing?: Record<string, string>;
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
      defaultHeaders?: Record<string, string | undefined>;
      providerMetadataName?: string;
      fetchImpl?: typeof fetch;
    }
  ) {
    this.id = args.id;
    this.baseUrl = validateProviderBaseUrl(args.baseUrl).replace(/\/$/, "");
    this.apiKey = args.apiKey;
    this.defaultHeaders = args.defaultHeaders ?? {};
    this.providerMetadataName = args.providerMetadataName ?? "openai_compatible";
    this.fetchImpl = args.fetchImpl ?? fetch;
  }

  protected readonly baseUrl: string;
  protected readonly apiKey: string;
  protected readonly defaultHeaders: Record<string, string | undefined>;
  protected readonly providerMetadataName: string;
  protected readonly fetchImpl: typeof fetch;

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
          "content-type": "application/json",
          ...definedHeaders(this.defaultHeaders),
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify(this.buildChatBody(args, false))
      }
    };
  }

  protected buildChatBody(args: ChatCompletionRequest, stream: boolean): Record<string, unknown> {
    return {
      model: args.modelId,
      messages: args.messages.map(openAiMessageFromChatMessage),
      stream,
      ...(args.tools.length > 0 ? { tools: openAiToolsFromRuntimeTools(args.tools) } : {})
    };
  }

  async completeChat(args: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const request = this.buildChatRequest(args);
    try {
      const response = await this.fetchImpl(request.url, request.init);
      const bodyText = await response.text();
      if (!response.ok) {
        throw new Error(`OpenAI-compatible provider returned HTTP ${response.status}: ${safeErrorBody(bodyText)}`);
      }
      return openAiChatResponseToResult(JSON.parse(bodyText) as OpenAIChatResponse, this.providerMetadataName);
    } catch (error) {
      throw this.redactError(error);
    }
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
    return new Error(this.apiKey ? message.replaceAll(this.apiKey, "[redacted]") : message);
  }
}

export type OpenRouterProviderPreferences = {
  order?: string[];
  only?: string[];
  ignore?: string[];
  sort?: "price" | "throughput" | "latency";
  allow_fallbacks?: boolean;
  data_collection?: "allow" | "deny";
  zdr?: boolean;
};

export class OpenRouterProvider implements InferenceProvider {
  readonly id: string;

  constructor(
    args: {
      id?: string;
      apiKey: string;
      baseUrl?: string;
      appUrl?: string;
      appTitle?: string;
      defaultProviderPreferences?: OpenRouterProviderPreferences;
      fetchImpl?: typeof fetch;
    }
  ) {
    this.id = args.id ?? "openrouter";
    this.baseUrl = validateProviderBaseUrl(args.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
    this.apiKey = args.apiKey;
    this.appUrl = args.appUrl;
    this.appTitle = args.appTitle;
    this.defaultProviderPreferences = args.defaultProviderPreferences ?? {};
    this.fetchImpl = args.fetchImpl ?? fetch;
  }

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly appUrl: string | undefined;
  private readonly appTitle: string | undefined;
  private readonly defaultProviderPreferences: OpenRouterProviderPreferences;
  private readonly fetchImpl: typeof fetch;

  buildChatRequest(args: ChatCompletionRequest, stream = false): {
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
        headers: this.headers(),
        body: JSON.stringify({
          model: args.modelId,
          messages: args.messages.map(openAiMessageFromChatMessage),
          stream,
          ...(args.tools.length > 0 ? { tools: openAiToolsFromRuntimeTools(args.tools), tool_choice: "auto" } : {}),
          provider: openRouterProviderPreferences(args.retention, this.defaultProviderPreferences),
          user: args.userId
        })
      }
    };
  }

  async completeChat(args: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const request = this.buildChatRequest(args, false);
    try {
      const response = await this.fetchImpl(request.url, request.init);
      const bodyText = await response.text();
      if (!response.ok) {
        throw new Error(`OpenRouter returned HTTP ${response.status}: ${safeErrorBody(bodyText)}`);
      }
      return openAiChatResponseToResult(JSON.parse(bodyText) as OpenAIChatResponse, "openrouter");
    } catch (error) {
      throw this.redactError(error);
    }
  }

  async *streamChat(args: ChatCompletionRequest): AsyncIterable<ChatCompletionStreamEvent> {
    const request = this.buildChatRequest(args, true);
    try {
      const response = await this.fetchImpl(request.url, request.init);
      if (!response.ok) {
        throw new Error(`OpenRouter returned HTTP ${response.status}: ${safeErrorBody(await response.text())}`);
      }
      const aggregate = await openAiStreamEvents(response, "openrouter");
      for (const delta of aggregate.deltas) {
        yield {
          type: "delta",
          delta
        };
      }
      for (const toolCall of aggregate.result.toolCalls) {
        yield {
          type: "tool_call",
          toolCall
        };
      }
      yield {
        type: "done",
        result: aggregate.result
      };
    } catch (error) {
      throw this.redactError(error);
    }
  }

  async listModels(): Promise<ModelDescriptor[]> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/models`, {
        method: "GET",
        headers: this.headers()
      });
      const bodyText = await response.text();
      if (!response.ok) {
        throw new Error(`OpenRouter model catalog returned HTTP ${response.status}: ${safeErrorBody(bodyText)}`);
      }
      return openRouterModelsToDescriptors(JSON.parse(bodyText) as OpenRouterModelsResponse);
    } catch (error) {
      throw this.redactError(error);
    }
  }

  redactError(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    return new Error(this.apiKey ? message.replaceAll(this.apiKey, "[redacted]") : message);
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      ...(this.appUrl ? { "HTTP-Referer": this.appUrl } : {}),
      ...(this.appTitle ? { "X-OpenRouter-Title": this.appTitle } : {})
    };
  }
}

type OpenAIChatResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    finish_reason?: string;
    message?: OpenAIChatMessage;
    delta?: Partial<OpenAIChatMessage>;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    cost?: number;
  };
};

type OpenAIChatMessage = {
  content?: string | Array<{ type?: string; text?: string }>;
  tool_calls?: Array<{
    id?: string;
    index?: number;
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
};

type OpenRouterModelsResponse = {
  data?: Array<{
    id?: string;
    name?: string;
    context_length?: number;
    top_provider?: {
      context_length?: number;
      max_completion_tokens?: number;
    } | null;
    supported_parameters?: string[];
    architecture?: {
      input_modalities?: string[];
      output_modalities?: string[];
    } | null;
    pricing?: Record<string, string>;
  }>;
};

function openAiChatResponseToResult(payload: OpenAIChatResponse, provider: string): ChatCompletionResult {
  const choice = payload.choices?.[0];
  const message = choice?.message;
  const content = typeof message?.content === "string" ? message.content : Array.isArray(message?.content) ? message.content.flatMap((part) => (part.text ? [part.text] : [])).join("") : "";
  return {
    content,
    toolCalls:
      message?.tool_calls?.flatMap((toolCall, index) => {
        const toolId = toolCall.function?.name;
        if (!toolId) {
          return [];
        }
        return [
          {
            id: toolCall.id ?? `toolcall_${index}`,
            toolId,
            args: parseToolArguments(toolCall.function?.arguments)
          }
        ];
      }) ?? [],
    usage: {
      inputTokens: payload.usage?.prompt_tokens ?? payload.usage?.input_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? payload.usage?.output_tokens ?? 0
    },
    providerMetadata: {
      provider,
      responseId: payload.id ?? null,
      model: payload.model ?? null,
      finishReason: choice?.finish_reason ?? null,
      ...(typeof payload.usage?.cost === "number" ? { cost: payload.usage.cost } : {})
    }
  };
}

async function openAiStreamEvents(response: Response, provider: string): Promise<{ deltas: string[]; result: ChatCompletionResult }> {
  if (!response.body) {
    throw new Error("Streaming response did not include a body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const deltas: string[] = [];
  const toolCalls = new Map<number, { id?: string; name?: string; arguments: string }>();
  const usage: ChatCompletionResult["usage"] = { inputTokens: 0, outputTokens: 0 };
  let responseId: string | null = null;
  let model: string | null = null;
  let finishReason: string | null = null;
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const data = trimmed.slice("data:".length).trim();
      if (data === "[DONE]") {
        continue;
      }
      const chunk = JSON.parse(data) as OpenAIChatResponse;
      responseId = chunk.id ?? responseId;
      model = chunk.model ?? model;
      usage.inputTokens = chunk.usage?.prompt_tokens ?? chunk.usage?.input_tokens ?? usage.inputTokens;
      usage.outputTokens = chunk.usage?.completion_tokens ?? chunk.usage?.output_tokens ?? usage.outputTokens;
      const choice = chunk.choices?.[0];
      finishReason = choice?.finish_reason ?? finishReason;
      const content = choice?.delta?.content;
      if (typeof content === "string" && content.length > 0) {
        deltas.push(content);
      }
      for (const toolCall of choice?.delta?.tool_calls ?? []) {
        const index = toolCall.index ?? toolCalls.size;
        const current = toolCalls.get(index) ?? { arguments: "" };
        toolCalls.set(index, {
          ...(toolCall.id ?? current.id ? { id: toolCall.id ?? current.id } : {}),
          ...(toolCall.function?.name ?? current.name ? { name: toolCall.function?.name ?? current.name } : {}),
          arguments: `${current.arguments}${toolCall.function?.arguments ?? ""}`
        });
      }
    }
    if (done) {
      break;
    }
  }

  const content = deltas.join("");
  return {
    deltas,
    result: {
      content,
      toolCalls: [...toolCalls.entries()].flatMap(([index, toolCall]) =>
        toolCall.name
          ? [
              {
                id: toolCall.id ?? `toolcall_${index}`,
                toolId: toolCall.name,
                args: parseToolArguments(toolCall.arguments)
              }
            ]
          : []
      ),
      usage,
      providerMetadata: {
        provider,
        responseId,
        model,
        finishReason
      }
    }
  };
}

function openAiMessageFromChatMessage(message: ChatMessage): Record<string, string> {
  return {
    role: message.role,
    content: message.content,
    ...(message.name ? { name: message.name } : {}),
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {})
  };
}

function openAiToolsFromRuntimeTools(tools: ChatCompletionRequest["tools"]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.id,
      description: tool.description,
      parameters: {
        type: "object",
        additionalProperties: true
      }
    }
  }));
}

function openRouterProviderPreferences(retention: RetentionContext, defaults: OpenRouterProviderPreferences): OpenRouterProviderPreferences {
  return {
    ...defaults,
    ...(retention.mode === "ephemeral" ? { data_collection: "deny", zdr: true } : {}),
    ...(retention.mode === "limited" ? { data_collection: "deny" } : {})
  };
}

function openRouterModelsToDescriptors(payload: OpenRouterModelsResponse): ModelDescriptor[] {
  return (
    payload.data?.flatMap((model) => {
      if (!model.id) {
        return [];
      }
      const supported = new Set(model.supported_parameters ?? []);
      const descriptor: ModelDescriptor = {
        id: model.id,
        displayName: model.name ?? model.id,
        contextWindow: model.top_provider?.context_length ?? model.context_length ?? 8192,
        maxOutputTokens: model.top_provider?.max_completion_tokens ?? 1024,
        supportsTools: supported.has("tools"),
        supportsStreaming: true,
        supportsJsonSchema: supported.has("response_format"),
        inputModalities: model.architecture?.input_modalities ?? ["text"],
        outputModalities: model.architecture?.output_modalities ?? ["text"],
        ...(model.pricing ? { pricing: model.pricing } : {})
      };
      return [
        descriptor
      ];
    }) ?? []
  );
}

function definedHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
}

function parseToolArguments(value: string | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function validateProviderBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Provider base URL must use http or https");
  }
  return url.toString();
}

function safeErrorBody(value: string): string {
  if (!value) {
    return "empty response body";
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      return JSON.stringify(scrubSecrets(parsed));
    }
  } catch {
    // Fall through to truncating the raw response.
  }
  return value.slice(0, 500);
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
