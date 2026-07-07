# Provider Gateway

Providers implement:

```ts
interface InferenceProvider {
  id: string
  completeChat(args: ChatCompletionRequest): Promise<ChatCompletionResult>
  streamChat(args: ChatCompletionRequest): AsyncIterable<ChatCompletionStreamEvent>
}
```

Implemented:

- deterministic mock provider for local development and tests.
- OpenAI-compatible adapter that sends server-side `/chat/completions` requests, parses text/tool-call/usage responses, and redacts errors.
- first-class OpenRouter adapter using `https://openrouter.ai/api/v1`, `HTTP-Referer` and `X-OpenRouter-Title` attribution headers, model catalog sync from `/models`, OpenAI-style tool-call parsing, and SSE streaming.
- gateway validation against `EffectivePolicy`.
- server-side encrypted credential lookup; credentials are never returned to the browser.

OpenRouter is configured as `provider_type=openrouter`, not as a generic custom endpoint. Tenant/company admins can add an OpenRouter API key from the provider admin page, then sync the OpenRouter catalog into `model_configs`. Synced models participate in the same provider/model allowlist and default-selection policy as mock and OpenAI-compatible providers.

For stricter retention requests, the OpenRouter adapter adds provider-routing preferences:

- `ephemeral`: `provider.data_collection = "deny"` and `provider.zdr = true`.
- `limited`: `provider.data_collection = "deny"`.

These routing hints do not replace local retention enforcement. The runtime still prevents disallowed persistent writes before provider calls are made.

User BYO provider is disabled by default and can only be added when tenant/company policy permits it.
