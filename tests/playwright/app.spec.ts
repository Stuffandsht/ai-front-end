import { expect, test, type Page } from "@playwright/test";

test("development login protects chat and enables retained chat request", async ({ page }) => {
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Development auth")).toBeVisible();

  await devLogin(page);
  await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible();

  await page.getByLabel("Message").fill("playwright retained chat");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator("body")).toContainText("message_done");
  await expect(page.locator("body")).toContainText("retained");
});

test("single-company mode hides service and tenant administration", async ({ page }) => {
  await devLogin(page);

  await expect(page.getByRole("link", { name: "Service" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Tenants" })).toHaveCount(0);

  await page.goto("/admin/service");
  await expect(page.locator("body")).toContainText("404");
  await page.goto("/admin/tenants");
  await expect(page.locator("body")).toContainText("404");
});

test("chat UI does not persist messages in browser storage", async ({ page }) => {
  await devLogin(page);

  const storageSnapshot = await page.evaluate(() => ({
    localStorageKeys: Object.keys(window.localStorage),
    sessionStorageKeys: Object.keys(window.sessionStorage)
  }));

  expect(storageSnapshot.localStorageKeys).toEqual([]);
  expect(storageSnapshot.sessionStorageKeys).toEqual([]);
});

async function devLogin(page: Page): Promise<void> {
  const response = await page.request.post("/api/auth/dev", {
    multipart: {
      email: "admin@acme.example"
    }
  });
  expect(response.ok()).toBe(true);
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/chat$/);
}
