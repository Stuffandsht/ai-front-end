import { describe, expect, it } from "vitest";
import { compileEffectivePolicy, type PolicyDocuments, type ProviderInventory } from "@agent-platform/policy";

const inventory: ProviderInventory = {
  providers: [
    { id: "mock", modelIds: ["mock-chat", "mock-chat-fast"], enabled: true },
    { id: "anthropic", modelIds: ["claude-compatible"], enabled: true },
    { id: "user-openai", modelIds: ["gpt-compatible"], enabled: true, byo: true }
  ],
  toolIds: ["mock.read_context", "mock.dangerous_action"]
};

const baseDocuments: PolicyDocuments = {
  platform: {
    allowedProviderIds: ["mock", "anthropic", "user-openai"],
    defaultProviderId: "mock",
    allowedModelIds: ["mock-chat", "mock-chat-fast", "claude-compatible", "gpt-compatible"],
    defaultModelId: "mock-chat",
    allowedToolIds: ["mock.read_context", "mock.dangerous_action"],
    enabledToolIds: ["mock.read_context"],
    defaultRetentionMode: "retained",
    userByoProviderAllowed: true
  },
  service: {
    allowedProviderIds: ["mock", "anthropic", "user-openai"],
    defaultProviderId: "mock"
  },
  tenant: {
    allowedProviderIds: ["mock", "user-openai"],
    defaultProviderId: "mock",
    allowedModelIds: ["mock-chat", "mock-chat-fast", "gpt-compatible"],
    defaultModelId: "mock-chat",
    userByoProviderAllowed: true,
    promptFragments: [
      { id: "tenant-low", priority: 10 },
      { id: "tenant-high", priority: 100 }
    ]
  }
};

function compile(documents: PolicyDocuments, requestedProviderId?: string, requestedRetentionMode?: "retained" | "limited" | "ephemeral") {
  return compileEffectivePolicy(
    {
      deploymentMode: "multi_tenant",
      tenantId: "tenant_1",
      userId: "user_1",
      groupIds: [],
      ...(requestedProviderId ? { requestedProviderId } : {}),
      ...(requestedRetentionMode ? { requestedRetentionMode } : {})
    },
    documents,
    inventory
  );
}

describe("effective policy compiler", () => {
  it("allows a user provider override when service and tenant allow BYO provider", () => {
    const policy = compile(
      {
        ...baseDocuments,
        user: {
          allowedProviderIds: ["user-openai"],
          defaultProviderId: "user-openai",
          defaultModelId: "gpt-compatible"
        }
      },
      "user-openai"
    );

    expect(policy.selectedProviderId).toBe("user-openai");
    expect(policy.userByoProviderAllowed).toBe(true);
    expect(policy.reasons.map((reason) => reason.code)).toContain("BYO_PROVIDER_ALLOWED");
  });

  it("denies a user provider override when tenant forbids BYO provider", () => {
    const policy = compile(
      {
        ...baseDocuments,
        tenant: {
          ...baseDocuments.tenant,
          userByoProviderAllowed: false
        },
        user: {
          allowedProviderIds: ["user-openai"],
          defaultProviderId: "user-openai"
        }
      },
      "user-openai"
    );

    expect(policy.selectedProviderId).toBe("mock");
    expect(policy.reasons.some((reason) => reason.code === "BYO_PROVIDER_DENIED" && reason.severity === "deny")).toBe(true);
  });

  it("applies service deny over tenant allow", () => {
    const policy = compile(
      {
        ...baseDocuments,
        service: {
          ...baseDocuments.service,
          deniedProviderIds: ["anthropic"]
        },
        tenant: {
          ...baseDocuments.tenant,
          allowedProviderIds: ["mock", "anthropic"]
        }
      },
      "anthropic"
    );

    expect(policy.allowedProviderIds).not.toContain("anthropic");
    expect(policy.reasons.some((reason) => reason.code === "PROVIDER_DENY_OVERRIDE")).toBe(true);
  });

  it("applies tenant deny over user allow", () => {
    const policy = compile(
      {
        ...baseDocuments,
        tenant: {
          ...baseDocuments.tenant,
          deniedProviderIds: ["user-openai"],
          userByoProviderAllowed: true
        },
        user: {
          allowedProviderIds: ["user-openai"],
          defaultProviderId: "user-openai"
        }
      },
      "user-openai"
    );

    expect(policy.allowedProviderIds).not.toContain("user-openai");
    expect(policy.reasons.some((reason) => reason.message.includes("user-openai"))).toBe(true);
  });

  it("resolves single-company mode without a service default row and still returns tenant_id", () => {
    const policy = compileEffectivePolicy(
      {
        deploymentMode: "single_company",
        tenantId: "company_1",
        userId: "user_1",
        groupIds: []
      },
      {
        platform: baseDocuments.platform!,
        tenant: baseDocuments.tenant!
      },
      inventory
    );

    expect(policy.tenantId).toBe("company_1");
    expect(policy.selectedProviderId).toBe("mock");
  });

  it("sets metadata-only tracing when the user requests ephemeral mode", () => {
    const policy = compile(baseDocuments, undefined, "ephemeral");

    expect(policy.retentionMode).toBe("ephemeral");
    expect(policy.tracePolicy).toBe("metadata_only");
  });

  it("prevents retained conversations when tenant policy mandates ephemeral", () => {
    const policy = compile(
      {
        ...baseDocuments,
        tenant: {
          ...baseDocuments.tenant,
          mandatoryRetentionMode: "ephemeral"
        }
      },
      undefined,
      "retained"
    );

    expect(policy.retentionMode).toBe("ephemeral");
    expect(policy.reasons.some((reason) => reason.code === "RETENTION_STRICTEST_WINS" && reason.severity === "deny")).toBe(true);
  });

  it("orders prompt fragments deterministically by priority", () => {
    const policy = compile({
      ...baseDocuments,
      user: {
        promptFragments: [{ id: "user-mid", priority: 50 }]
      }
    });

    expect(policy.promptFragmentIds).toEqual(["tenant-high", "user-mid", "tenant-low"]);
  });

  it("produces human-readable denial reasons", () => {
    const policy = compile(baseDocuments, "not-allowed");

    expect(policy.reasons.some((reason) => reason.severity === "deny" && reason.message.includes("not-allowed"))).toBe(true);
  });
});
