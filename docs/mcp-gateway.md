# MCP / Plugin Gateway

The runtime now uses a bounded tool loop:

- provider tool calls are captured from OpenAI/OpenRouter-compatible responses.
- allowed tools execute through the MCP gateway.
- completed results are appended as tool messages and sent back to the provider.
- denied tools, confirmation-required tools, provider errors, and `AGENT_MAX_TOOL_ITERATIONS` stop the loop safely.

Implemented local tools:

- `mock.read_context`: low-risk read-only tool.
- `mock.dangerous_action`: high-risk tool that requires confirmation.

Tenant admins can install HTTP or stdio MCP servers from `/admin/plugins` or `POST /api/plugins`. Install records support tenant/user scope, encrypted install config, env secret references, risk level, retention class, and tenant tool permission rows. HTTP servers expose `/tools` and `/tools/{id}/invoke`; stdio servers receive one JSON request on stdin and return one JSON response on stdout.

Platform plugins are separate from MCP. `/api/platform-plugins` stores manifest-based prompt packs, provider presets, policy bundles, and workflow actions without registering executable tools. Prompt-pack content is installed as normal encrypted prompt fragments; policy bundles can adjust tenant provider/model/tool/retention policy.
