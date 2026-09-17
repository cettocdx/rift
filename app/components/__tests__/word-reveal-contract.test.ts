import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const markdown = read("app/components/MemoizedMarkdown.tsx");
const partHandler = read("app/components/MessagePartHandler.tsx");
const globals = read("app/globals.css");

/** Claude-style reading flow: stream text immediately without decorative delay. */
describe("Incremental message text", () => {
  it("preserves active-stream parsing without a word-animation plugin", () => {
    expect(markdown).toContain("isAnimating={revealWords}");
    expect(markdown).toContain("animated={false}");
    expect(markdown).not.toContain('animation: "gaussian"');
    expect(markdown).not.toContain("stagger:");
  });

  it("keeps replayed history distinct from newly streamed text", () => {
    expect(markdown).toContain("revealWords = false");
    expect(partHandler).toContain(
      "const revealWords = isStreaming && !isReplaying;",
    );
    expect(partHandler).toContain("revealWords={revealWords}");
    expect(partHandler).not.toContain("revealWords={isStreaming}");
  });

  it("defines the gaussian curve the word spans reference", () => {
    // Streamdown's plugin emits [data-sd-animate] spans with
    // --sd-animation: sd-<name>; the keyframes behind that name are ours.
    expect(globals).toContain("@keyframes sd-gaussian");
    expect(globals).toContain("[data-sd-animate]");
    expect(globals).toContain(
      "animation-name: var(--sd-animation, sd-gaussian)",
    );
    expect(globals).toContain("animation-duration: var(--sd-duration, 100ms)");
    expect(globals).toContain(
      "animation-timing-function: var(--sd-easing, ease-in-out)",
    );
    expect(globals).toContain("animation-iteration-count: 1");
  });

  it("drops the motion, not the text, under prefers-reduced-motion", () => {
    const reduced = globals.slice(globals.indexOf("@keyframes sd-gaussian"));
    const guard = reduced.slice(
      reduced.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(guard).toContain("[data-sd-animate]");
    expect(guard.slice(0, 400)).toContain("animation: none");
    expect(guard.slice(0, 400)).toContain("opacity: 1");
  });
});
