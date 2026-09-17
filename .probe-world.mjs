import { chromium } from "playwright";
const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto("http://127.0.0.1:3070/landing/v3", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(3000);
for (const p of [0, 0.5]) {
  await page.evaluate((v) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, max * v);
  }, p);
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    const r = c.getBoundingClientRect();
    return {
      world: window.__world,
      canvas: { w: r.width, h: r.height, top: r.top, visible: getComputedStyle(c).visibility, opacity: getComputedStyle(c.parentElement).opacity },
      scrollY: window.scrollY,
      docH: document.documentElement.scrollHeight,
    };
  });
  console.log(p, JSON.stringify(info));
}
await browser.close();
