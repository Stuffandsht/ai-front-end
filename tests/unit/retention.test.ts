import { describe, expect, it } from "vitest";
import { buildRetentionContext, stricterRetentionMode } from "@agent-platform/retention";

describe("retention context", () => {
  it("builds retained, limited, and ephemeral capabilities", () => {
    expect(buildRetentionContext("retained")).toMatchObject({
      canStoreContent: true,
      canStoreToolPayloads: true,
      canStoreEmbeddings: true,
      auditContentMode: "full"
    });
    expect(buildRetentionContext("limited")).toMatchObject({
      canStoreContent: true,
      canStoreToolPayloads: false,
      auditContentMode: "redacted"
    });
    expect(buildRetentionContext("ephemeral")).toMatchObject({
      canStoreContent: false,
      canStoreToolPayloads: false,
      canStoreEmbeddings: false,
      auditContentMode: "metadata_only"
    });
  });

  it("treats ephemeral as stricter than limited and retained", () => {
    expect(stricterRetentionMode("retained", "ephemeral")).toBe("ephemeral");
    expect(stricterRetentionMode("limited", "retained")).toBe("limited");
  });
});
