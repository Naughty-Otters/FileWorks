import { test, expect } from "@playwright/test";
import { fixtures, UI_OPTION_LABELS } from "../helpers/fixtures";
import { getEnv } from "../helpers/env";
import {
  openProduceAs,
  openWorkspaceOptions,
  produceAsToolbarButton,
  uploadWorkspaceFile,
  waitForWorkspaceReady,
} from "../helpers/workspace";

test.describe("Workspace UI — upload and options", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForWorkspaceReady(page);
  });

  test("empty workspace shows Source meets Intent composition", async ({ page }) => {
    await expect(page.getByText(/Drop a file\. Choose what to produce/i).first()).toBeVisible();
    await expect(page.getByText(/Source is your file/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload document" })).toBeVisible();
    await expect(page.getByText(/You’ll get Markdown/i)).toBeVisible();
    await expect(produceAsToolbarButton(page)).toBeVisible();
    await expect(produceAsToolbarButton(page)).toContainText(/Produce as|Markdown/i);
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

  test("Produce as dialog opens with Markdown default and starter Intent", async ({ page }) => {
    const produce = produceAsToolbarButton(page);
    test.skip((await produce.count()) === 0, "Produce-as control not on this build");

    await openProduceAs(page);
    const dialog = page.getByRole("dialog", { name: /Produce as/i });
    await expect(dialog.getByRole("radio", { name: /Markdown/i })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: /Starter design/i })).toBeVisible();
    await expect(dialog.getByRole("listbox", { name: /Starter design/i })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Family" })).toBeVisible();
    await expect(dialog.getByRole("radio", { name: /My design/i })).toBeVisible();
  });

  test("empty Source Produce as CTA opens the Intent dialog", async ({ page }) => {
    const cta = page
      .getByRole("button", { name: "Upload document" })
      .locator("xpath=following-sibling::button[normalize-space()='Produce as']");
    test.skip((await cta.count()) === 0, "Empty-state Produce as CTA not on this build");
    await cta.click();
    await expect(page.getByRole("dialog", { name: /Produce as/i })).toBeVisible();
    await expect(page.getByRole("listbox", { name: /Starter design/i })).toBeVisible();
  });

  test("guest Convert is gated (sign-in prompt)", async ({ page }) => {
    const env = getEnv();
    if (env.storageState) {
      test.skip(true, "Signed-in storage state present; guest gate not applicable");
    }

    // Convert is icon-only; accessible name remains "Convert".
    const convert = page.getByRole("button", { name: /^Convert$/i });
    await expect(convert).toBeDisabled();

    await uploadWorkspaceFile(page, fixtures.txt);
    await expect(convert).toBeEnabled();
    await convert.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Sign in to convert|Sign in|Free Casual/i).first()).toBeVisible();
  });

  test("pane toggle rail appears on the far left when a pane is closed", async ({ page }) => {
    await expect(page.getByRole("navigation", { name: "Workspace panes" })).toHaveCount(0);

    await page.getByRole("button", { name: "Hide history" }).click();
    const toggles = page.getByRole("navigation", { name: "Workspace panes" });
    // New chrome (this branch). Staging may still be on the prior rail until deploy.
    test.skip((await toggles.count()) === 0, "Workspace panes toggle rail not deployed on this env");

    await expect(toggles).toBeVisible();
    await expect(toggles.getByRole("button", { name: "Show history" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(toggles.getByRole("button", { name: "Source" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(toggles.getByText(/^\d+$/)).toHaveCount(0);

    await toggles.getByRole("button", { name: "Show history" }).click();
    await expect(page.getByRole("button", { name: "Hide history" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Workspace panes" })).toHaveCount(0);
  });
});

test.describe("Workspace UI — Produce as starter picker", () => {
  test.beforeEach(async ({ page }) => {
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
    await expect(
      list.getByRole("option", { name: /family schedule|family planner|family calendar/i }).first(),
    ).toBeVisible();
    await expect(list.getByRole("option", { name: /Client invoice/i })).toHaveCount(0);

    await dialog.getByRole("button", { name: "All" }).click();
    const search = dialog.getByPlaceholder("Search designs…");
    await search.fill("invoice");
    await expect(list.getByRole("option", { name: /Client invoice/i })).toBeVisible();
    await expect(list.getByRole("option", { name: /Daily family schedule/i })).toHaveCount(0);

    await list.getByRole("option", { name: /Client invoice/i }).click();
    await expect(dialog.getByRole("radio", { name: /Starter design/i })).toBeChecked();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(produceAsToolbarButton(page)).toContainText(/Client invoice|invoice/i);
    // Run action may be icon-only; accessible name still carries Fill {design}.
    await expect(page.getByRole("button", { name: /Fill Client invoice/i })).toBeVisible();
    await expect(page.getByText(/You’ll get Client invoice/i)).toBeVisible();
  });

  test("?produce= deep link preselects starter Intent", async ({ page }) => {
    await page.goto("/?produce=invoice", { waitUntil: "domcontentloaded" });
    await waitForWorkspaceReady(page);
    await expect(page.getByRole("button", { name: /Fill Client invoice/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/You’ll get Client invoice/i)).toBeVisible();
    await expect(produceAsToolbarButton(page)).toContainText(/Client invoice|invoice/i);
  });
});
