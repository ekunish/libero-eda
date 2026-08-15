import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

function visiblyChangedPixelRatio(before: Buffer, after: Buffer, channelThreshold = 6): number {
  const first = PNG.sync.read(before);
  const second = PNG.sync.read(after);
  expect({ width: first.width, height: first.height }).toEqual({
    width: second.width,
    height: second.height,
  });
  let changed = 0;
  for (let offset = 0; offset < first.data.length; offset += 4) {
    const red = Math.abs((first.data[offset] ?? 0) - (second.data[offset] ?? 0));
    const green = Math.abs((first.data[offset + 1] ?? 0) - (second.data[offset + 1] ?? 0));
    const blue = Math.abs((first.data[offset + 2] ?? 0) - (second.data[offset + 2] ?? 0));
    if (Math.max(red, green, blue) >= channelThreshold) changed += 1;
  }
  return changed / (first.width * first.height);
}

test.describe.configure({ timeout: 90_000 });

test("Brand metadata, icons, manifest, and legal pages are published", async ({
  page,
  request,
}) => {
  await page.goto("/data/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://libero-eda.vercel.app/data/",
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://libero-eda.vercel.app/brand/social-card.png",
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  await expect(page.locator('meta[name="twitter:creator"]')).toHaveAttribute("content", "@ekunish");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );

  for (const [path, contentType] of [
    ["/favicon.ico", "image/vnd.microsoft.icon"],
    ["/brand/apple-touch-icon.png", "image/png"],
    ["/brand/social-card.png", "image/png"],
  ] as const) {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain(contentType);
  }

  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({
    name: "LIBERO EDA",
    start_url: "/data/",
    display: "standalone",
    background_color: "#f4f3ef",
    theme_color: "#2f6f62",
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192", purpose: "any" }),
      expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
    ]),
  );

  await page.getByRole("button", { name: "About LIBERO EDA" }).click();
  await page.getByRole("menuitem", { name: "Privacy notice" }).click();
  await expect(page.getByRole("heading", { name: "Privacy Notice" })).toBeVisible();
  await expect(page.getByText("libero-eda.video-orientation.v1")).toBeVisible();
  await expect(page.getByText(/Vercel/i)).toHaveCount(0);

  await page.goto("/terms/");
  await expect(page.getByRole("heading", { name: "Terms of Use" })).toBeVisible();
  await expect(page.getByText(/Apache License 2.0/)).toBeVisible();
  await expect(page.getByText(/laws of Japan/)).toBeVisible();
});

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

test("LIBERO-Plus replay starts at episode frame zero and stays synchronized", async ({ page }) => {
  await page.goto("/replay/?replay_id=demo-99&replay_scope=task");
  await expect(
    page.getByTestId("replay-command-bar").getByText("LIBERO-Plus training record"),
  ).toBeVisible();

  const front = page.locator('video[aria-label="Front / agentview synchronized video"]');
  await expect
    .poll(() => front.evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThan(0);
  await expect
    .poll(() => front.evaluate((video: HTMLVideoElement) => video.duration))
    .toBeCloseTo(5.65, 2);
  await expect
    .poll(() => front.evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeLessThan(0.1);
  await expect(front).toHaveCSS("transform", "matrix(-1, 0, 0, -1, 0, 0)");
  await expect.poll(() => front.evaluate((video: HTMLVideoElement) => video.ended)).toBe(false);

  const toolbar = page.getByTestId("video-orientation-toolbar-agentview");
  const media = page.getByTestId("video-media-agentview");
  const [toolbarBox, mediaBox] = await Promise.all([toolbar.boundingBox(), media.boundingBox()]);
  expect(toolbarBox).not.toBeNull();
  expect(mediaBox).not.toBeNull();
  expect(toolbarBox?.x ?? 1).toBeLessThan(mediaBox?.x ?? 0);

  const playhead = page.getByLabel("Replay playhead");
  const frameBefore = await playhead.inputValue();
  const spatial = page.getByTestId("spatial-viewport");
  await page.waitForTimeout(500);
  const rainbowBefore = await spatial.screenshot();
  await page.waitForTimeout(750);
  const rainbowAfter = await spatial.screenshot();
  // The trajectory is intentionally a thin centerline with no translucent halo.
  expect(visiblyChangedPixelRatio(rainbowBefore, rainbowAfter)).toBeGreaterThanOrEqual(0.0009);
  expect(await playhead.inputValue()).toBe(frameBefore);

  await page.getByRole("button", { name: "Play" }).click();
  await expect
    .poll(() => front.evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(0.1);
  await expect
    .poll(async () => Number(await page.getByLabel("Replay playhead").inputValue()))
    .toBeGreaterThan(1);
  await page.getByRole("button", { name: "Pause" }).click();
});

test("Replay exposes camera controls and current EEF orientation without result badges", async ({
  page,
}) => {
  await page.goto("/replay/?replay_id=original-libero-libero_spatial-001-00&replay_scope=task");
  await expect(page.getByRole("button", { name: "Front sync" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Oblique" })).toBeVisible();
  await expect(page.getByTestId("current-rotation-vector")).toContainText("[");
  await expect(page.getByText("Scene & camera")).toHaveCount(0);
  await expect(page.getByText("x / y / z [m]", { exact: true })).toHaveCount(0);
  await expect(
    page.getByTestId("replay-command-bar").getByText("Success", { exact: true }),
  ).toHaveCount(0);
  const legend = page.getByRole("figure", {
    name: "Trajectory hue by gripper command and opacity by passage",
  });
  await expect(legend).toContainText("Open command");
  await expect(legend).toContainText("Close command");
  await expect(legend).toContainText("Passed");
  await expect(legend).toContainText("Current");
  await expect(legend).toContainText("Ahead");
  await expect(legend).toContainText("Current position · follows trajectory hue");
  await expect(legend).toContainText("Rainbow flows continuously");
  const front = page.locator('video[aria-label="Front / agentview synchronized video"]');
  await expect(front).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");

  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await expect(page.getByTestId("scene-model-loading")).toHaveCount(0, { timeout: 30_000 });
});

test("Reduced motion freezes rainbow flow without removing trajectory semantics", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/replay/?replay_id=demo-99&replay_scope=task");
  const legend = page.getByRole("figure", {
    name: "Trajectory hue by gripper command and opacity by passage",
  });
  await expect(legend).toContainText("Rainbow frozen by reduced-motion");
  await expect(
    page.getByRole("img", { name: /Rainbow motion is frozen by the reduced-motion preference/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  const spatial = page.getByTestId("spatial-viewport");
  await page.waitForTimeout(500);
  const first = await spatial.screenshot();
  await page.waitForTimeout(500);
  const second = await spatial.screenshot();
  expect(first.equals(second)).toBe(true);
});

test("Recorded Data opens a replay and keeps its ID across reload", async ({ page }) => {
  await page.goto("/data/?task=libero%3Alibero_spatial%3A1");
  if (await page.evaluate(() => matchMedia("(max-width: 1279px)").matches)) {
    await page
      .getByRole("button", {
        name: /pick up the black bowl between the plate.*Spatial #1.*records/,
      })
      .click();
  }
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
