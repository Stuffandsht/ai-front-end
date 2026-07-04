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
- OpenAI-compatible adapter shape that builds server-side requests and redacts errors.
- gateway validation against `EffectivePolicy`.
- server-side credential references only; credentials are never returned to the browser.

User BYO provider is disabled by default and can only be added when tenant/company policy permits it.
