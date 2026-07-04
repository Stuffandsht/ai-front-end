# Prompt Stack

Prompt fragments are encrypted records with scope, priority, version, and content hash.

Scopes:

- service
- tenant/company
- group
- user
- conversation

The compiler sorts by priority, then scope, then name/id. Security and authorization never rely on prompt text; the policy compiler and gateways enforce provider, tool, credential, and retention behavior outside the model.

In ephemeral mode, prompt compilation metadata may be recorded, but compiled prompt content is not persisted.
