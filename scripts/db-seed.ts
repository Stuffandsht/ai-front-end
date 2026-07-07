import { readAppConfig } from "@agent-platform/config";
import { createRuntime } from "@agent-platform/runtime";

const services = await createRuntime(readAppConfig());
const tenants = await services.db.listTenants();
const snapshot = await services.db.snapshot();

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
      databaseMode: services.config.databaseMode,
      providerCount: snapshot.providerConfigs.length,
      promptCount: snapshot.promptFragments.length
    },
    null,
    2
  )
);
