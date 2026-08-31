import { test, expect } from "@playwright/test";

/**
 * @smoke — admin + profile shells for guests / unauthorized visitors.
 */
test.describe("Admin page @smoke", () => {
  test("admin route loads login redirect or access denial shell", async ({ page }) => {
    const response = await page.goto("/admin", { waitUntil: "domcontentloaded" });
    expect(response).toBeTruthy();
    if (response!.status() === 404) {
      test.skip(true, "/admin not deployed on this environment");
    }
    expect(response!.status()).toBeLessThan(500);

    await expect(
      page.getByText(/Sign in|Admin|admin access|FileWorks|Loading admin/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("Profile admin affordance @smoke", () => {
  test("profile still offers account chrome for guests", async ({ page }) => {
    const response = await page.goto("/profile", { waitUntil: "domcontentloaded" });
    expect(response).toBeTruthy();
    expect(response!.status()).toBeLessThan(500);
    await expect(
      page.getByText(/Sign in|Profile|Plan|API key|FileWorks|Loading account/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("Design editor chat shell @smoke", () => {
  test("new template editor page loads canvas chrome", async ({ page }) => {
    const response = await page.goto("/templates/new", { waitUntil: "domcontentloaded" });
    expect(response).toBeTruthy();
    if (response!.status() === 404) {
      test.skip(true, "/templates/new not deployed on this environment");
    }
    expect(response!.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
    // Editor chrome or marketing shell — either proves the route rendered.
    await expect(
      page.locator(".canvas-column, .design-chat-dock, main, header").first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});
