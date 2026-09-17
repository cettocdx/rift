import { chromium } from "playwright";
const browser = await chromium.launch({ args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto("http://127.0.0.1:3070/landing/v3", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(2500);
console.log(JSON.stringify(await page.evaluate(() => {
  const c = document.querySelector("canvas");
  const chain = [];
  let el = c;
  while (el && el !== document.documentElement) {
    const s = getComputedStyle(el);
    chain.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || "").toString().slice(0, 60),
      position: s.position,
      transform: s.transform,
      filter: s.filter,
      willChange: s.willChange,
      contain: s.contain,
      perspective: s.perspective,
    });
    el = el.parentElement;
  }
  const html = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  return { chain, htmlOverflow: html.overflow, htmlHeight: html.height, bodyOverflow: body.overflow, bodyHeight: body.height,
           scrollingElement: document.scrollingElement === document.documentElement ? "html" : "other",
           docScrollTop: document.documentElement.scrollTop, bodyScrollTop: document.body.scrollTop };
}), null, 1));
await browser.close();
