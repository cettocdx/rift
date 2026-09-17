import { RiftBrandLockup } from "@/components/icons/rift-brand-lockup";
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The /landing/x share card.
 *
 * The metadata used to point at /landing-x/hall-1600.webp — a file that was
 * deleted with the server-hall section, so every share of this URL rendered a
 * grey rectangle, on a page that is `robots: index=false` and therefore
 * reachable ONLY by being shared. This is a real 1200x630, rendered from code
 * in the page's own palette so it cannot fall out of date with the page.
 *
 * It is drawn, not photographed, for the same reason the scale band is: the
 * page's argument is that its claims are checkable, so its share image asserts
 * nothing it does not own. A limb of light on the brand's near-black, and the
 * headline the page actually carries.
 */

export const alt =
  "RIFT — give it the work, get it shipped. A frontier agent on a real machine.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function XOpengraphImage() {
  const display = await readFile(
    join(process.cwd(), "public/brand/fonts/SpaceGrotesk-500.ttf"),
  );

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        // /landing/x's own ground, not the warmer landing-v2 black.
        backgroundColor: "#0a0a0a",
        padding: "72px 80px",
        fontFamily: "Display",
        position: "relative",
      }}
    >
      {/* The limb: a soft blue arc rising from the bottom edge, the same
            image the hero and the scale band carry, built here as a radial so
            satori can draw it without a canvas. */}
      <div
        style={{
          position: "absolute",
          left: "-20%",
          right: "-20%",
          bottom: "-78%",
          height: "150%",
          borderRadius: "50%",
          background:
            "radial-gradient(closest-side, rgba(90,140,230,0.55), rgba(40,70,150,0.18) 62%, rgba(10,10,10,0) 78%)",
        }}
      />

      <div style={{ display: "flex", color: "#ffffff" }}>
        <RiftBrandLockup markSize={52} />
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          color: "#ffffff",
          fontSize: 68,
          lineHeight: 1.1,
          letterSpacing: -1.6,
          maxWidth: 940,
        }}
      >
        Give it the work. Get it shipped.
      </div>

      <div
        style={{
          display: "flex",
          color: "rgba(255,255,255,0.55)",
          fontSize: 26,
          letterSpacing: -0.2,
          maxWidth: 900,
        }}
      >
        A frontier agent on a real machine — filesystem, package manager,
        terminal. It builds and runs the work before it says it is done.
      </div>
    </div>,
    {
      ...size,
      fonts: [{ name: "Display", data: display, style: "normal", weight: 500 }],
    },
  );
}
