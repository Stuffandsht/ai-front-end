import { readFile } from "node:fs/promises";

const compose = await readFile(new URL("../docker-compose.yml", import.meta.url), "utf8");
const requiredSnippets = [
  "profiles:",
  "- single-company",
  "- multi-tenant",
  "postgres:",
  "valkey/valkey",
  "minio/minio",
  "APP_DEPLOYMENT_MODE"
];

const missing = requiredSnippets.filter((snippet) => !compose.includes(snippet));
if (missing.length > 0) {
  console.error(`docker-compose.yml is missing expected snippets: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("docker-compose.yml contains app, Postgres, Valkey, MinIO, and deployment profiles.");
