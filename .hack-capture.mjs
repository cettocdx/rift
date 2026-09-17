import { chromium } from "playwright";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * ONE command: sign in, then film the real /hack running a real assessment, in
 * the same live context (no cookie-to-disk handoff — that kept failing).
 *
 * Headed on purpose: the live site blocks headless/automated browsers, but a
 * headed window loads normally and lets the operator sign in. The screencast
 * captures at the device resolution (~3024 wide on this display; upscaled to 4K
 * in post). Timestamp-accurate assembly like the hero recorder.
 *
 * The /hack composer is an <input>, NOT a <textarea> — the earlier version
 * waited for a textarea that never appears, so it never noticed the sign-in.
 */

const BASE = process.env.RIFT_BASE ?? "https://riftsys.app";
const ROOT =
  "/private/tmp/claude-501/-Users-cetto-Developer/693ef69c-36b9-41a6-ba1f-6ae90c92bd57/scratchpad/rift-film/v11";
const FRAMES = `${ROOT}/hack-frames`;
const OUT = `${ROOT}/capture`;
const PROFILE = `${ROOT}/pw-profile`;
const RECORD_MS = Number(process.env.FILMCAP_MS ?? 140_000);
const TASK =
  process.env.FILMCAP_TASK ??
  "Assess the authorized scope: discover the services, read their banners, review the transport headers, and verify every finding before you report it.";

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync(OUT, { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1512, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "light",
  args: ["--hide-scrollbars", "--force-device-scale-factor=2", "--window-size=1512,950", "--window-position=0,0"],
});

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(`${BASE}/hack`, { waitUntil: "domcontentloaded", timeout: 120_000 });

console.log("\n  ┌───────────────────────────────────────────────┐");
console.log("  │  Pencerede RIFT'e giriş yapın.                │");
console.log("  │  Giriş görülünce kayıt OTOMATİK başlar.       │");
console.log("  │  Sonra pencereye dokunmayın (~2.5 dk).        │");
console.log("  └───────────────────────────────────────────────┘\n");

const composerSel = 'input[placeholder*="assess the authorized scope" i]';
const signedIn = async () => {
  if (/\/login/.test(page.url())) return false;
  const wb = await page.getByText("Hack Workbench").count().catch(() => 0);
  const inp = await page.locator(composerSel).count().catch(() => 0);
  return wb > 0 || inp > 0;
};

const DEADLINE = Date.now() + 6 * 60_000;
let ok = false;
while (Date.now() < DEADLINE) {
  await page.waitForTimeout(2500);
  if (await signedIn()) { ok = true; break; }
}
if (!ok) { console.log("giriş algılanmadı (6 dk)"); await context.close(); process.exit(1); }
console.log("✓ giriş algılandı — /hack açılıyor, kayıt başlıyor");

if (!/\/hack/.test(page.url())) {
  await page.goto(`${BASE}/hack`, { waitUntil: "domcontentloaded" }).catch(() => {});
}
await page.waitForTimeout(3500);

const client = await context.newCDPSession(page);
const frames = [];
let index = 0;
client.on("Page.screencastFrame", (frame) => {
  writeFileSync(`${FRAMES}/f${String(index++).padStart(6, "0")}.jpg`, Buffer.from(frame.data, "base64"));
  frames.push({ ts: frame.metadata.timestamp });
  client.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
});
await client.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 3840, maxHeight: 2160, everyNthFrame: 1 });
console.log("screencast basladi");

const composer = page.locator(composerSel).first();
await composer.click().catch(() => {});
await composer.fill("").catch(() => {});
await page.waitForTimeout(600);
await composer.type(TASK, { delay: 22 }).catch(async () => { await composer.fill(TASK); });
await page.waitForTimeout(800);
await composer.press("Enter").catch(() => {});
console.log("gercek kosu basladi — kaydediliyor");

const began = Date.now();
let last = 0;
while (Date.now() - began < RECORD_MS) {
  await page.waitForTimeout(5000);
  if (frames.length - last > 0) { console.log(`  kare: ${frames.length}`); last = frames.length; }
}

await client.send("Page.stopScreencast").catch(() => undefined);
await page.waitForTimeout(400);
await context.close();

console.log(`yakalanan kare: ${frames.length}`);
if (frames.length < 150) { console.log("YETERSIZ KARE"); process.exit(1); }
const names = Array.from({length: index}, (_,i)=>`f${String(i).padStart(6,"0")}.jpg`);
const lines = [];
for (let i = 0; i < frames.length; i++) {
  const next = frames[i + 1];
  const dur = next ? Math.min(Math.max(next.ts - frames[i].ts, 0.016), 1.5) : 0.4;
  lines.push(`file '${FRAMES}/${names[i]}'`); lines.push(`duration ${dur.toFixed(4)}`);
}
lines.push(`file '${FRAMES}/${names[frames.length-1]}'`);
writeFileSync(`${ROOT}/hack-frames.txt`, lines.join("\n"));
console.log(`sure: ${(frames[frames.length-1].ts - frames[0].ts).toFixed(1)}s`);
execFileSync("ffmpeg", ["-y","-f","concat","-safe","0","-i",`${ROOT}/hack-frames.txt`,"-fps_mode","cfr","-r","30","-c:v","libx264","-preset","slow","-crf","16","-pix_fmt","yuv420p","-movflags","+faststart",`${OUT}/hack-master.mp4`], { stdio: "inherit" });
rmSync(FRAMES, { recursive: true, force: true });
console.log("DONE:", `${OUT}/hack-master.mp4`);
