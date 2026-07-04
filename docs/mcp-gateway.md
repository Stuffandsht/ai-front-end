# MCP / Plugin Gateway

The MVP boundary includes a registry, mock tools, permissions, confirmation gates, and retention-aware invocation storage.

Implemented tools:

- `mock.read_context`: low-risk read-only tool.
- `mock.dangerous_action`: high-risk tool that requires confirmation.

HTTP and stdio MCP adapter classes exist behind explicit disabled-by-default gates. They do not execute network MCP calls or local processes in the MVP unless future service policy enables and implements those paths. The MVP does not execute arbitrary local commands, mount a Docker socket, or pass user/provider secrets to tools.
