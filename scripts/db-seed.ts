import { readAppConfig } from "@agent-platform/config";
import { createLocalRuntime } from "@agent-platform/runtime";

const services = await createLocalRuntime(readAppConfig());
const tenants = services.db.listTenants();

console.log(
  JSON.stringify(
    {
      deploymentMode: services.config.deploymentMode,
      tenants: tenants.map((tenant) => ({
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name
      })),
      devUser: {
        id: services.devUser.id,
        email: services.devUser.email
      },
      providerCount: services.db.snapshot().providerConfigs.length,
      promptCount: services.db.snapshot().promptFragments.length
    },
    null,
    2
  )
);
