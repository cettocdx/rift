const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { renderLaunchHtml } = require("./build");

// Exercise the generated offline document, including its real shared CSS.
// Disable navigation only: this fixture must never connect to a live app.
const html = renderLaunchHtml({
  appUrl: "http://localhost:3020",
  template: fs.readFileSync(
    path.join(__dirname, "launch.template.html"),
    "utf8",
  ),
  css: fs.readFileSync(
    path.resolve(__dirname, "../../../components/launch/launch-screen.css"),
    "utf8",
  ),
  logo: fs.readFileSync(
    path.resolve(__dirname, "../../../public/brand/Rift-Symbol-Black.svg"),
    "utf8",
  ),
}).replace(/<script>[\s\S]*?<\/script>/, "");
let browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});

async function openPage(viewport = { width: 1100, height: 720 }) {
  const page = await browser.newPage({ viewport });
  await page.setContent(html);
  return page;
}

async function background(page) {
  return page
    .locator(".rift-launch")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
}

test("launch stays OLED black regardless of system or app theme", async () => {
  const page = await openPage();
  try {
    await page.emulateMedia({ colorScheme: "light" });
    assert.equal(await background(page), "rgb(0, 0, 0)");
    await page.emulateMedia({ colorScheme: "dark" });
    assert.equal(await background(page), "rgb(0, 0, 0)");
    await page.evaluate(() => {
      document.documentElement.className = "light";
    });
    assert.equal(await background(page), "rgb(0, 0, 0)");
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => {
      document.documentElement.className = "dark";
    });
    assert.equal(await background(page), "rgb(0, 0, 0)");
  } finally {
    await page.close();
  }
});

test("small-window errors remain scrollable with the retry control reachable by keyboard", async () => {
  const page = await openPage({ width: 320, height: 320 });
  try {
    await page.evaluate(() => {
      document.querySelector(".rift-launch").dataset.state = "error";
      document.querySelector("#status-text").textContent =
        "Unable to open RIFT";
      Object.assign(document.querySelector("#error-message"), {
        hidden: false,
        textContent:
          "Couldn’t reach RIFT. Check your connection and try again.",
      });
      document.querySelector("#retry-btn").hidden = false;
    });
    const button = page.getByRole("button", { name: "Try again" });
    await button.focus();
    await button.scrollIntoViewIfNeeded();
    const state = await page.evaluate(() => {
      const root = document.querySelector(".rift-launch");
      const button = document.querySelector("#retry-btn");
      return {
        overflow: root.scrollWidth > root.clientWidth,
        bottom: button.getBoundingClientRect().bottom,
        focused: document.activeElement === button,
        dragHeight: document
          .querySelector(".rift-launch__drag")
          .getBoundingClientRect().height,
      };
    });
    assert.equal(state.overflow, false);
    assert.ok(state.bottom <= 320);
    assert.equal(state.focused, true);
    assert.equal(state.dragHeight, 48);
  } finally {
    await page.close();
  }
});

test("reduced motion leaves status readable without a spinning indicator", async () => {
  const page = await openPage();
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator(".rift-launch__signal i")
        .evaluate((element) => getComputedStyle(element).animationName),
      "none",
    );
    assert.equal(await page.getByRole("status").innerText(), "Opening RIFT");
  } finally {
    await page.close();
  }
});
