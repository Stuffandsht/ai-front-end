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
- gateway validation against `EffectivePolicy`.
- server-side encrypted credential lookup; credentials are never returned to the browser.

User BYO provider is disabled by default and can only be added when tenant/company policy permits it.
