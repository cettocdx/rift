import {
  STUDIO_PATTERNS,
  STUDIO_PATTERN_CATEGORIES,
  studioPatternsByCategory,
} from "../studio-patterns";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/types/chat";

const MODEL_IDS = new Set([
  ...IMAGE_MODELS.map((model) => model.id),
  ...VIDEO_MODELS.map((model) => model.id),
]);

describe("studio patterns", () => {
  it("keeps ids unique and every pattern in a real category", () => {
    const ids = STUDIO_PATTERNS.map((pattern) => pattern.id);
    expect(new Set(ids).size).toBe(ids.length);
    const categories = new Set(
      STUDIO_PATTERN_CATEGORIES.map((category) => category.id),
    );
    STUDIO_PATTERNS.forEach((pattern) => {
      expect(categories.has(pattern.category)).toBe(true);
    });
  });

  it("points every pattern at a model Studio can actually select", () => {
    // A pattern that names a model the picker does not offer is a button that
    // silently does the wrong thing.
    STUDIO_PATTERNS.forEach((pattern) => {
      expect(MODEL_IDS.has(pattern.model)).toBe(true);
      expect(pattern.model.startsWith(`${pattern.kind}-`)).toBe(true);
    });
  });

  it("gives every category at least one pattern", () => {
    // An empty tab is the same defect the settings dialog shipped: a category
    // that exists in the nav and nowhere else.
    STUDIO_PATTERN_CATEGORIES.forEach((category) => {
      expect(studioPatternsByCategory(category.id).length).toBeGreaterThan(0);
    });
  });

  it("writes prompts with slots to fill rather than finished copy", () => {
    // The scaffold lands in the composer for the operator to complete. A
    // generated ad for an unnamed product is a demo, not work.
    STUDIO_PATTERNS.forEach((pattern) => {
      expect(pattern.prompt).toMatch(/\[[^\]]+\]/);
      expect(pattern.prompt.length).toBeGreaterThan(120);
      expect(pattern.summary.length).toBeGreaterThan(0);
    });
  });
});
