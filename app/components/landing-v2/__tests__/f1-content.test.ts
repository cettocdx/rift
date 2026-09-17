import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  BUILD_STEPS,
  CONTINUITY_STEPS,
  ENTERPRISE_CONTROLS,
  PRODUCT_SURFACES,
  STUDIO_OUTPUTS,
} from "../f1-content";
import {
  F1_CONTAINER_CLASS,
  F1_DISPLAY_CLASS,
  F1_PALETTE,
  F1_SECTION_CLASS,
} from "../f1-design";

describe("F1 landing contracts", () => {
  it("pins the approved palette and layout", () => {
    expect(F1_PALETTE).toMatchObject({
      "--background": "#080808",
      "--foreground": "#F3F3EF",
      "--surface": "#101010",
      "--border": "#282828",
      "--muted-foreground": "#A9A9A2",
      "--primary": "#FF756A",
    });
    expect(F1_CONTAINER_CLASS).toContain("max-w-[1240px]");
    expect(F1_DISPLAY_CLASS).toContain("xl:text-[88px]");
    expect(F1_SECTION_CLASS).toContain("lg:py-24");
  });

  it("defines three product states and one three-step Build story", () => {
    expect(PRODUCT_SURFACES.map(({ id }) => id)).toEqual([
      "build",
      "studio",
      "hack",
    ]);
    expect(BUILD_STEPS.map(({ label }) => label)).toEqual([
      "Plan",
      "Execute",
      "Verify",
    ]);
    expect(CONTINUITY_STEPS).toHaveLength(3);
  });

  it("keeps Build execution copy valid for cloud and explicit local mode", () => {
    const executeStep = BUILD_STEPS.find(({ label }) => label === "Execute");

    expect(executeStep?.body).toBe(
      "Files, packages and terminal commands stay attached to the environment the agent is using.",
    );
    expect(JSON.stringify(BUILD_STEPS)).not.toMatch(/inside the same sandbox/i);
  });

  it("uses only local, existing public assets", () => {
    for (const item of [...PRODUCT_SURFACES, ...STUDIO_OUTPUTS]) {
      expect(item.imageSrc).toMatch(/^\//);
      expect(existsSync(join(process.cwd(), "public", item.imageSrc))).toBe(
        true,
      );

      if ("videoSrc" in item && item.videoSrc) {
        expect(item.videoSrc).toMatch(/^\//);
        expect(existsSync(join(process.cwd(), "public", item.videoSrc))).toBe(
          true,
        );
      }
    }
  });

  it("avoids unverified model attribution in Studio metadata", () => {
    expect(STUDIO_OUTPUTS.map(({ model }) => model)).toEqual([
      "Image model",
      "Image model",
      "Image model",
      "Video model",
    ]);
  });

  it("describes Studio assets as reference media without unsupported output claims", () => {
    expect(STUDIO_OUTPUTS.map(({ label }) => label)).toEqual([
      "Industrial object",
      "Desert architecture",
      "Color study",
      "Character continuity",
    ]);

    for (const item of STUDIO_OUTPUTS) {
      expect(item.imageAlt).toMatch(/^Reference media showing/);
    }

    expect(JSON.stringify(STUDIO_OUTPUTS)).not.toMatch(
      /generated|product film|volcanic|ribbon under/i,
    );
  });

  it("ships narrowly grounded enterprise controls without social proof theatre", () => {
    expect(ENTERPRISE_CONTROLS).toEqual([
      {
        title: "Controlled execution",
        body: "Cloud runs can use isolated sandboxes, while local mode stays explicit to the selected workspace.",
      },
      {
        title: "Authorized operation launcher",
        body: "Guided Hack operations collect the target, scope and authorization before launch.",
      },
      {
        title: "Credential boundaries",
        body: "Connected MCP OAuth credentials are stored and retrieved outside prompt copy.",
      },
    ]);
    const serialized = JSON.stringify(ENTERPRISE_CONTROLS);
    expect(serialized).not.toMatch(/testimonial|trusted by|customers/i);
  });
});
