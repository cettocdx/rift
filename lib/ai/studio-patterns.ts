import type { MediaModelKind } from "@/types/chat";

/**
 * Studio's production patterns.
 *
 * The gallery below them answers "which model is this?". This answers the
 * question people actually arrive with — "I need an unboxing ad" — and that is
 * the difference between a model picker and a studio. The reference tools in
 * this category (Higgsfield's Marketing Studio, its UGC and DTC preset packs)
 * lead with the deliverable and choose the model for you; the model is an
 * implementation detail of the thing you asked for.
 *
 * A pattern is not a prompt template with the nouns swapped. Each one carries
 * the shot discipline that makes its format work — the beats a UGC review needs
 * to read as a real person, the cut rhythm a TV spot needs to survive at six
 * seconds — because that craft is what the person picking it does not have.
 *
 * `prompt` is a scaffold, deliberately written with bracketed slots. It lands
 * in the composer for the operator to fill, rather than being sent blind: a
 * generated ad for an unnamed product is a demo, not work.
 */

export type StudioPatternCategory =
  | "ugc"
  | "ads"
  | "film"
  | "product"
  | "motion";

export interface StudioPattern {
  id: string;
  category: StudioPatternCategory;
  name: string;
  /** What it produces, in the operator's words. */
  summary: string;
  kind: MediaModelKind;
  /** The model this format is actually good on. */
  model: string;
  /** Shot discipline plus the slots to fill. */
  prompt: string;
}

export const STUDIO_PATTERN_CATEGORIES: readonly {
  id: StudioPatternCategory;
  label: string;
  description: string;
}[] = [
  { id: "ugc", label: "UGC", description: "Creator-shot, handheld, unscripted" },
  { id: "ads", label: "Ads", description: "Paid social and broadcast spots" },
  { id: "film", label: "Film", description: "Narrative and short-form cinema" },
  { id: "product", label: "Product", description: "Studio and in-situ stills" },
  { id: "motion", label: "Motion", description: "Type, logo and transitions" },
] as const;

export const STUDIO_PATTERNS: readonly StudioPattern[] = [
  {
    id: "ugc-unboxing",
    category: "ugc",
    name: "Unboxing",
    summary: "A first-open reaction, shot on a phone",
    kind: "video",
    model: "video-veo-fast",
    prompt:
      "Vertical 9:16 UGC unboxing of [product]. One continuous handheld take, phone held at chest height, natural window light, a real room with lived-in clutter behind. Beat 1: hands enter frame with the sealed box. Beat 2: the seal breaks, the camera dips to follow. Beat 3: the product comes out and is turned once, slowly, toward the lens. No music bed, no captions burned in, no studio sweep — room tone and the sound of the packaging only. Imperfect framing is correct; recentre once mid-take as a real person would.",
  },
  {
    id: "ugc-review",
    category: "ugc",
    name: "Product review",
    summary: "A creator talking to camera about one specific thing",
    kind: "video",
    model: "video-veo",
    prompt:
      "Vertical 9:16 talking-head review of [product] by [creator description]. Front camera, arm's length, eye-line slightly above the lens. They open on the single most specific claim — not 'it's great', but one concrete thing it did — then hold the product up beside their face to show it. Natural speech with a false start and a self-correction. Ambient room sound. No jump cuts, no B-roll, no on-screen text.",
  },
  {
    id: "ugc-tryon",
    category: "ugc",
    name: "Try-on",
    summary: "Wear it, move in it, show the fit",
    kind: "video",
    model: "video-kling",
    prompt:
      "Vertical 9:16 try-on of [garment] on [subject]. Mirror-held phone. Three beats: a still front view, a turn to show the drape at the back, then movement — walking two steps toward the mirror so the fabric behaves. Even indoor light. Show the fit honestly, including where it pulls.",
  },
  {
    id: "ugc-tutorial",
    category: "ugc",
    name: "Tutorial",
    summary: "Hands doing the thing, over the shoulder",
    kind: "video",
    model: "video-veo-fast",
    prompt:
      "Vertical 9:16 overhead tutorial: [task] using [product]. Camera locked above a work surface, hands entering from the bottom of frame. Each step is one unbroken action — no cut inside a step. Real materials, real mess. Practical sound of the task itself.",
  },
  {
    id: "ad-tv-spot",
    category: "ads",
    name: "TV spot",
    summary: "Six seconds that survive being skipped",
    kind: "video",
    model: "video-sora",
    prompt:
      "6-second 16:9 broadcast spot for [brand]. Three cuts, no more. Frame 1 lands the product in the first 400ms — the viewer has already decided by second two. Frame 2 shows it doing the one thing it is for. Frame 3 is the brand mark on a held, clean plate. Cinema lighting, shallow depth, a single colour that carries the brand. Sound design over music.",
  },
  {
    id: "ad-hyper-motion",
    category: "ads",
    name: "Hyper motion",
    summary: "Impossible camera moves around a product",
    kind: "video",
    model: "video-kling",
    prompt:
      "16:9 hyper-motion product film of [product]. One continuous impossible move: the camera travels through, around and inside the product without a cut, speed ramping at the two points where geometry is most interesting. Seamless loop — the last frame must match the first. Hard specular light on a dark ground, motion blur consistent with the ramp.",
  },
  {
    id: "ad-asmr",
    category: "ads",
    name: "ASMR spot",
    summary: "Texture and sound doing the selling",
    kind: "video",
    model: "video-seedance",
    prompt:
      "Vertical 9:16 ASMR commercial for [product]. Macro lens, extremely shallow focus, slow. The only events are tactile: a fingertip across the surface, a lid releasing, a liquid meeting a wall. Sound is the subject — no voice, no music. Even soft light, no hard speculars.",
  },
  {
    id: "film-short",
    category: "film",
    name: "Short film beat",
    summary: "One scene with a turn in it",
    kind: "video",
    model: "video-sora",
    prompt:
      "16:9 cinematic scene: [situation]. One location, two characters, a single turn in the middle where what one of them wants changes. Anamorphic, practical sources motivated in frame, natural falloff. The camera moves once and only when the turn happens. Performance over spectacle; hold the frame after the line lands.",
  },
  {
    id: "film-establishing",
    category: "film",
    name: "Establishing shot",
    summary: "Somewhere, at a specific hour",
    kind: "video",
    model: "video-veo",
    prompt:
      "16:9 establishing shot of [place] at [time of day]. Slow push or a locked frame — pick one and commit. Atmosphere carried by air, not by filters: haze, weather, distance. Scale is read from something human in the frame. No score.",
  },
  {
    id: "product-studio",
    category: "product",
    name: "Studio still",
    summary: "Catalogue-clean, on seamless",
    kind: "image",
    model: "image-flux",
    prompt:
      "Studio product photograph of [product] on seamless [colour]. Three-quarter hero angle, key light at 45° with a large soft source, one negative fill to keep the shadow side reading, a rim to separate it from the ground. Accurate materials — the reflections have to describe the surface. No props, no composite, no lens flare.",
  },
  {
    id: "product-in-situ",
    category: "product",
    name: "In situ",
    summary: "The product where it is actually used",
    kind: "image",
    model: "image-gemini-pro",
    prompt:
      "Editorial photograph of [product] in [real setting], used rather than displayed. Available light at [time of day]. The product is not centred and not the largest thing in frame; it is where a person left it. Believable depth of field for the focal length. Nothing styled to perfection.",
  },
  {
    id: "product-poster",
    category: "product",
    name: "Poster",
    summary: "One image that survives being small",
    kind: "image",
    model: "image-gemini",
    prompt:
      "Poster composition for [subject]. One idea, one focal point, and enough negative space that it still reads as a thumbnail. Strong figure-ground separation. Type-safe area left clear at [top/bottom]. Colour limited to three values.",
  },
  {
    id: "motion-logo",
    category: "motion",
    name: "Logo resolve",
    summary: "A mark arriving, not spinning",
    kind: "video",
    model: "video-veo-fast",
    prompt:
      "16:9 logo resolve for [brand]. The mark arrives through one physical behaviour — settling, assembling, being revealed by light — over 1.5 seconds, then holds still for one full second. No rotation, no bevel, no lens flare. Ends on a clean plate that a caption can sit on.",
  },
  {
    id: "motion-loop",
    category: "motion",
    name: "Seamless loop",
    summary: "A background that never announces the cut",
    kind: "video",
    model: "video-wan",
    prompt:
      "Seamless looping 16:9 abstract motion for [mood]. The last frame must be identical to the first. Continuous, unhurried movement with no event in it — nothing that draws the eye to a moment. Muted palette so type can sit on top.",
  },
] as const;

export function studioPatternsByCategory(
  category: StudioPatternCategory,
): readonly StudioPattern[] {
  return STUDIO_PATTERNS.filter((pattern) => pattern.category === category);
}
