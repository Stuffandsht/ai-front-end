import { readAppConfig, type AppConfig, type DeploymentMode } from "@agent-platform/config";
import { createLocalRuntime } from "@agent-platform/runtime";

export function testConfig(overrides: Record<string, string | undefined> = {}): AppConfig {
  return readAppConfig({
    APP_DEPLOYMENT_MODE: "single_company",
    PUBLIC_BASE_URL: "http://localhost:3000",
    ALLOW_DEV_AUTH: "true",
    SESSION_COOKIE_NAME: "agent_platform_session",
    SINGLE_COMPANY_TENANT_SLUG: "acme",
    SINGLE_COMPANY_TENANT_NAME: "Acme Internal AI",
    SINGLE_COMPANY_PRIMARY_DOMAIN: "acme.example",
    SINGLE_COMPANY_DEFAULT_RETENTION: "retained",
    SINGLE_COMPANY_ALLOW_USER_BYO_PROVIDER: "false",
    SINGLE_COMPANY_DEFAULT_PROVIDER_ID: "mock",
    SINGLE_COMPANY_DEFAULT_MODEL_ID: "mock-chat",
    MULTI_TENANT_DEFAULT_TENANT_SLUG: "demo",
    MULTI_TENANT_DEFAULT_TENANT_NAME: "Demo Tenant",
    DEV_AUTH_EMAIL: "admin@acme.example",
    DEV_AUTH_DISPLAY_NAME: "Development Admin",
    DEV_AUTH_ROLE: "company_admin",
    DATABASE_URL: "postgresql://agent:agent@localhost:5432/agent_platform",
    REDIS_URL: "redis://localhost:6379",
    S3_ENDPOINT: "http://localhost:9000",
    S3_BUCKET: "agent-platform",
    S3_ACCESS_KEY_ID: "minio",
    S3_SECRET_ACCESS_KEY: "minio-password",
    KMS_PROVIDER: "local",
    LOCAL_KMS_MASTER_KEY_BASE64: "unit-test-local-master-key-material",
    DEFAULT_PROVIDER_ID: "mock",
    DEFAULT_MODEL_ID: "mock-chat",
    ...overrides
  });
}

export async function createTestRuntime(mode: DeploymentMode = "single_company", overrides: Record<string, string | undefined> = {}): ReturnType<typeof createLocalRuntime> {
  return createLocalRuntime(
    testConfig({
      APP_DEPLOYMENT_MODE: mode,
      DEV_AUTH_ROLE: mode === "multi_tenant" ? "service_admin" : "company_admin",
      ...overrides
    })
  );
}

export function uniqueSentinel(prefix = "SENTINEL_EPHEMERAL_DO_NOT_STORE"): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
