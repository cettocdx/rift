import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

/*
 * The guard is easy to add and easy to forget, and forgetting it is invisible
 * until someone with `reduce` set opens the app. These assertions make the
 * omission fail here instead.
 */
describe("reduced-motion contract", () => {
  it.each([
    ["components/ui/dialog.tsx", 2],
    ["components/ui/sheet.tsx", 2],
    ["components/ui/dropdown-menu.tsx", 2],
    ["components/ui/popover.tsx", 1],
    ["components/ui/select.tsx", 1],
    ["components/ui/tooltip.tsx", 1],
  ])("guards every animated surface in %s", (path, expected) => {
    const component = source(path);
    const entrances = component.split("animate-in").length - 1;
    const guards = component.split("motion-reduce:animate-none").length - 1;

    expect(entrances).toBe(expected);
    expect(guards).toBeGreaterThanOrEqual(expected);
  });

  it("bakes the guard into Skeleton so callers cannot forget it", () => {
    expect(source("components/ui/skeleton.tsx")).toContain(
      "motion-reduce:animate-none",
    );
  });

  it("slows the indeterminate indicators instead of freezing them", () => {
    const css = source("app/globals.css");
    const block = css.slice(
      css.indexOf("/* Progress indicators under reduced motion."),
    );
    const rule = block.slice(0, block.indexOf("\n}\n") + 3);

    expect(rule).toContain("@media (prefers-reduced-motion: reduce)");
    expect(rule).toContain("animation-duration: 2s");
    expect(rule).toContain("animation-duration: 3.6s");
    // The shorthand would stop the spinner dead, which reads as a hung app.
    expect(rule).not.toMatch(/animation:\s*none/);
  });
})
