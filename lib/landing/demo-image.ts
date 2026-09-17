import { openrouterAttributionHeaders } from "@/lib/ai/openrouter-attribution";
import { isMediaPromptHardBlocked } from "@/lib/ai/media-moderation";

/**
 * One real image, for the landing page's Studio frame.
 *
 * Everything else on that frame is the product's own chrome driving prepared
 * output. This is the one thing a reader is actually judging — whether the
 * thing that made those stills works — and it is the only surface on this page
 * that costs real money per call, so the boundaries are the design:
 *
 *   model     the cheapest on the roster, $0.04 a render
 *   size      1K, the only resolution the lite model offers
 *   prompt    240 characters, moderated before it is sent
 *   per user  one a day, enforced by the same limiter as the probe
 *   overall   a hard global ceiling per UTC day, below
 *
 * The global cap is the part that matters. A per-visitor limit keyed on a
 * forgeable header is a speed bump, not a budget — someone spraying addresses
 * would walk straight through it. DAILY_CAP is the actual ceiling on what this
 * page can spend, and it is enforced through the shared counter in
 * demo-budget.ts rather than a variable in this module: on Vercel a
 * module-scope counter is per-instance, which is not a budget at all.
 */

/** Cheapest image model on the roster. $0.04 per render. */
const MODEL = "google/gemini-3.1-flash-lite-image";

/**
 * What ran, for the panel to display. Exported so the label beside the render
 * cannot drift from the model that produced it — a hardcoded "Gemini 3.1 Flash
 * Lite" string in RiftMiniApp did exactly that. This is a lightweight model we
 * pay for, deliberately not one of the paid roster's twelve; the chips are the
 * roster, this is the free preview.
 */
export const DEMO_IMAGE_MODEL_LABEL = "Gemini 3.1 Flash Lite";

/** Per-render cost, for the spend log. */
export const IMAGE_COST_USD = 0.04;

/**
 * Renders allowed across all visitors per UTC day.
 *
 * 40 x $0.04 = $1.60 a day, $48 a month at the absolute worst. Raise it with
 * RIFT_LANDING_IMAGE_DAILY_CAP once the page earns it; set it to 0 to turn
 * real rendering off entirely and keep the prepared stills.
 */
export const DAILY_CAP = (() => {
  const raw = process.env.RIFT_LANDING_IMAGE_DAILY_CAP;
  if (raw === undefined) return 40;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 40;
})();

export const MAX_IMAGE_PROMPT_CHARS = 240;

const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";
const REQUEST_TIMEOUT_MS = 45_000;
/** A 1K render is well under this; anything larger is a transport fault. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/* ── The render ─────────────────────────────────────────────────────── */

export type DemoImage = {
  /** A `data:` URL. Nothing is persisted — this is a demo, not a library. */
  dataUrl: string;
  model: string;
  /** Milliseconds the provider took. */
  elapsed: number;
};

export class ImagePromptRejected extends Error {}

type OpenRouterImageResponse = {
  data?: Array<{ b64_json?: string; media_type?: string }>;
  error?: { message?: string };
};

export async function generateDemoImage(prompt: string): Promise<DemoImage> {
  const trimmed = prompt.trim().slice(0, MAX_IMAGE_PROMPT_CHARS);
  if (trimmed.length < 3) throw new ImagePromptRejected("too short");

  // The same moderation the product applies to its own media prompts. An open
  // image generator on an unauthenticated page is a standing invitation, and
  // this is the one check that must not be skipped for a demo.
  if (await isMediaPromptHardBlocked(trimmed)) {
    throw new ImagePromptRejected("blocked");
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(OPENROUTER_IMAGES_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...openrouterAttributionHeaders,
      },
      body: JSON.stringify({
        model: MODEL,
        prompt: trimmed,
        n: 1,
        size: "1K",
      }),
    });

    if (!response.ok) {
      throw new Error(`provider ${response.status}`);
    }

    const body = (await response.json()) as OpenRouterImageResponse;
    const first = body.data?.[0];
    const base64 = first?.b64_json;
    if (!base64) throw new Error(body.error?.message ?? "no image returned");
    if (base64.length * 0.75 > MAX_IMAGE_BYTES) {
      throw new Error("image too large");
    }

    const mediaType = first?.media_type ?? "image/png";
    return {
      dataUrl: `data:${mediaType};base64,${base64}`,
      model: MODEL,
      elapsed: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}
