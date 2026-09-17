import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every viewport observer on this page must name the scroll container.
 *
 * This is the bug that has cost the landing page twice, and both times it
 * looked like something else. The page scrolls inside its own element rather
 * than the document (see LandingShell), so an `IntersectionObserver` left on
 * the default root — or a Motion `viewport` with no `root` — watches a
 * scroller that never moves. Paired with fire-once semantics, the miss is
 * permanent: the element sits below the fold in its initial state forever.
 *
 * The first time, seven elements were measured stranded at opacity 0 and it
 * read as a rendering fault. The second time, the Studio and Workbench frames
 * never started their runs and it read as a broken demo. Neither symptom
 * points anywhere near the cause, which is exactly why it needs a test rather
 * than a comment.
 *
 * This reads source rather than rendering, deliberately. jsdom has no layout,
 * so an IntersectionObserver test would assert against a stub and pass whether
 * or not the root was ever passed — it would test the mock. What actually
 * needs guarding is that nobody adds the eighth observer without the root, and
 * that is a property of the text.
 */

const DIR = join(process.cwd(), "app/components/landing-v2");
const PI_DIR = join(process.cwd(), "app/components/landing-pi");

/** Files the merged landing actually renders. Dead files are not a contract. */
const LIVE = [
  "BuildModels.tsx",
  "HackWorkbenchSection.tsx",
  "IntegrationStrip.tsx",
  "LandingComparison.tsx",
  "LandingFooter.tsx",
  "LandingGrid.tsx",
  "LandingNav.tsx",
  "LandingSections.tsx",
  "MergedHero.tsx",
  "MergedLanding.tsx",
  "ModelFlow.tsx",
  "PluginWall.tsx",
  "PricingAndDownload.tsx",
  "ProductFrame.tsx",
  "Reveal.tsx",
  "RiftMiniApp.tsx",
  "RunScrubber.tsx",
  "StudioShowcase.tsx",
  "StudioVendors.tsx",
  "SubagentRoster.tsx",
  "use-in-view.ts",
];

/**
 * The parallel landing is built from its own components and scrolls in the
 * same container, so it inherits the same trap. It is covered here rather than
 * in a second test file because the contract is one contract — a reader who
 * finds this file should see every page it protects.
 *
 * Listed by directory read rather than by hand: a new file added to
 * app/components/landing-pi is live the moment it is imported, and a
 * hand-kept list is exactly the thing that would not have caught it.
 */
const PI_FILES = readdirSync(PI_DIR).filter((file) => /\.tsx?$/.test(file));

const read = (file: string) => readFileSync(join(DIR, file), "utf8");
const readPi = (file: string) => readFileSync(join(PI_DIR, file), "utf8");

describe("landing scroll-root contract", () => {
  it("passes a root to every IntersectionObserver it constructs", () => {
    const offenders: string[] = [];
    const sources: [string, string][] = [
      ...LIVE.map((file): [string, string] => [file, read(file)]),
      ...PI_FILES.map((file): [string, string] => [
        `landing-pi/${file}`,
        readPi(file),
      ]),
    ];

    for (const [file, source] of sources) {
      let index = source.indexOf("new IntersectionObserver");
      while (index !== -1) {
        // The options object is the second argument; look at the construction
        // and the ~600 characters after it, which comfortably covers a
        // multi-line callback plus the options literal.
        const window = source.slice(index, index + 900);
        if (!window.includes("root:")) offenders.push(file);
        index = source.indexOf("new IntersectionObserver", index + 1);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("passes a root to every Motion viewport it declares", () => {
    const offenders: string[] = [];
    const sources: [string, string][] = [
      ...LIVE.map((file): [string, string] => [file, read(file)]),
      ...PI_FILES.map((file): [string, string] => [
        `landing-pi/${file}`,
        readPi(file),
      ]),
    ];

    for (const [file, source] of sources) {
      let index = source.indexOf("viewport={{");
      while (index !== -1) {
        const window = source.slice(index, index + 400);
        if (!window.includes("root:")) offenders.push(`${file} @${index}`);
        index = source.indexOf("viewport={{", index + 1);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the shared hook as the one place the root is resolved", () => {
    // Not a style preference. Three components had grown three copies of this
    // observer and two of them had the bug; a single implementation is what
    // stops the fourth copy from reintroducing it.
    const hook = read("use-in-view.ts");
    expect(hook).toContain("useLandingScrollContainer");
    expect(hook).toContain("root:");
  });
});
