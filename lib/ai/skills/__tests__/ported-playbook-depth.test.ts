import { SKILL_CATALOG } from "../catalog";
import { MANDATORY_BUILD_SKILLS } from "../mandatory-build-skills";

const pack = (id: string) => {
  const entry = SKILL_CATALOG.find((skill) => skill.id === id);
  if (!entry) throw new Error(`missing catalog pack: ${id}`);
  return entry.instructions;
};

const profile = (id: string) => {
  const entry = MANDATORY_BUILD_SKILLS.find((skill) => skill.id === id);
  if (!entry) throw new Error(`missing profile: ${id}`);
  return entry.instructions.join("\n");
};

/**
 * Fifth pass over Grok's printed skill files
 * (docs/product-transformation/grok-skills-dump-2026-08-17.md): the concrete
 * details their packs carry that earlier passes summarised away. Each one is
 * here because it names a specific failure a model reaches for from memory.
 */
describe("depth ported from Grok's own skill files", () => {
  it("kills the CDN-era three.js pattern by name", () => {
    // Their threejs pack exists precisely so the agent stops "inventing
    // outdated CDN/r128 APIs". A model asked for three.js will otherwise
    // produce an importmap and a pinned r128 build from memory — code that
    // looks right, and that the production build has no three at all for.
    const three = pack("threejs-scene");
    expect(three).toContain("npm install three");
    expect(three).toMatch(/r128/);
    expect(three).toMatch(/importmap/);
    expect(three).toMatch(/@react-three\/fiber/);
    expect(three).toMatch(/dpr=\{\[1, 2\]\}/);
  });

  it("names the libraries instead of saying 'a real one'", () => {
    // "Use a real icon set" is advice; "lucide-react" is a decision.
    const design = profile("design-taste-frontend");
    expect(design).toMatch(/lucide-react/);
    expect(design).toMatch(/recharts/);
    expect(design).toMatch(/shadcn\/ui/);
    expect(design).toMatch(/crossOrigin="anonymous"/);
  });

  it("splits the game canvas from the DOM layered over it", () => {
    // Grok's design-ui owns the overlay and hands the canvas to
    // building-games; the seam matters because an overlay that eats a
    // pointer-lock click breaks the game without looking broken.
    expect(profile("design-taste-frontend")).toMatch(
      /overlay.*game canvas|game canvas.*overlay/is,
    );
    expect(profile("design-taste-frontend")).toMatch(/pointer-lock/i);
  });

  it("treats an installable app's icons as part of the brand pass", () => {
    const og = pack("og-share-card");
    expect(og).toMatch(/manifest/i);
    expect(og).toMatch(/maskable/i);
    expect(og).toMatch(/SVG favicon/i);
  });

  it("does not carry Grok's private X card contract", () => {
    // `og:type = x:game` is a product contract between Grok and X's card
    // pipeline for *.grok.me links. Whether it behaves the same for an app
    // published elsewhere is unverified, so it is deliberately not ported.
    const everything = [
      ...SKILL_CATALOG.map((skill) => skill.instructions),
      ...MANDATORY_BUILD_SKILLS.map((skill) => skill.instructions.join("\n")),
    ].join("\n");
    expect(everything).not.toMatch(/x:game/);
  });
});
