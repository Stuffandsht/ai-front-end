import { isRetentionMode, type RetentionMode } from "@agent-platform/retention";

export type DeploymentMode = "multi_tenant" | "single_company";

export type AppConfig = {
  deploymentMode: DeploymentMode;
  publicBaseUrl: string;
  allowDevAuth: boolean;
  sessionCookieName: string;
  defaultProviderId: string;
  defaultModelId: string;
  databaseUrl: string;
  redisUrl: string;
  s3: {
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
  kms: {
    provider: "local" | "vault_transit" | "external";
    localMasterKeyBase64: string;
    vaultAddr?: string;
    vaultTransitKey?: string;
  };
  singleCompany: {
    tenantSlug: string;
    tenantName: string;
    primaryDomain?: string;
    defaultRetention: RetentionMode;
    allowUserByoProvider: boolean;
    defaultProviderId: string;
    defaultModelId: string;
  };
  multiTenant: {
    defaultTenantSlug: string;
    defaultTenantName: string;
  };
  devAuth: {
    email: string;
    displayName: string;
    role: "service_admin" | "company_admin" | "tenant_admin" | "user" | "auditor";
  };
};

type Env = Record<string, string | undefined>;

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === "") {
    return fallback;
  }
  return value.toLowerCase() === "true" || value === "1" || value.toLowerCase() === "yes";
}

function readDeploymentMode(value: string | undefined): DeploymentMode {
  if (value === "multi_tenant" || value === "single_company") {
    return value;
  }
  return "single_company";
}

function readRetention(value: string | undefined, fallback: RetentionMode): RetentionMode {
  return isRetentionMode(value) ? value : fallback;
}

function required(value: string | undefined, name: string, fallback?: string): string {
  if (value != null && value !== "") {
    return value;
  }
  if (fallback != null) {
    return fallback;
  }
  throw new Error(`Missing required environment variable ${name}`);
}

export function readAppConfig(env: Env = process.env): AppConfig {
  const deploymentMode = readDeploymentMode(env["APP_DEPLOYMENT_MODE"]);
  const defaultProviderId = required(env["DEFAULT_PROVIDER_ID"], "DEFAULT_PROVIDER_ID", "mock");
  const defaultModelId = required(env["DEFAULT_MODEL_ID"], "DEFAULT_MODEL_ID", "mock-chat");
  const kmsProvider = required(env["KMS_PROVIDER"], "KMS_PROVIDER", "local");

  if (kmsProvider !== "local" && kmsProvider !== "vault_transit" && kmsProvider !== "external") {
    throw new Error(`Unsupported KMS_PROVIDER ${kmsProvider}`);
  }

  return {
    deploymentMode,
    publicBaseUrl: required(env["PUBLIC_BASE_URL"], "PUBLIC_BASE_URL", "http://localhost:3000"),
    allowDevAuth: readBool(env["ALLOW_DEV_AUTH"], false),
    sessionCookieName: required(env["SESSION_COOKIE_NAME"], "SESSION_COOKIE_NAME", "agent_platform_session"),
    defaultProviderId,
    defaultModelId,
    databaseUrl: required(env["DATABASE_URL"], "DATABASE_URL", "postgresql://agent:agent@localhost:5432/agent_platform"),
    redisUrl: required(env["REDIS_URL"], "REDIS_URL", "redis://localhost:6379"),
    s3: {
      endpoint: required(env["S3_ENDPOINT"], "S3_ENDPOINT", "http://localhost:9000"),
      bucket: required(env["S3_BUCKET"], "S3_BUCKET", "agent-platform"),
      accessKeyId: required(env["S3_ACCESS_KEY_ID"], "S3_ACCESS_KEY_ID", "minio"),
      secretAccessKey: required(env["S3_SECRET_ACCESS_KEY"], "S3_SECRET_ACCESS_KEY", "minio-password")
    },
    kms: {
      provider: kmsProvider,
      localMasterKeyBase64: required(env["LOCAL_KMS_MASTER_KEY_BASE64"], "LOCAL_KMS_MASTER_KEY_BASE64", "dev-only-unsafe-master-key-32-bytes!!"),
      ...(env["VAULT_ADDR"] ? { vaultAddr: env["VAULT_ADDR"] } : {}),
      ...(env["VAULT_TRANSIT_KEY"] ? { vaultTransitKey: env["VAULT_TRANSIT_KEY"] } : {})
    },
    singleCompany: {
      tenantSlug: required(env["SINGLE_COMPANY_TENANT_SLUG"], "SINGLE_COMPANY_TENANT_SLUG", "acme"),
      tenantName: required(env["SINGLE_COMPANY_TENANT_NAME"], "SINGLE_COMPANY_TENANT_NAME", "Acme Internal AI"),
      ...(env["SINGLE_COMPANY_PRIMARY_DOMAIN"] ? { primaryDomain: env["SINGLE_COMPANY_PRIMARY_DOMAIN"] } : {}),
      defaultRetention: readRetention(env["SINGLE_COMPANY_DEFAULT_RETENTION"], "retained"),
      allowUserByoProvider: readBool(env["SINGLE_COMPANY_ALLOW_USER_BYO_PROVIDER"], false),
      defaultProviderId: required(env["SINGLE_COMPANY_DEFAULT_PROVIDER_ID"], "SINGLE_COMPANY_DEFAULT_PROVIDER_ID", defaultProviderId),
      defaultModelId: required(env["SINGLE_COMPANY_DEFAULT_MODEL_ID"], "SINGLE_COMPANY_DEFAULT_MODEL_ID", defaultModelId)
    },
    multiTenant: {
      defaultTenantSlug: required(env["MULTI_TENANT_DEFAULT_TENANT_SLUG"], "MULTI_TENANT_DEFAULT_TENANT_SLUG", "demo"),
      defaultTenantName: required(env["MULTI_TENANT_DEFAULT_TENANT_NAME"], "MULTI_TENANT_DEFAULT_TENANT_NAME", "Demo Tenant")
    },
    devAuth: {
      email: required(env["DEV_AUTH_EMAIL"], "DEV_AUTH_EMAIL", "admin@acme.example"),
      displayName: required(env["DEV_AUTH_DISPLAY_NAME"], "DEV_AUTH_DISPLAY_NAME", "Development Admin"),
      role: (env["DEV_AUTH_ROLE"] as AppConfig["devAuth"]["role"] | undefined) ?? "company_admin"
    }
  };
}

export function publicConfig(config: AppConfig): {
  deploymentMode: DeploymentMode;
  companyName: string | null;
  allowDevAuth: boolean;
  defaultProviderId: string;
  defaultModelId: string;
} {
  return {
    deploymentMode: config.deploymentMode,
    companyName: config.deploymentMode === "single_company" ? config.singleCompany.tenantName : null,
    allowDevAuth: config.allowDevAuth,
    defaultProviderId: config.defaultProviderId,
    defaultModelId: config.defaultModelId
  };
}
