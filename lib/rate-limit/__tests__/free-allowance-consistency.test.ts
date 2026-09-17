import fs from "node:fs";
import path from "node:path";
import { getFreeRequestLimit } from "../free-config";

// C2. The free daily Ask allowance was stated three times: enforced in
// free-config (3), advertised in plans.ts, and hardcoded as "10" on two
// marketing surfaces. A user was promised more than they got. Every surface
// must read the enforced number, never restate it.
describe("the free Ask allowance is quoted from one source", () => {
  const read = (rel: string) =>
    fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  const surfaces = [
    "lib/pricing/plans.ts",
    "app/components/ExtraUsageSection.tsx",
    "app/components/landing/LandingPage.tsx",
  ];

  it("no surface hardcodes a questions-per-day count", () => {
    for (const rel of surfaces) {
      const source = read(rel);
      expect(source).toMatch(/getFreeRequestLimit\(\)/);
      // The specific stale literal, and any bare "<n> questions" count.
      expect(source).not.toMatch(/"\d+ questions/);
      expect(source).not.toMatch(/`\d+ questions/);
    }
  });

  it("still resolves to a positive enforced default", () => {
    expect(getFreeRequestLimit()).toBeGreaterThan(0);
  });
});
