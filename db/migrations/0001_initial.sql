CREATE TABLE tenants (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  primary_domain text,
  allowed_hostnames jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_memberships (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  user_id text NOT NULL REFERENCES users(id),
  role text NOT NULL,
  external_subject text,
  external_groups_json jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE identity_providers (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  provider_type text NOT NULL,
  issuer_url text NOT NULL,
  client_id text NOT NULL,
  client_secret_ref text NOT NULL,
  allowed_email_domains jsonb NOT NULL DEFAULT '[]',
  claim_mapping_json jsonb NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE roles (
  id text PRIMARY KEY,
  tenant_id text REFERENCES tenants(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE permissions (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  id text PRIMARY KEY,
  role_id text NOT NULL REFERENCES roles(id),
  permission_id text NOT NULL REFERENCES permissions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE provider_configs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  scope_type text NOT NULL,
  scope_id text NOT NULL,
  provider_type text NOT NULL,
  display_name text NOT NULL,
  base_url text,
  auth_mode text NOT NULL,
  credential_ref text,
  retention_policy_class text NOT NULL,
  supports_streaming boolean NOT NULL DEFAULT false,
  supports_tool_calling boolean NOT NULL DEFAULT false,
  supports_json_schema boolean NOT NULL DEFAULT false,
  supports_embeddings boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE provider_credentials (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  provider_config_id text NOT NULL REFERENCES provider_configs(id),
  user_id text REFERENCES users(id),
  credential_ref text NOT NULL,
  content_ciphertext text NOT NULL,
  content_nonce text NOT NULL,
  content_tag text NOT NULL,
  content_key_id text NOT NULL,
  content_hash text NOT NULL,
  retention_mode text NOT NULL DEFAULT 'retained',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE model_configs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  provider_config_id text NOT NULL REFERENCES provider_configs(id),
  model_key text NOT NULL,
  display_name text NOT NULL,
  context_window integer NOT NULL,
  max_output_tokens integer NOT NULL,
  supports_tools boolean NOT NULL DEFAULT false,
  supports_streaming boolean NOT NULL DEFAULT false,
  supports_json_schema boolean NOT NULL DEFAULT false,
  input_modalities_json jsonb NOT NULL DEFAULT '[]',
  output_modalities_json jsonb NOT NULL DEFAULT '[]',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE user_provider_preferences (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  user_id text NOT NULL REFERENCES users(id),
  default_provider_id text NOT NULL,
  default_model_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE prompt_fragments (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  scope_type text NOT NULL,
  scope_id text NOT NULL,
  name text NOT NULL,
  content_ciphertext text NOT NULL,
  content_nonce text NOT NULL,
  content_tag text NOT NULL,
  content_key_id text NOT NULL,
  content_hash text NOT NULL,
  priority integer NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL REFERENCES users(id),
  retention_mode text NOT NULL DEFAULT 'retained',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE prompt_fragment_versions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  prompt_fragment_id text NOT NULL REFERENCES prompt_fragments(id),
  version integer NOT NULL,
  content_ciphertext text NOT NULL,
  content_nonce text NOT NULL,
  content_tag text NOT NULL,
  content_key_id text NOT NULL,
  content_hash text NOT NULL,
  created_by text NOT NULL REFERENCES users(id),
  retention_mode text NOT NULL DEFAULT 'retained',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE prompt_compilations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  conversation_id text,
  fragment_ids jsonb NOT NULL DEFAULT '[]',
  fragment_versions jsonb NOT NULL DEFAULT '[]',
  compiled_hash text NOT NULL,
  content_ciphertext text,
  content_nonce text,
  content_tag text,
  content_key_id text,
  content_hash text,
  retention_mode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE retention_policies (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  default_retention_mode text NOT NULL,
  mandatory_retention_mode text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE effective_policy_snapshots (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  user_id text NOT NULL REFERENCES users(id),
  conversation_id text,
  policy_hash text NOT NULL,
  selected_provider_id text NOT NULL,
  selected_model_id text NOT NULL,
  retention_mode text NOT NULL,
  reasons_json jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE conversations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  user_id text NOT NULL REFERENCES users(id),
  title text NOT NULL,
  retention_mode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE messages (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  conversation_id text NOT NULL REFERENCES conversations(id),
  user_id text NOT NULL REFERENCES users(id),
  role text NOT NULL,
  content_ciphertext text NOT NULL,
  content_nonce text NOT NULL,
  content_tag text NOT NULL,
  content_key_id text NOT NULL,
  content_hash text NOT NULL,
  retention_mode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE message_parts (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  message_id text NOT NULL REFERENCES messages(id),
  type text NOT NULL,
  content_ciphertext text,
  content_nonce text,
  content_tag text,
  content_key_id text,
  content_hash text,
  retention_mode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE attachments (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  conversation_id text NOT NULL REFERENCES conversations(id),
  object_key text,
  metadata_json jsonb NOT NULL DEFAULT '{}',
  content_hash text,
  content_key_id text,
  retention_mode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE mcp_servers (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  transport_type text NOT NULL,
  server_url text,
  container_image text,
  command text,
  args_json jsonb NOT NULL DEFAULT '[]',
  env_secret_refs_json jsonb NOT NULL DEFAULT '[]',
  risk_level text NOT NULL,
  retention_policy_class text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plugin_installations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  scope_type text NOT NULL,
  scope_id text NOT NULL,
  mcp_server_id text NOT NULL REFERENCES mcp_servers(id),
  content_ciphertext text,
  content_nonce text,
  content_tag text,
  content_key_id text,
  content_hash text,
  enabled boolean NOT NULL DEFAULT true,
  installed_by text NOT NULL REFERENCES users(id),
  approved_by text REFERENCES users(id),
  retention_mode text NOT NULL DEFAULT 'retained',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE platform_plugin_installations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  scope_type text NOT NULL,
  scope_id text NOT NULL,
  plugin_id text NOT NULL,
  manifest_json jsonb NOT NULL,
  content_ciphertext text,
  content_nonce text,
  content_tag text,
  content_key_id text,
  content_hash text,
  enabled boolean NOT NULL DEFAULT true,
  installed_by text NOT NULL REFERENCES users(id),
  approved_by text REFERENCES users(id),
  retention_mode text NOT NULL DEFAULT 'retained',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE tool_permissions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  tool_id text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  permission text NOT NULL,
  requires_confirmation boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE tool_invocations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  user_id text NOT NULL REFERENCES users(id),
  conversation_id text,
  request_id text NOT NULL,
  tool_id text NOT NULL,
  status text NOT NULL,
  args_ciphertext_nullable jsonb,
  result_ciphertext_nullable jsonb,
  metadata_json jsonb NOT NULL DEFAULT '{}',
  retention_mode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE audit_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  user_id text NOT NULL REFERENCES users(id),
  type text NOT NULL,
  request_id text,
  metadata_json jsonb NOT NULL DEFAULT '{}',
  content_json jsonb,
  retention_mode text NOT NULL,
  audit_content_mode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE encryption_keys (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  key_purpose text NOT NULL,
  wrapped_dek jsonb NOT NULL,
  kms_provider text NOT NULL,
  kms_key_id text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  disabled_at timestamptz
);

CREATE TABLE background_jobs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  queue text NOT NULL,
  status text NOT NULL,
  payload_json jsonb,
  metadata_json jsonb NOT NULL DEFAULT '{}',
  retention_mode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
