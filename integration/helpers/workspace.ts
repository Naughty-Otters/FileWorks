import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

function mimeFor(name: string): string {
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "text/markdown";
  return "text/plain";
}

/** Wait until the client workspace is hydrated (critical for local `next dev`). */
export async function waitForWorkspaceReady(page: Page) {
  await expect(page.getByText(/FileWorks/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Upload document" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: /^Convert$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Options" })).toBeVisible();
  await expect(page.locator('input[type="file"]').first()).toBeAttached();
}

/**
 * Upload a local fixture into the workspace dropzone.
 * Retries until the filename appears — local Next hydration can miss the first change event.
 */
export async function uploadWorkspaceFile(page: Page, filePath: string) {
  const name = path.basename(filePath);
  const buffer = fs.readFileSync(filePath);
  const input = page.locator('input[type="file"]').first();
  await expect(input).toBeAttached();

  await expect(async () => {
    await input.setInputFiles({
      name,
      mimeType: mimeFor(name),
      buffer,
    });
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000, intervals: [200, 500, 1_000] });

  await expect(page.getByRole("button", { name: /^Convert$/i })).toBeEnabled({
    timeout: 5_000,
  });
}

/** Open Produce as and wait for the dialog. */
export async function openProduceAs(page: Page) {
  const produce = page.getByRole("button", { name: /Produce as/i });
  await expect(produce).toBeVisible();
  await expect(async () => {
    if ((await produce.getAttribute("aria-expanded")) !== "true") {
      await produce.click();
    }
    await expect(produce).toHaveAttribute("aria-expanded", "true", { timeout: 1_500 });
    await expect(page.getByRole("dialog", { name: /Produce as/i })).toBeVisible({
      timeout: 1_500,
    });
  }).toPass({ timeout: 15_000, intervals: [300, 600, 1_000] });
  return produce;
}

/** Open the workspace Options popover and wait until parse toggles render. */
export async function openWorkspaceOptions(page: Page) {
  const btn = page.getByRole("button", { name: "Options" });
  await expect(btn).toBeVisible();

  const panelMarker = page.getByText("Read with AI", { exact: true });
  if ((await btn.getAttribute("aria-expanded")) === "true" && (await panelMarker.count()) > 0) {
    return;
  }

  await btn.click();
  try {
    await expect(panelMarker).toBeVisible({ timeout: 2_000 });
  } catch {
    // Opening click can race hydration / outside-dismiss on local next dev.
    await btn.click();
    await expect(panelMarker).toBeVisible({ timeout: 5_000 });
  }
  await expect(btn).toHaveAttribute("aria-expanded", "true");
}
