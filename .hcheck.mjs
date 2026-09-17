import { chromium } from "playwright";
const ctx = await chromium.launchPersistentContext(
  "/private/tmp/claude-501/-Users-cetto-Developer/088c0a83-d8f4-4106-8e50-78188779a1df/scratchpad/pw-profile",
  { headless: true, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 },
);
const p = ctx.pages()[0] ?? (await ctx.newPage());
await p.goto("http://localhost:3060", { waitUntil: "domcontentloaded", timeout: 120000 });
await p.waitForTimeout(6000);
console.log("textarea:", await p.locator("textarea").count());
console.log("viewport:", JSON.stringify(await p.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }))));
await ctx.close();
