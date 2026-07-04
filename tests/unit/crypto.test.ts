import { describe, expect, it } from "vitest";
import { createLocalContentCrypto, VaultTransitKmsProvider } from "@agent-platform/crypto";

describe("content crypto", () => {
  it("encrypts and decrypts tenant content without exposing plaintext in the blob", async () => {
    const { crypto } = createLocalContentCrypto("test-master-key");
    const plaintext = "secret prompt content";
    const blob = await crypto.encryptForTenant({
      tenantId: "tenant_1",
      plaintext,
      aad: { record_type: "test" }
    });

    expect(JSON.stringify(blob)).not.toContain(plaintext);
    await expect(
      crypto.decryptForTenant({
        tenantId: "tenant_1",
        blob,
        aad: { record_type: "test" }
      })
    ).resolves.toBe(plaintext);
  });

  it("includes a production KMS adapter interface placeholder", async () => {
    const kms = new VaultTransitKmsProvider({ vaultAddr: "https://vault.example", transitKey: "agent-platform" });
    await expect(kms.wrapKey({ keyPlaintext: new Uint8Array(32), context: {} })).rejects.toThrow("Vault Transit KMS adapter");
  });
});
