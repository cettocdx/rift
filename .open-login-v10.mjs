import { chromium } from "playwright";

/**
 * Open the v10 recording profile so the operator can sign in — then close
 * CLEANLY the moment sign-in is detected, so Chromium flushes the session
 * cookie to disk. (An earlier version was killed mid-wait, which skipped the
 * flush and left the profile signed out.)
 *
 * Interactive login only; the recorder (.record-hack-4k.mjs) does the filming
 * afterwards, headless, at full 3840x2160.
 */

const BASE = process.env.RIFT_BASE ?? "https://riftsys.app";
const PROFILE =
  "/private/tmp/claude-501/-Users-cetto-Developer/693ef69c-36b9-41a6-ba1f-6ae90c92bd57/scratchpad/rift-film/v11/pw-profile";

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1440, height: 900 },
  colorScheme: "light",
});

await context.addInitScript(() => {
  try { localStorage.setItem("theme", "light"); } catch {}
});

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(`${BASE}/hack`, { waitUntil: "domcontentloaded", timeout: 120_000 });

console.log("");
console.log("  ┌────────────────────────────────────────────────────────┐");
console.log("  │  Açılan pencerede RIFT hesabınıza giriş yapın.        │");
console.log("  │  Giriş başarılı olunca pencere kendiliğinden          │");
console.log("  │  ~10 sn içinde kapanır ve oturum kaydedilir.          │");
console.log("  └────────────────────────────────────────────────────────┘");
console.log("");

const DEADLINE = Date.now() + 5 * 60_000;
let ok = false;
while (Date.now() < DEADLINE) {
  await page.waitForTimeout(3000);
  const url = page.url();
  const composer = await page.locator("textarea").count().catch(() => 0);
  // Signed in = we are no longer on the login page and the app composer exists.
  if (!/\/login/.test(url) && composer > 0) {
    ok = true;
    console.log("  ✓ giriş algılandı — oturum yerleşiyor…");
    break;
  }
}

if (ok) {
  // Make sure /hack itself is loaded and its cookies are written, then let
  // Chromium settle before a clean close flushes everything to disk.
  await page.goto(`${BASE}/hack`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(6000);
  await context.close(); // clean close = cookie flush
  console.log("  ✓ oturum kaydedildi. Artık kaydı başlatabilirim.");
} else {
  console.log("  ! giriş algılanmadı (5 dk doldu). Tekrar deneyin.");
  await context.close();
}
