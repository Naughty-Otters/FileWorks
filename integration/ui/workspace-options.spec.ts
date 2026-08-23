import { test, expect } from "@playwright/test";
import { fixtures, UI_OPTION_LABELS } from "../helpers/fixtures";
import { getEnv } from "../helpers/env";
import {
  openProduceAs,
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

  test("Produce as dialog opens with Markdown default", async ({ page }) => {
    const produce = page.getByRole("button", { name: /Produce as/i });
    test.skip((await produce.count()) === 0, "Produce-as control not on this build");

    await openProduceAs(page);
    const dialog = page.getByRole("dialog", { name: /Produce as/i });
    await expect(dialog.getByRole("radio", { name: /Markdown/i })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: /My design/i })).toBeVisible();
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

test.describe("Workspace UI — Produce as starter picker", () => {
  test.beforeEach(async ({ page }) => {
    const env = getEnv();
    test.skip(
      !env.storageState,
      "Starter designs require a signed-in session (FW_STORAGE_STATE)",
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForWorkspaceReady(page);
  });

  test("starter design listbox supports category chips and search", async ({ page }) => {
    await openProduceAs(page);
    const dialog = page.getByRole("dialog", { name: /Produce as/i });

    await expect(dialog.getByRole("radio", { name: /Starter design/i })).toBeVisible();
    const list = dialog.getByRole("listbox", { name: /Starter design/i });
    await expect(list).toBeVisible();
    await expect(list.getByRole("option").first()).toBeVisible();

    await expect(dialog.getByRole("button", { name: "All" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Family" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Business" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "General" })).toBeVisible();

    await dialog.getByRole("button", { name: "Family" }).click();
    await expect(list.getByRole("option", { name: /family schedule|family planner|family calendar/i }).first()).toBeVisible();
    await expect(list.getByRole("option", { name: /Client invoice/i })).toHaveCount(0);

    await dialog.getByRole("button", { name: "All" }).click();
    const search = dialog.getByPlaceholder("Search designs…");
    await search.fill("invoice");
    await expect(list.getByRole("option", { name: /Client invoice/i })).toBeVisible();
    await expect(list.getByRole("option", { name: /Daily family schedule/i })).toHaveCount(0);

    await list.getByRole("option", { name: /Client invoice/i }).click();
    await expect(dialog.getByRole("radio", { name: /Starter design/i })).toBeChecked();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("button", { name: /Produce as/i })).toContainText(/Client invoice|invoice/i);
  });
});
