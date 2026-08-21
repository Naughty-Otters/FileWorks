import { test, expect } from "@playwright/test";
import { fixtures, UI_OPTION_LABELS } from "../helpers/fixtures";
import { getEnv } from "../helpers/env";
import {
  openWorkspaceOptions,
  uploadWorkspaceFile,
  waitForWorkspaceReady,
} from "../helpers/workspace";

test.describe("Workspace UI — upload and options", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForWorkspaceReady(page);
  });

  test("dropzone accepts a text fixture", async ({ page }) => {
    await uploadWorkspaceFile(page, fixtures.txt);
    await expect(page.getByText("sample.txt").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Convert$/i })).toBeEnabled();
  });

  test("Options panel exposes core parse toggles", async ({ page }) => {
    await openWorkspaceOptions(page);

    const preferred = [
      UI_OPTION_LABELS.use_ai,
      UI_OPTION_LABELS.prefer_structure,
      UI_OPTION_LABELS.preserve_images,
    ];
    for (const label of preferred) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test("toggling Prefer structure updates the checkbox", async ({ page }) => {
    await openWorkspaceOptions(page);
    const prefer = page.getByRole("checkbox", { name: /Prefer structure/i });
    await expect(prefer).toBeVisible();
    const before = await prefer.isChecked();
    await prefer.click({ force: true });
    await expect(prefer).toHaveJSProperty("checked", !before);
  });

  test("Produce as / target layout control opens when present", async ({ page }) => {
    const produce = page.getByRole("button", { name: /Produce as/i });
    test.skip((await produce.count()) === 0, "Produce-as control not on this build");
    await expect(produce).toBeEnabled();

    await expect(async () => {
      if ((await produce.getAttribute("aria-expanded")) !== "true") {
        await produce.click();
      }
      await expect(produce).toHaveAttribute("aria-expanded", "true", { timeout: 1_500 });
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 15_000, intervals: [300, 600, 1_000] });

    await expect(page.getByRole("dialog").getByText(/Produce as|Markdown/i).first()).toBeVisible();
  });

  test("guest Convert is gated (sign-in prompt)", async ({ page }) => {
    const env = getEnv();
    if (env.storageState) {
      test.skip(true, "Signed-in storage state present; guest gate not applicable");
    }

    const convert = page.getByRole("button", { name: /^Convert$/i });
    await expect(convert).toBeDisabled();

    await uploadWorkspaceFile(page, fixtures.txt);
    await expect(convert).toBeEnabled();
    await convert.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Sign in to convert|Sign in|Free Basic/i).first()).toBeVisible();
  });
});
