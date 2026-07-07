# MCP / Plugin Gateway

The MVP boundary includes a registry, mock tools, permissions, confirmation gates, and retention-aware invocation storage.

Implemented tools:

- `mock.read_context`: low-risk read-only tool.
- `mock.dangerous_action`: high-risk tool that requires confirmation.

HTTP and stdio MCP adapter classes stay disabled by default. When explicitly enabled by service/admin policy, HTTP adapters call constrained JSON endpoints for tool listing and invocation, while stdio adapters execute a configured command with a single JSON request over stdin and parse one JSON response. The app does not mount a Docker socket or pass user/provider secrets to tools.
