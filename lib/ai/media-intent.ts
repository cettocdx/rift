import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  resolveMediaModel,
  type ChatPurpose,
  type MediaModelKind,
  type SelectedModel,
} from "@/types/chat";

export type MediaIntentConfidence = "explicit" | "strong" | "fallback";

export interface ResolvedMediaIntent {
  kind: MediaModelKind;
  confidence: MediaIntentConfidence;
  signals: readonly string[];
}

export interface ResolvedMediaRequest extends ResolvedMediaIntent {
  selectedModel: SelectedModel;
  selectionChanged: boolean;
}

const normalize = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ıİ]/g, "i")
    .replace(/[’']/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

const VIDEO_TRANSFORM_PATTERNS = [
  /\b(?:image|photo|picture|still|frame|resim|fotograf|gorsel|kare)(?:i|u)?\s+(?:to|into|as|bir)?\s*(?:video|clip|animation|animasyon|videoya)\b(?!\s+(?:thumbnail|cover|poster|kapak|afis))/,
  /\b(?:animate|animate this|bring to life|canlandir|hareketlendir)\b/,
  /\b(?:turn|convert|transform)\b.{0,36}\b(?:to|into|as)\b.{0,32}\b(?:video|clip|animation)\b(?!\s+(?:thumbnail|cover|poster))/,
  /\b(?:videoya|animasyona)\b.{0,16}\b(?:donustur|cevir)\b/,
  /\b(?:video|clip|animation|animasyon)\b.{0,36}\b(?:from|using|based on|ile)\b.{0,24}\b(?:image|photo|picture|resim|fotograf|gorsel)\b/,
] as const;

const IMAGE_DELIVERABLE_PATTERNS = [
  /\b(?:video|youtube|reel|film|clip)\s+(?:thumbnail|cover|poster|kapak|afis)\b/,
  /\b(?:thumbnail|cover|poster|kapak|afis)\b.{0,28}\b(?:for|icin)\s+(?:(?:a|the|this)\s+)?(?:video|youtube|reel|film|clip)\b/,
  /\b(?:turn|convert|transform|donustur|cevir)\b.{0,48}\b(?:video|videoyu|clip|film|footage)\b.{0,48}\b(?:image|photo|picture|still|frame|resim|resme|fotograf|gorsel|kare)\b/,
  /\b(?:extract|capture|grab|export|cikar|al)\b.{0,40}\b(?:frame|still|image|photo|picture|kare|resim|fotograf|gorsel)\b/,
  /\b(?:video|videodan|videoyu|clip|film|footage)\b.{0,40}\b(?:frame|still|image|photo|picture|kare|resim|resme|fotograf|gorsel)\b.{0,24}\b(?:extract|capture|grab|export|cikar|al|uret|yap)\b/,
] as const;

const VIDEO_TERMS = [
  "video",
  "videoya",
  "clip",
  "klip",
  "film",
  "footage",
  "animation",
  "animasyon",
  "motion",
  "hareketli",
  "reel",
  "trailer",
  "cinematic sequence",
  "product film",
  "social video",
] as const;

const IMAGE_TERMS = [
  "image",
  "photo",
  "photograph",
  "picture",
  "still image",
  "resim",
  "fotograf",
  "gorsel",
  "poster",
  "afis",
  "thumbnail",
  "kapak",
  "illustration",
  "illustasyon",
  "wallpaper",
  "logo",
] as const;

const NEGATION =
  /(?:\b(?:not|no|without|dont|do not)\b(?:\s+\p{L}+){0,5}\s*)$/u;
const TRAILING_NEGATION = /^\s*\b(?:not|degil|istemiyorum|olmasin|olmasın)\b/;

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstNonNegatedPattern(
  text: string,
  patterns: readonly RegExp[],
): RegExp | null {
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g")
      ? pattern.flags
      : `${pattern.flags}g`;
    const expression = new RegExp(pattern.source, flags);
    let match: RegExpExecArray | null;
    while ((match = expression.exec(text))) {
      const prefix = text.slice(Math.max(0, match.index - 48), match.index);
      if (!NEGATION.test(prefix)) return pattern;
      if (match[0].length === 0) expression.lastIndex += 1;
    }
  }
  return null;
}

function termScore(
  text: string,
  terms: readonly string[],
): {
  score: number;
  signals: string[];
  negatedSignals: string[];
} {
  let score = 0;
  const signals: string[] = [];
  const negatedSignals: string[] = [];
  for (const term of terms) {
    const expression = new RegExp(`\\b${escaped(term)}\\b`, "g");
    for (const match of text.matchAll(expression)) {
      const index = match.index ?? 0;
      const prefix = text.slice(Math.max(0, index - 28), index);
      const suffix = text.slice(index + term.length, index + term.length + 20);
      if (NEGATION.test(prefix) || TRAILING_NEGATION.test(suffix)) {
        negatedSignals.push(term);
        continue;
      }
      score += term.includes(" ") ? 3 : 2;
      signals.push(term);
    }
  }
  return { score, signals, negatedSignals };
}

/** Resolve explicit media language without depending on the selected picker. */
export function resolveMediaIntent(
  prompt: string,
  fallbackKind: MediaModelKind = "image",
): ResolvedMediaIntent {
  const text = normalize(prompt);
  if (!text) return { kind: fallbackKind, confidence: "fallback", signals: [] };

  const videoTransform = firstNonNegatedPattern(text, VIDEO_TRANSFORM_PATTERNS);
  if (videoTransform) {
    return {
      kind: "video",
      confidence: "explicit",
      signals: [videoTransform.source],
    };
  }

  const imageDeliverable = firstNonNegatedPattern(
    text,
    IMAGE_DELIVERABLE_PATTERNS,
  );
  if (imageDeliverable) {
    return {
      kind: "image",
      confidence: "explicit",
      signals: [imageDeliverable.source],
    };
  }

  const video = termScore(text, VIDEO_TERMS);
  const image = termScore(text, IMAGE_TERMS);
  if (video.score === image.score || Math.max(video.score, image.score) < 2) {
    if (video.negatedSignals.length > 0 && image.negatedSignals.length === 0) {
      return {
        kind: "image",
        confidence: "strong",
        signals: video.negatedSignals.map((signal) => `not:${signal}`),
      };
    }
    if (image.negatedSignals.length > 0 && video.negatedSignals.length === 0) {
      return {
        kind: "video",
        confidence: "strong",
        signals: image.negatedSignals.map((signal) => `not:${signal}`),
      };
    }
    return { kind: fallbackKind, confidence: "fallback", signals: [] };
  }
  return video.score > image.score
    ? { kind: "video", confidence: "strong", signals: video.signals }
    : { kind: "image", confidence: "strong", signals: image.signals };
}

/**
 * Reconcile prompt intent with the product allowlist. An explicit mismatch
 * moves to the default model of the requested modality; arbitrary raw model
 * ids never pass through this function.
 */
export function resolveMediaRequest({
  purpose,
  prompt,
  selectedModel,
}: {
  purpose: ChatPurpose;
  prompt: string;
  selectedModel?: SelectedModel | null;
}): ResolvedMediaRequest {
  const selected = resolveMediaModel(selectedModel);
  const fallbackKind = selected?.kind ?? "image";
  if (purpose !== "image") {
    return {
      kind: fallbackKind,
      confidence: "fallback",
      signals: [],
      selectedModel: selectedModel ?? "auto",
      selectionChanged: false,
    };
  }

  const intent = resolveMediaIntent(prompt, fallbackKind);
  const validSelection = selected ? selectedModel : null;
  const nextSelection =
    intent.kind === fallbackKind && validSelection
      ? validSelection
      : intent.kind === "video"
        ? DEFAULT_VIDEO_MODEL
        : DEFAULT_IMAGE_MODEL;
  return {
    ...intent,
    selectedModel: nextSelection,
    selectionChanged: nextSelection !== selectedModel,
  };
}
