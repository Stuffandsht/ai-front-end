const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@agent-platform/audit",
    "@agent-platform/auth",
    "@agent-platform/config",
    "@agent-platform/crypto",
    "@agent-platform/db",
    "@agent-platform/mcp-gateway",
    "@agent-platform/policy",
    "@agent-platform/prompts",
    "@agent-platform/providers",
    "@agent-platform/retention",
    "@agent-platform/runtime"
  ]
};

export default nextConfig;
