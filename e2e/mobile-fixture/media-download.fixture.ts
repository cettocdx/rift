import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const image = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#456789"/><text x="20" y="40">RIFT corrected receipt 2 — exact download bytes</text></svg>',
);

test("corrected image downloads exact bytes and can retry an HTTP failure without losing the draft", async ({
  page,
}, info) => {
  const errors: string[] = [];
  const downloads: string[] = [];
  const fetchedReceipts: string[] = [];
  let denyDownload = false;
  let deniedRequests = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:3043" || request.method() !== "GET") {
      errors.push("Unexpected service request");
      return route.abort();
    }
    if (
      url.pathname === "/scroll-fixture.svg" &&
      ["2", "3"].includes(url.searchParams.get("receipt") ?? "")
    ) {
      if (request.resourceType() === "fetch")
        fetchedReceipts.push(url.searchParams.get("receipt")!);
      if (denyDownload && request.resourceType() === "fetch") {
        deniedRequests++;
        return route.fulfill({ status: 403, body: "Access denied" });
      }
      return route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: image,
      });
    }
    return route.continue();
  });
  await page.goto("/lab/composer?codeLines=80");
  await page.evaluate(() => {
    (window as any).__fixtureDownload = {
      url: "/scroll-fixture.svg?receipt=2",
      deny: false,
      resolutions: 0,
    };
    (window as any).__transcript.code(true);
  });
  const row = page.locator('[data-message-id="code-lifecycle"]');
  await expect(row.locator("pre code")).toContainText("line79");
  await page.evaluate(() => {
    (window as any).__transcript.finishCode();
    (window as any).__transcript.lateFile(true);
    (window as any).__transcript.latest();
  });
  const draft = page.getByRole("textbox", { name: "Message RIFT" });
  await draft.fill("İndirirken bu taslağı koru.");
  const opener = row.getByRole("button", {
    name: "View final-frame.svg in full size",
    exact: true,
  });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Image viewer" });
  await expect(dialog).toBeVisible();
  const downloadButton = dialog.getByRole("button", {
    name: "Download image",
    exact: true,
  });
  const receive = async (filename: string) => {
    const pending = page.waitForEvent("download");
    await downloadButton.click();
    const file = await pending;
    expect(file.suggestedFilename()).toBe("final-frame.svg");
    expect(await file.failure()).toBeNull();
    const saved = info.outputPath(filename);
    await file.saveAs(saved);
    expect(await readFile(saved)).toEqual(image);
    await expect(downloadButton).toBeEnabled();
  };
  await expect(
    dialog.getByRole("img", { name: "final-frame.svg", exact: true }),
  ).toHaveAttribute(
    "src",
    /^(?:http:\/\/127\.0\.0\.1:3043)?\/scroll-fixture\.svg\?receipt=2$/,
  );
  const initialResolutions = await page.evaluate(() => {
    const fixture = (window as any).__fixtureDownload;
    fixture.url = "/scroll-fixture.svg?receipt=3";
    return fixture.resolutions;
  });
  await receive("first.svg");
  expect(fetchedReceipts).toEqual(["3"]);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__fixtureDownload.resolutions),
    )
    .toBe(initialResolutions + 1);
  await expect(
    dialog.getByRole("img", { name: "final-frame.svg", exact: true }),
  ).toHaveAttribute(
    "src",
    /^(?:http:\/\/127\.0\.0\.1:3043)?\/scroll-fixture\.svg\?receipt=3$/,
  );
  await page.evaluate(() => {
    (window as any).__fixtureDownload.deny = true;
  });
  await downloadButton.click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__fixtureDownload.resolutions),
    )
    .toBe(initialResolutions + 2);
  await expect(downloadButton).toBeEnabled();
  expect(downloads).toEqual(["final-frame.svg"]);
  expect(fetchedReceipts).toEqual(["3"]);
  await page.evaluate(() => {
    (window as any).__fixtureDownload.deny = false;
  });
  denyDownload = true;
  await downloadButton.click();
  await expect.poll(() => deniedRequests).toBe(1);
  await expect(downloadButton).toBeEnabled();
  expect(downloads).toEqual(["final-frame.svg"]);
  await expect(dialog).toBeVisible();
  denyDownload = false;
  await receive("retry.svg");
  expect(downloads).toEqual(["final-frame.svg", "final-frame.svg"]);
  await dialog
    .getByRole("button", { name: "Close image viewer", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(draft).toHaveValue("İndirirken bu taslağı koru.");
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("download-return.png") });
});
