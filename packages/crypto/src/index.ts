import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

export type WrappedKey = {
  provider: string;
  keyId: string;
  ciphertext: string;
  nonce: string;
  tag: string;
  algorithm: "aes-256-gcm";
};

export type Ciphertext = {
  ciphertext: string;
  nonce: string;
  tag: string;
  algorithm: "aes-256-gcm";
};

export type EncryptedBlob = {
  contentCiphertext: string;
  contentNonce: string;
  contentTag: string;
  contentKeyId: string;
  contentHash: string;
  algorithm: "aes-256-gcm";
};

export type EncryptionKeyMetadata = {
  id: string;
  tenantId: string;
  keyPurpose: "content" | "secret" | "prompt" | "message" | "tool";
  wrappedDek: WrappedKey;
  kmsProvider: string;
  kmsKeyId: string;
  status: "active" | "rotated" | "disabled";
  createdAt: Date;
  rotatedAt: Date | null;
  disabledAt: Date | null;
};

export interface KmsProvider {
  wrapKey(args: { keyPlaintext: Uint8Array; context: Record<string, string> }): Promise<WrappedKey>;
  unwrapKey(args: { wrappedKey: WrappedKey; context: Record<string, string> }): Promise<Uint8Array>;
  encrypt?(args: { plaintext: Uint8Array; context: Record<string, string> }): Promise<Ciphertext>;
  decrypt?(args: { ciphertext: Ciphertext; context: Record<string, string> }): Promise<Uint8Array>;
}

export interface EncryptionKeyStore {
  getActiveKey(tenantId: string, purpose: EncryptionKeyMetadata["keyPurpose"]): Promise<EncryptionKeyMetadata | null>;
  getKeyById?(keyId: string): Promise<EncryptionKeyMetadata | null>;
  saveKey(key: EncryptionKeyMetadata): Promise<void>;
}

export interface ContentCrypto {
  encryptForTenant(args: {
    tenantId: string;
    plaintext: string | Uint8Array;
    aad: Record<string, string>;
    purpose?: EncryptionKeyMetadata["keyPurpose"];
  }): Promise<EncryptedBlob>;

  decryptForTenant(args: {
    tenantId: string;
    blob: EncryptedBlob;
    aad: Record<string, string>;
  }): Promise<string | Uint8Array>;
}

export class LocalKmsProvider implements KmsProvider {
  private readonly masterKey: Buffer;
  readonly provider = "local";
  readonly keyId = "local-dev-master";

  constructor(masterKeyMaterial: string) {
    this.masterKey = normalizeKey(masterKeyMaterial);
  }

  async wrapKey(args: { keyPlaintext: Uint8Array; context: Record<string, string> }): Promise<WrappedKey> {
    const encrypted = aesGcmEncrypt(this.masterKey, Buffer.from(args.keyPlaintext), args.context);
    return {
      provider: this.provider,
      keyId: this.keyId,
      ...encrypted
    };
  }

  async unwrapKey(args: { wrappedKey: WrappedKey; context: Record<string, string> }): Promise<Uint8Array> {
    return aesGcmDecrypt(this.masterKey, args.wrappedKey, args.context);
  }

  async encrypt(args: { plaintext: Uint8Array; context: Record<string, string> }): Promise<Ciphertext> {
    return aesGcmEncrypt(this.masterKey, Buffer.from(args.plaintext), args.context);
  }

  async decrypt(args: { ciphertext: Ciphertext; context: Record<string, string> }): Promise<Uint8Array> {
    return aesGcmDecrypt(this.masterKey, args.ciphertext, args.context);
  }
}

export class VaultTransitKmsProvider implements KmsProvider {
  constructor(
    private readonly config: {
      vaultAddr: string;
      transitKey: string;
    }
  ) {}

  async wrapKey(_args: { keyPlaintext: Uint8Array; context: Record<string, string> }): Promise<WrappedKey> {
    throw new Error(`Vault Transit KMS adapter configured for ${this.config.vaultAddr}/${this.config.transitKey}, but network calls are not implemented in this skeleton`);
  }

  async unwrapKey(_args: { wrappedKey: WrappedKey; context: Record<string, string> }): Promise<Uint8Array> {
    throw new Error(`Vault Transit KMS adapter configured for ${this.config.vaultAddr}/${this.config.transitKey}, but network calls are not implemented in this skeleton`);
  }
}

export class InMemoryEncryptionKeyStore implements EncryptionKeyStore {
  private readonly keys = new Map<string, EncryptionKeyMetadata>();

  async getActiveKey(tenantId: string, purpose: EncryptionKeyMetadata["keyPurpose"]): Promise<EncryptionKeyMetadata | null> {
    for (const key of this.keys.values()) {
      if (key.tenantId === tenantId && key.keyPurpose === purpose && key.status === "active") {
        return key;
      }
    }
    return null;
  }

  async saveKey(key: EncryptionKeyMetadata): Promise<void> {
    this.keys.set(key.id, key);
  }

  async getKeyById(keyId: string): Promise<EncryptionKeyMetadata | null> {
    return this.keys.get(keyId) ?? null;
  }

  snapshot(): EncryptionKeyMetadata[] {
    return [...this.keys.values()];
  }
}

export class EnvelopeContentCrypto implements ContentCrypto {
  constructor(
    private readonly kms: KmsProvider,
    private readonly keys: EncryptionKeyStore
  ) {}

  async encryptForTenant(args: {
    tenantId: string;
    plaintext: string | Uint8Array;
    aad: Record<string, string>;
    purpose?: EncryptionKeyMetadata["keyPurpose"];
  }): Promise<EncryptedBlob> {
    const purpose = args.purpose ?? "content";
    const key = await this.getOrCreateKey(args.tenantId, purpose);
    const dek = await this.kms.unwrapKey({
      wrappedKey: key.wrappedDek,
      context: keyContext(args.tenantId, purpose)
    });
    const plaintextBytes = typeof args.plaintext === "string" ? Buffer.from(args.plaintext, "utf8") : Buffer.from(args.plaintext);
    const encrypted = aesGcmEncrypt(Buffer.from(dek), plaintextBytes, {
      ...args.aad,
      tenant_id: args.tenantId,
      key_id: key.id
    });

    return {
      contentCiphertext: encrypted.ciphertext,
      contentNonce: encrypted.nonce,
      contentTag: encrypted.tag,
      contentKeyId: key.id,
      contentHash: hmacContentHash(Buffer.from(dek), plaintextBytes),
      algorithm: encrypted.algorithm
    };
  }

  async decryptForTenant(args: {
    tenantId: string;
    blob: EncryptedBlob;
    aad: Record<string, string>;
  }): Promise<string> {
    const key = await this.findKey(args.blob.contentKeyId);
    if (key.tenantId !== args.tenantId) {
      throw new Error("Encrypted blob tenant mismatch");
    }
    const dek = await this.kms.unwrapKey({
      wrappedKey: key.wrappedDek,
      context: keyContext(key.tenantId, key.keyPurpose)
    });
    const plaintext = aesGcmDecrypt(
      Buffer.from(dek),
      {
        ciphertext: args.blob.contentCiphertext,
        nonce: args.blob.contentNonce,
        tag: args.blob.contentTag,
        algorithm: args.blob.algorithm
      },
      {
        ...args.aad,
        tenant_id: args.tenantId,
        key_id: key.id
      }
    );
    return Buffer.from(plaintext).toString("utf8");
  }

  private async getOrCreateKey(tenantId: string, purpose: EncryptionKeyMetadata["keyPurpose"]): Promise<EncryptionKeyMetadata> {
    const active = await this.keys.getActiveKey(tenantId, purpose);
    if (active) {
      return active;
    }

    const keyPlaintext = randomBytes(32);
    const wrappedDek = await this.kms.wrapKey({
      keyPlaintext,
      context: keyContext(tenantId, purpose)
    });
    const key: EncryptionKeyMetadata = {
      id: `key_${tenantId}_${purpose}_${randomId()}`,
      tenantId,
      keyPurpose: purpose,
      wrappedDek,
      kmsProvider: wrappedDek.provider,
      kmsKeyId: wrappedDek.keyId,
      status: "active",
      createdAt: new Date(),
      rotatedAt: null,
      disabledAt: null
    };
    await this.keys.saveKey(key);
    return key;
  }

  private async findKey(keyId: string): Promise<EncryptionKeyMetadata> {
    if (this.keys.getKeyById) {
      const key = await this.keys.getKeyById(keyId);
      if (key) {
        return key;
      }
    }
    throw new Error(`Encryption key ${keyId} not found`);
  }
}

export function createLocalContentCrypto(masterKeyMaterial = "dev-only-unsafe-master-key-32-bytes!!"): {
  crypto: EnvelopeContentCrypto;
  keyStore: InMemoryEncryptionKeyStore;
  kms: LocalKmsProvider;
} {
  const kms = new LocalKmsProvider(masterKeyMaterial);
  const keyStore = new InMemoryEncryptionKeyStore();
  return {
    kms,
    keyStore,
    crypto: new EnvelopeContentCrypto(kms, keyStore)
  };
}

function normalizeKey(material: string): Buffer {
  const raw = Buffer.from(material, "base64");
  if (raw.length === 32) {
    return raw;
  }
  return createHash("sha256").update(material).digest();
}

function aesGcmEncrypt(key: Buffer, plaintext: Buffer, aad: Record<string, string>): Ciphertext {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(canonicalAad(aad)));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    tag: tag.toString("base64"),
    algorithm: "aes-256-gcm"
  };
}

function aesGcmDecrypt(key: Buffer, blob: Ciphertext, aad: Record<string, string>): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(blob.nonce, "base64"));
  decipher.setAAD(Buffer.from(canonicalAad(aad)));
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(blob.ciphertext, "base64")), decipher.final()]);
}

function hmacContentHash(key: Buffer, plaintext: Buffer): string {
  return createHmac("sha256", key).update(plaintext).digest("hex");
}

function keyContext(tenantId: string, purpose: EncryptionKeyMetadata["keyPurpose"]): Record<string, string> {
  return {
    tenant_id: tenantId,
    key_purpose: purpose
  };
}

function canonicalAad(aad: Record<string, string>): string {
  return Object.entries(aad)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function randomId(): string {
  return randomBytes(8).toString("hex");
}
