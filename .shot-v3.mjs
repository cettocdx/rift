import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:3070/landing/v3";
const out = process.argv[3] ?? "/private/tmp/claude-501/-Users-cetto-Developer/693ef69c-36b9-41a6-ba1f-6ae90c92bd57/scratchpad/v3.png";
const waitMs = Number(process.argv[4] ?? 4000);

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
// Nudge the pointer so the trail has something to answer.
await page.mouse.move(1000, 420);
await page.waitForTimeout(waitMs);
await page.mouse.move(1080, 380, { steps: 12 });
await page.waitForTimeout(700);

const diag = await page.evaluate(() => ({
  vis: document.visibilityState,
  tick: window.__heroTick ?? null,
  field: window.__heroField ?? null,
}));

await page.screenshot({ path: out });
console.log(JSON.stringify({ diag, errors: errors.slice(0, 5) }, null, 1));
await browser.close();
