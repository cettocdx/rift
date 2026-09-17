import { chromium } from "playwright";

const url = "http://127.0.0.1:3070/landing/v3";
const dir = "/private/tmp/claude-501/-Users-cetto-Developer/693ef69c-36b9-41a6-ba1f-6ae90c92bd57/scratchpad";

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 180)); });
page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 180)));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.mouse.move(720, 450);
await page.waitForTimeout(7000);
await page.screenshot({ path: `${dir}/w-0.png` });

const shots = [0.18, 0.5, 0.78];
for (let i = 0; i < shots.length; i++) {
  await page.evaluate((p) => {
    const el = document.getElementById("top");
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = max * p;
  }, shots[i]);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${dir}/w-${i + 1}.png` });
}

console.log(JSON.stringify({
  world: await page.evaluate(() => window.__world ?? null),
  errors: errors.slice(0, 5),
}, null, 1));
await browser.close();
