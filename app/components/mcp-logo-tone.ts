/**
 * Which provider marks are too dark to sit on a dark surface.
 *
 * Most brand logos in `public/plugin-logos` are coloured or light and read fine
 * straight on the app's own surface — which is what we want, because a plate
 * behind every logo turns a list into a column of bright holes punched through
 * a black page.
 *
 * A minority are near-monochrome dark marks that would simply disappear there.
 * This list was measured rather than guessed: every file was rasterised at 40px
 * and the mean luminance of its opaque pixels recorded. Anything under 70 (on
 * 0–255) is listed here and gets a light plate — the threshold sits there
 * because marks in the 45–70 band still lose their shape against black.
 *
 * Inverting them instead was rejected — it works for a black wordmark but
 * destroys anything with hue, so a single rule could not cover both.
 *
 * Re-measure when logos are added; a missing entry shows up as an invisible
 * logo, not as a crash.
 */
export const DARK_PROVIDER_LOGOS: ReadonlySet<string> = new Set([
  "amplitude",
  "circleci",
  "datadog",
  "mysql",
  "sentry",
  "square",
  "tavily",
  "weaviate",
  "wordpress",
  "youtube",
  "auth0",
  "bigcommerce",
  "brex",
  "cal-com",
  "elevenlabs",
  "fly-io",
  "framer",
  "front",
  "github",
  "intercom",
  "linear",
  "mailchimp",
  "medium",
  "okta",
  "openai",
  "pinecone",
  "pipedrive",
  "planetscale",
  "railway",
  "render",
  "replicate",
  "replicate-flux",
  "squarespace",
  "vercel",
  "x-twitter",
  "zendesk",
]);

/** True when this logo needs a light plate to stay visible on a dark surface. */
export function logoNeedsPlate(logoPath: string): boolean {
  const file = logoPath.split("/").pop() ?? "";
  return DARK_PROVIDER_LOGOS.has(file.replace(/\.svg$/i, ""));
}
