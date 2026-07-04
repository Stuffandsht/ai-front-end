# Retention

Retention modes:

- `retained`: content may be stored, but durable message and prompt content is encrypted.
- `limited`: content may be stored with reduced tool/debug/audit payloads.
- `ephemeral`: no message, prompt, tool argument/result, attachment, embedding, debug trace, or job payload content is persisted.

All content-writing repository APIs accept `RetentionContext`. The forbidden direct-write pattern is avoided by placing message, prompt compilation, tool invocation, audit, and job writes behind repository methods.

The integration suite sends a generated `SENTINEL_EPHEMERAL_DO_NOT_STORE_<uuid>` through chat and a mock tool, then searches raw durable state for the sentinel.
