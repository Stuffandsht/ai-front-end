import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/playwright",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ],
  webServer: {
    command: "ALLOW_DEV_AUTH=true npm run dev --workspace @agent-platform/web -- --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000/api/config/public",
    reuseExistingServer: true,
    timeout: 30_000
  }
});
