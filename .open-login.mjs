import { chromium } from "playwright";

/**
 * Open the recording profile so the operator can sign in.
 *
 * Kept separate from the recorder on purpose: signing in is theirs to do, and
 * bundling it with a take means every re-auth costs a real agent run. This
 * spends nothing — it opens the app, waits, and reports what the composer is
 * set to once the session is back, so the next take starts from a known state.
 */

const BASE = "http://localhost:3060";
const PROFILE =
  "/private/tmp/claude-501/-Users-cetto-Developer/088c0a83-d8f4-4106-8e50-78188779a1df/scratchpad/pw-profile";

const APPEARANCE = {
  version: 1,
  light: { preset: "cursor", accent: "#303030", background: "#ffffff", foreground: "#171717", sidebar: "#f7f7f7", surface: "#eeeeef", border: "#e1e1e3" },
  dark: { preset: "oled", accent: "#8ab4ff", background: "#000000", foreground: "#f5f5f5", sidebar: "#0a0a0a", surface: "#101010", border: "#242424" },
  uiFont: "system", codeFont: "sf-mono", uiFontSize: 13, codeFontSize: 14,
  contrast: "standard", translucentSidebar: true, pointerCursors: true,
};

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  // Deliberately no keychain overrides: this profile's cookies are encrypted
  // with a macOS Keychain key, and a mock keychain makes the session unreadable.
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
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });

console.log("TARAYICI ACIK — giris yapin. 10 dakika bekliyorum…");

/** Signed in means the composer exists; the sign-in card has no textarea. */
const deadline = Date.now() + 600_000;
let signedIn = false;
while (Date.now() < deadline) {
  await page.waitForTimeout(3000);
  signedIn = await page
    .evaluate(() => {
      const text = document.body.innerText || "";
      if (/Sign in to open|Go to sign in/i.test(text)) return false;
      return Boolean(document.querySelector("textarea"));
    })
    .catch(() => false);
  if (signedIn) break;
}

if (!signedIn) {
  console.log("GIRIS YAPILMADI — sure doldu");
  await context.close();
  process.exit(1);
}

// Report the picker state rather than changing it: the last take ran on an
// image model, which is why a coding task produced nothing recognisable.
await page.waitForTimeout(2500);
const state = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll("button")];
  const pick = (re) =>
    buttons.map((b) => (b.innerText || "").trim()).find((t) => t && re.test(t)) ?? null;
  return {
    url: location.pathname,
    model: pick(/gpt|claude|gemini|opus|sonnet|grok|kimi|glm|qwen|image/i),
    mode: pick(/^(Agent|Plan)$/),
  };
});

console.log("GIRIS TAMAM");
console.log("model:", state.model);
console.log("mod:", state.mode);
await context.close();
console.log("OTURUM KAYDEDILDI");
