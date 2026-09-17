import { slugifySubdomain } from "../subdomain";
import { sha1Hex, vercelProjectName, preferredUrl } from "../vercel";

describe("naming a published app", () => {
  it("slugs a product name, including Turkish letters", () => {
    expect(slugifySubdomain("KOR — Gece Çizgisi")).toBe("kor-gece-cizgisi");
    // Turkish letters do not decompose under NFKD, so without an explicit map
    // "Dönen Küre" would come out as "dnen-kre" — a name nobody would type.
    expect(slugifySubdomain("Dönen Küre")).toBe("donen-kure");
    expect(slugifySubdomain("Işık Şehri")).toBe("isik-sehri");
    expect(slugifySubdomain("  Apsis!!  ")).toBe("apsis");
  });

  it("never produces a label that starts or ends with a hyphen", () => {
    expect(slugifySubdomain("!!! hey !!!")).toBe("hey");
    expect(slugifySubdomain("a".repeat(45) + " tail")).not.toMatch(/-$/);
  });

  it("scopes the project name to its owner", () => {
    // One RIFT team holds every published project. Without the owner suffix,
    // two users who both call their app "kor" would collide and the second
    // publish would deploy over the first user's live site.
    const mine = vercelProjectName("kor", "user_aaa");
    const theirs = vercelProjectName("kor", "user_bbb");
    expect(mine).not.toBe(theirs);
    expect(mine).toMatch(/^kor-[0-9a-f]{6}$/);
    // Stable across publishes, or republishing would orphan the old project.
    expect(vercelProjectName("kor", "user_aaa")).toBe(mine);
  });

  it("keeps the project name inside Vercel's length limit", () => {
    const name = vercelProjectName(slugifySubdomain("x".repeat(200)), "u");
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });

  it("hashes file bytes with SHA1, which is what Vercel verifies", () => {
    // Vercel's upload endpoint checks x-vercel-digest as SHA1; sending a
    // SHA-256 would be rejected as an invalid digest.
    expect(sha1Hex(new TextEncoder().encode("abc"))).toBe(
      "a9993e364706816aba3e25717850c26c9cd0d89d",
    );
  });

  it("hands the user the stable alias, not the per-deployment hostname", () => {
    // Every publish mints a new deployment hostname; only the project alias
    // survives, so a link shared today still works after the next publish.
    expect(
      preferredUrl({
        id: "dpl_1",
        url: "kor-abc123-team.vercel.app",
        aliases: ["kor-9f2a1c.vercel.app"],
        readyState: "READY",
      }),
    ).toBe("https://kor-9f2a1c.vercel.app");
    // With no alias yet, the deployment hostname is better than nothing.
    expect(
      preferredUrl({
        id: "dpl_1",
        url: "kor-abc123-team.vercel.app",
        aliases: [],
        readyState: "READY",
      }),
    ).toBe("https://kor-abc123-team.vercel.app");
  });
});
