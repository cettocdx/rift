import { chromium } from "playwright";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * Record the real product building something, at true 4K, for the landing hero.
 *
 * Playwright's own `recordVideo` re-encodes at the CSS viewport size, so it can
 * never be sharper than 1280-wide no matter the device scale factor. This uses
 * the CDP screencast instead: Chromium hands over the composited frames at the
 * real device resolution (1920 x 1080 at DSF 2 = 3840 x 2160), and ffmpeg
 * assembles them with their own timestamps, so nothing is interpolated or
 * stretched.
 *
 * The screencast is change-driven — frames arrive only when pixels move — which
 * is why the concat list carries per-frame durations rather than a fixed rate.
 *
 * This costs one real agent run. Identity is scrubbed before the first frame is
 * captured and re-scrubbed on a timer, because the sidebar re-renders during a
 * run and would otherwise put the operator's name and chat history on a public
 * page.
 */

const BASE = "http://localhost:3060";
const ROOT =
  "/private/tmp/claude-501/-Users-cetto-Developer/088c0a83-d8f4-4106-8e50-78188779a1df/scratchpad";
const FRAMES = `${ROOT}/hero-frames`;
const OUT = `${ROOT}/hero-4k`;
const PROFILE = `${ROOT}/pw-profile`;
const TASK =
  "build a gravity simulation: bouncing balls with collisions, in one HTML file";
const RECORD_MS = 180_000;

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync(OUT, { recursive: true });

const APPEARANCE = {
  version: 1,
  light: { preset: "cursor", accent: "#303030", background: "#ffffff", foreground: "#171717", sidebar: "#f7f7f7", surface: "#eeeeef", border: "#e1e1e3" },
  dark: { preset: "oled", accent: "#8ab4ff", background: "#000000", foreground: "#f5f5f5", sidebar: "#0a0a0a", surface: "#101010", border: "#242424" },
  uiFont: "system", codeFont: "sf-mono", uiFontSize: 13, codeFontSize: 14,
  contrast: "standard", translucentSidebar: true, pointerCursors: true,
};

const PRIVATE = /merhaba|kllk|react dark|unrecognized|say hello|explain react|uygulama|ahmetcet/i;

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  // No --password-store/--use-mock-keychain here: Chromium encrypts this
  // profile's cookies with a key held in the macOS Keychain, so a mock keychain
  // silently fails to decrypt them and the profile comes up signed out.
  args: ["--hide-scrollbars", "--force-device-scale-factor=2"],
});

await context.addInitScript(
  ([config]) => {
    try {
      localStorage.setItem("rift:appearance:v1", JSON.stringify(config));
      localStorage.setItem("theme", "dark");
    } catch {}
  },
  [APPEARANCE],
);

const page = context.pages()[0] ?? (await context.newPage());
page.on("requestfailed", (req) => {
  if (/agent-long|trigger\.dev/.test(req.url())) {
    console.log("[reqfailed]", req.url().slice(0, 80), req.failure()?.errorText);
  }
});

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(3500);

if (!(await page.locator("textarea").count())) {
  console.log("GIRIS YOK — once .open-login.mjs calistirin");
  await context.close();
  process.exit(1);
}

/** Keep the operator out of the frame for every captured pixel. */
const scrub = async () => {
  await page.evaluate((source) => {
    const isPrivate = new RegExp(source, "i");
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = (node.nodeValue || "").trim();
      if (!text) continue;
      if (/ahmetcet/i.test(text)) node.nodeValue = "Account";
      if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) node.nodeValue = "account@rift.app";
    }
    const sidebar = document.querySelector('[data-slot="sidebar"]');
    if (!sidebar) return;
    for (const el of sidebar.querySelectorAll("li,a,button,div,span")) {
      const text = (el.innerText || "").trim();
      if (text && text.length <= 80 && isPrivate.test(text)) {
        el.style.display = "none";
      }
    }
    // Rehearsals left the same task in Recent five times over. Keeping one is
    // honest — the list is real — while a column of identical rows would read
    // as a bug in the product rather than as evidence of testing.
    const seen = new Set();
    for (const link of sidebar.querySelectorAll("a")) {
      const label = (link.innerText || "").trim().toLowerCase();
      if (!label || label.length > 80) continue;
      if (seen.has(label)) {
        const row = link.closest("li") ?? link;
        row.style.display = "none";
        continue;
      }
      seen.add(label);
    }
  }, PRIVATE.source);
};

await scrub();
await page.waitForTimeout(600);

const client = await context.newCDPSession(page);
const frames = [];
let index = 0;

client.on("Page.screencastFrame", (frame) => {
  const name = `f${String(index++).padStart(6, "0")}.jpg`;
  writeFileSync(`${FRAMES}/${name}`, Buffer.from(frame.data, "base64"));
  frames.push({ name, ts: frame.metadata.timestamp });
  client
    .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
    .catch(() => undefined);
});

await client.send("Page.startScreencast", {
  format: "jpeg",
  quality: 92,
  maxWidth: 3840,
  maxHeight: 2160,
  everyNthFrame: 1,
});
console.log("screencast basladi — 3840x2160");

const composer = page.locator("textarea").first();
await composer.click();
await composer.fill("");
await page.waitForTimeout(700);
// Typed rather than pasted so the take shows the task being written.
await composer.type(TASK, { delay: 38 });
await page.waitForTimeout(900);

console.log("gonderiliyor — gercek bir kosu basliyor");
const send = page
  .locator('form button[type="submit"], button[aria-label*="end" i]')
  .last();
if (await send.count()) {
  await send.click({ force: true }).catch(() => undefined);
} else {
  await composer.press("Enter");
}

const began = Date.now();
while (Date.now() - began < RECORD_MS) {
  await page.waitForTimeout(3000);
  await scrub().catch(() => undefined);
}

await client.send("Page.stopScreencast").catch(() => undefined);
await page.waitForTimeout(400);
await context.close();

console.log(`yakalanan kare: ${frames.length}`);
if (frames.length < 30) {
  console.log("YETERSIZ KARE — kayit basarisiz");
  process.exit(1);
}

// Real per-frame durations: the screencast only emits on change, so a fixed
// rate would speed up quiet stretches and stall busy ones.
const lines = [];
for (let i = 0; i < frames.length; i++) {
  const next = frames[i + 1];
  const duration = next
    ? Math.min(Math.max(next.ts - frames[i].ts, 0.016), 1.5)
    : 0.4;
  lines.push(`file '${FRAMES}/${frames[i].name}'`);
  lines.push(`duration ${duration.toFixed(4)}`);
}
lines.push(`file '${FRAMES}/${frames[frames.length - 1].name}'`);
const listPath = `${ROOT}/hero-frames.txt`;
writeFileSync(listPath, lines.join("\n"));

const span = frames[frames.length - 1].ts - frames[0].ts;
console.log(`sure: ${span.toFixed(1)}s`);

const ff = (args) => execFileSync("ffmpeg", args, { stdio: "inherit" });

// Master: real time, full resolution, for archive and for re-cutting later.
// -fps_mode cfr with -r: ffmpeg 8 rejects -r alongside a non-CFR mode, and a
// constant rate is what a hero <video> wants anyway.
ff([
  "-y", "-f", "concat", "-safe", "0", "-i", listPath,
  "-fps_mode", "cfr", "-r", "30",
  "-c:v", "libx264", "-preset", "slow", "-crf", "18",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart",
  `${OUT}/hero-master-4k.mp4`,
]);

// Hero cut: a hero loop cannot be three minutes long, so the same footage is
// condensed. Nothing is faked — it is the same run, played faster.
const speed = Math.max(1, span / 22);
ff([
  "-y", "-i", `${OUT}/hero-master-4k.mp4`,
  "-filter:v", `setpts=PTS/${speed.toFixed(3)}`,
  "-an", "-r", "30",
  "-c:v", "libx264", "-preset", "slow", "-crf", "20",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart",
  `${OUT}/hero-run-4k.mp4`,
]);

ff([
  "-y", "-i", `${OUT}/hero-run-4k.mp4`,
  "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0", "-row-mt", "1",
  "-an", `${OUT}/hero-run-4k.webm`,
]);

// Poster for the video element: first meaningful frame, not a black one.
ff([
  "-y", "-i", `${OUT}/hero-run-4k.mp4`, "-vf", "select=eq(n\\,8)",
  "-frames:v", "1", `${OUT}/hero-run-poster.webp`,
]);

console.log(`hizlandirma: ${speed.toFixed(2)}x`);
console.log("DONE:", OUT);
