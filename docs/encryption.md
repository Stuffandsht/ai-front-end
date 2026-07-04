# Encryption

Encryption is centralized in `packages/crypto`.

- `KmsProvider` wraps and unwraps data encryption keys.
- `EnvelopeContentCrypto` encrypts tenant content with AES-256-GCM.
- `encryption_keys` records DEK metadata, wrapped DEKs, KMS provider, status, and rotation timestamps.
- `SqlEncryptionKeyStore` persists wrapped DEK metadata to the Postgres baseline table for SQL-backed runtimes.
- Provider credentials, prompt fragments, prompt compilations, tool payloads, and retained messages use encrypted blobs.

Local development uses `LocalKmsProvider`. Production should implement the `VaultTransitKmsProvider` placeholder or another external KMS adapter.

Key rotation design: create a new active tenant DEK for a purpose, mark the previous key rotated, encrypt new writes with the new key, and re-encrypt old content in controlled batches.

Crypto-shredding design: disable or destroy the tenant DEK wrapping material in the external KMS, then mark local key metadata disabled. Ciphertext remains but is not decryptable.
