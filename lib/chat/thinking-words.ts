/**
 * Whimsical gerunds for the live activity row.
 *
 * These are a fallback, never a replacement: when the stream tells us what the
 * agent is actually doing ("Mapping the existing navigation") that specific
 * title always wins. A word from this list fills the moments before any such
 * signal exists, where the honest alternative is a flat "Working…".
 *
 * Chosen to sound like a workshop rather than a server: making, thinking and
 * digging verbs, nothing that implies progress the run has not made.
 */
export const THINKING_WORDS: readonly string[] = [
  "Assembling",
  "Brewing",
  "Calibrating",
  "Channelling",
  "Composing",
  "Concocting",
  "Conjuring",
  "Contemplating",
  "Crafting",
  "Deliberating",
  "Distilling",
  "Divining",
  "Drafting",
  "Engineering",
  "Excavating",
  "Fabricating",
  "Fathoming",
  "Finessing",
  "Forging",
  "Formulating",
  "Galvanising",
  "Gathering",
  "Hatching",
  "Honing",
  "Ideating",
  "Improvising",
  "Incubating",
  "Inferring",
  "Kindling",
  "Machinating",
  "Marshalling",
  "Mulling",
  "Musing",
  "Navigating",
  "Noodling",
  "Orchestrating",
  "Percolating",
  "Pondering",
  "Prospecting",
  "Puzzling",
  "Reckoning",
  "Ruminating",
  "Scheming",
  "Sculpting",
  "Simmering",
  "Sketching",
  "Smelting",
  "Spelunking",
  "Stitching",
  "Surveying",
  "Synthesising",
  "Tinkering",
  "Unravelling",
  "Weaving",
  "Whirring",
  "Wrangling",
];

/**
 * Pick a word deterministically from `seed`.
 *
 * Deterministic on purpose: the row re-renders on every stream delta, and a
 * random pick would reshuffle the word several times a second. One run keeps
 * one word.
 */
export function pickThinkingWord(seed: number | string): string {
  const text = String(seed);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return THINKING_WORDS[Math.abs(hash) % THINKING_WORDS.length];
}
