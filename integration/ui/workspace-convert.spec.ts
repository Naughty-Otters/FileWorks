import { test, expect } from "@playwright/test";
import { fixtures } from "../helpers/fixtures";
import { getEnv } from "../helpers/env";
import {
  openWorkspaceOptions,
  uploadWorkspaceFile,
  waitForWorkspaceReady,
} from "../helpers/workspace";

/**
 * Full workspace convert requires a signed-in Google session.
 * Provide FW_STORAGE_STATE=.auth/user.json (see README) to enable these.
 */
test.describe("Workspace UI — signed-in convert @convert", () => {
  test.beforeEach(async ({ page }) => {
    const env = getEnv();
    test.skip(
      !env.storageState,
      "Set FW_STORAGE_STATE to a Playwright storage file from a signed-in session",
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForWorkspaceReady(page);
  });

  test("convert sample.txt to editable Markdown", async ({ page }) => {
    await uploadWorkspaceFile(page, fixtures.txt);

    const convert = page.getByRole("button", { name: /^Convert$/i }).first();
    await expect(convert).toBeEnabled({ timeout: 15_000 });
    await convert.click();

    await expect(
      page.locator('[aria-label="Editable Markdown preview"]'),
    ).toBeVisible({ timeout: getEnv().convertTimeoutMs });
    await expect(page.locator('[aria-label="Editable Markdown preview"]')).toContainText(
      /FileWorks|Hello|sample/i,
    );
  });

  test("convert with Prefer structure option enabled", async ({ page }) => {
    await openWorkspaceOptions(page);
    const prefer = page.getByRole("checkbox", { name: /Prefer structure/i });
    if ((await prefer.count()) > 0 && !(await prefer.isChecked())) {
      await prefer.click({ force: true });
    }
    await page.keyboard.press("Escape");

    await uploadWorkspaceFile(page, fixtures.pdf);
    const convert = page.getByRole("button", { name: /^Convert$/i }).first();
    await expect(convert).toBeEnabled({ timeout: 15_000 });
    await convert.click();
    await expect(
      page.locator('[aria-label="Editable Markdown preview"]'),
    ).toBeVisible({ timeout: getEnv().convertTimeoutMs });
  });
});
