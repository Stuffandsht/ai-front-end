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

  it("wraps and unwraps keys through the Vault Transit adapter", async () => {
    const kms = new VaultTransitKmsProvider({
      vaultAddr: "https://vault.example",
      transitKey: "agent-platform",
      vaultToken: "vault-token",
      fetchImpl: async (url, init) => {
        const body = JSON.parse(String(init?.body)) as { plaintext?: string; ciphertext?: string };
        if (String(url).includes("/encrypt/")) {
          return new Response(JSON.stringify({ data: { ciphertext: `vault:v1:${body.plaintext ?? ""}` } }));
        }
        return new Response(JSON.stringify({ data: { plaintext: String(body.ciphertext ?? "").replace("vault:v1:", "") } }));
      }
    });
    const keyPlaintext = new Uint8Array(32).fill(7);
    const wrapped = await kms.wrapKey({ keyPlaintext, context: { tenant_id: "tenant_1" } });
    const unwrapped = await kms.unwrapKey({ wrappedKey: wrapped, context: { tenant_id: "tenant_1" } });
    expect(wrapped.provider).toBe("vault_transit");
    expect([...unwrapped]).toEqual([...keyPlaintext]);
  });
});
