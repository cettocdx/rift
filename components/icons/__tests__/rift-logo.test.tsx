import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { RiftLogo } from "../rift-logo";
import { RiftPixelMark } from "../rift-pixel-mark";
import { RiftBrandLockup } from "../rift-brand-lockup";
import { RiftWordmark } from "../rift-wordmark";
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
const source = (name: string) => readFileSync(join(process.cwd(), name));
const pixels = (svg: Buffer | string, width = 496, height = 496) =>
  sharp(
    Buffer.from(
      svg
        .toString()
        .replace(/<svg\b[^>]*>/, (root) =>
          root
            .replace(/width="[^"]*"/, `width="${width}"`)
            .replace(/height="[^"]*"/, `height="${height}"`),
        ),
    ),
  )
    .resize(width, height)
    .ensureAlpha()
    .raw()
    .toBuffer();

describe("Package 11 brand geometry", () => {
  it("renders the approved symbol and compatibility alias without added effects", () => {
    const { rerender } = render(
      <RiftLogo size={48} glow className="brand-mark" />,
    );
    let logo = screen.getByRole("img", { name: "RIFT" });
    expect(logo).toHaveAttribute("width", "48");
    expect(logo).toHaveAttribute("viewBox", "0 0 124 124");
    expect(logo).toHaveAttribute("fill", "currentColor");
    expect(logo).toHaveClass("brand-mark");
    expect(logo.style.filter).toBe("");
    expect(logo.querySelectorAll("path")).toHaveLength(2);
    expect(logo.querySelector("path[transform]")).toHaveAttribute(
      "transform",
      "rotate(180 50 50)",
    );
    rerender(<RiftPixelMark size={19} />);
    logo = screen.getByRole("img", { name: "RIFT" });
    expect(logo).toHaveAttribute("width", "19");
  });

  it.each([
    ["symbol", <RiftLogo key="symbol" />, "Rift-Symbol-Black.svg", 496, 496],
    [
      "wordmark",
      <RiftWordmark key="wordmark" />,
      "Rift-Wordmark-Black.svg",
      574,
      304,
    ],
    [
      "horizontal",
      <RiftBrandLockup key="horizontal" />,
      "Rift-Horizontal-Black.svg",
      856,
      304,
    ],
  ] as const)(
    "matches the supplied %s raster exactly, including all transforms",
    async (_name, component, file, width, height) => {
      const actual = await pixels(
        renderToStaticMarkup(component),
        width,
        height,
      );
      const expected = await pixels(
        source("public/brand/" + file),
        width,
        height,
      );
      expect(actual.equals(expected)).toBe(true);
    },
  );

  it("keeps aliases on the supplied artwork and adaptive browser colors", async () => {
    const expected = await pixels(source("public/brand/Rift-Symbol-Black.svg"));
    expect(
      (await pixels(source("public/rift-icon.svg"))).equals(expected),
    ).toBe(true);
    expect(
      (await pixels(source("public/rift-icon-mono.svg"))).equals(expected),
    ).toBe(true);
    expect(source("public/rift-icon.svg").toString()).toContain(
      "prefers-color-scheme:dark",
    );
    expect(
      source("public/rift-wordmark.svg").equals(
        source("public/brand/Rift-Wordmark-Black.svg"),
      ),
    ).toBe(true);
    expect(
      source("public/rift-wordmark-light.svg").equals(
        source("public/brand/Rift-Wordmark-White.svg"),
      ),
    ).toBe(true);
    expect(
      source("app/icon.png").equals(source("public/icon-512x512.png")),
    ).toBe(true);
    expect(
      source("src-tauri/icons/icon.png").equals(
        source("packages/desktop/src-tauri/icons/icon.png"),
      ),
    ).toBe(true);
    expect(
      source("packages/desktop/src-tauri/icons/RIFT.svg").equals(
        source("public/brand/Rift-AppIcon-Light.svg"),
      ),
    ).toBe(true);
  });
});
