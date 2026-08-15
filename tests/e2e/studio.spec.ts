import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("Recorded Data loads both public trajectory datasets", async ({ page }) => {
  await page.goto("/data?task=libero%3Alibero_spatial%3A1");
  await expect(page.getByRole("button", { name: /Original LIBERO/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page
    .getByRole("button", {
      name: /pick up the black bowl between the plate.*Spatial #1.*records/,
    })
    .click();
  if (await page.evaluate(() => matchMedia("(max-width: 1279px)").matches)) {
    await expect(page).toHaveURL(/sheet=recording/);
    await page.reload();
  }
  await expect(
    page.getByRole("heading", {
      name: "pick up the black bowl between the plate and the ramekin and place it on the plate",
    }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Records for the selected task" })).toBeVisible();
  const thumbnail = page.locator('img[alt^="Front preview for"]:visible').first();
  await expect(thumbnail).toBeVisible();
  await expect(thumbnail).toHaveJSProperty("complete", true);

  const closeRecords = page.getByRole("button", { name: "Close records" });
  if (await closeRecords.isVisible()) await closeRecords.click();
  await page.getByRole("button", { name: /LIBERO-Plus Training/ }).click();
  await expect(page.getByRole("button", { name: /LIBERO-Plus Training/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page
    .getByRole("button", {
      name: /pick up the black bowl between the plate.*Spatial #1.*records/,
    })
    .click();
  await expect(
    page
      .locator("span:visible")
      .filter({ hasText: /^Dataset episode #/ })
      .first(),
  ).toBeVisible();
});

test("Evaluation is sourced from the pinned official repository and has no Track 1 mode", async ({
  page,
}) => {
  await page.goto("/evaluation?condition=plus%3Alibero_goal%3A1099&sheet=condition");
  await expect(
    page.getByRole("heading", {
      name: "Please make sure the middle drawer of the cabinet is open",
    }),
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="evaluation-condition-detail"]:visible').getByText("L3").first(),
  ).toBeVisible();
  const closeDetails = page.getByRole("button", { name: "Close condition details" });
  if (await closeDetails.isVisible()) {
    await closeDetails.click();
    await expect(page).not.toHaveURL(/sheet=condition/);
  }
  const matrix = page.locator("h2:visible", { hasText: "Condition matrix" });
  if (!(await matrix.isVisible())) await page.getByRole("button", { name: "Filters" }).click();
  await expect(matrix).toBeVisible();
  await expect(page.getByText(/Track 1/)).toHaveCount(0);
});

test("Sources states exact training and evaluation provenance", async ({ page }) => {
  await page.goto("/sources");
  const trainingSource = page.getByRole("button", { name: /Sylvest\/libero_plus_lerobot/ });
  await expect(trainingSource).toBeVisible();
  await trainingSource.click();
  await expect(page.getByRole("heading", { name: "Sylvest/libero_plus_lerobot" })).toBeVisible();
  const evaluationSource = page.getByRole("button", { name: /sylvestf\/LIBERO-plus/ });
  await expect(evaluationSource).toBeVisible();
  await evaluationSource.click();
  await expect(page.getByRole("heading", { name: "sylvestf/LIBERO-plus" })).toBeVisible();
  await expect(page.getByText(/PARC/)).toHaveCount(0);
});

test("Replay loads hosted series, media, and the task navigator", async ({ page }) => {
  await page.goto("/replay/?replay_id=original-libero-libero_spatial-001-00&replay_scope=task");
  await expect(
    page.getByTestId("replay-command-bar").getByText("Original LIBERO demo"),
  ).toBeVisible();
  await expect(page.getByText("Synchronized cameras")).toBeVisible();
  await expect(page.getByTestId("video-panel")).toBeVisible();
  await expect(page.getByRole("link", { name: /Next record/i })).toBeVisible();
});

test("Recorded Data opens a replay and keeps its ID across reload", async ({ page }) => {
  await page.goto("/data/?task=libero%3Alibero_spatial%3A1");
  const records = page.getByRole("list", { name: "Records for the selected task" });
  await expect(records).toBeVisible();
  const replay = records.getByRole("link", { name: /Demo 1.*Replay/ }).first();
  await expect(replay).toHaveAttribute(
    "href",
    /^\/replay\/\?replay_id=original-libero-libero_spatial-001-00&/,
  );

  await replay.click();
  await expect(page).toHaveURL(/\/replay\/\?.*replay_id=original-libero-libero_spatial-001-00/);
  await expect(
    page.getByTestId("replay-command-bar").getByText("Original LIBERO demo"),
  ).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/replay\/\?.*replay_id=original-libero-libero_spatial-001-00/);
  await expect(
    page.getByTestId("replay-command-bar").getByText("Original LIBERO demo"),
  ).toBeVisible();
});

test("2K pages stay within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 1152 });
  for (const path of ["/data", "/evaluation", "/sources"] as const) {
    await page.goto(path);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(2049);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
      .toBeLessThanOrEqual(1153);
  }
});
