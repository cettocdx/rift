import { RiftBrandLockup } from "@/components/icons/rift-brand-lockup";
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The share card.
 *
 * What shipped before was `/icon-512x512.png` — the app icon, square. Every
 * time the URL was posted in Slack, X or LinkedIn it rendered as a small tile
 * with no words on it, which wastes the one impression a share buys. This is
 * the 1200x630 that every one of those surfaces actually crops for.
 *
 * Rendered from code rather than exported from a design tool: the wordmark and
 * the sentence are the ones the page uses, so the card cannot fall out of date
 * with the product it is advertising.
 */

export const alt =
  "RIFT — the workstation your agents run on. Plan, write, execute and verify inside a real sandbox.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  // A static instance, not the variable original. Satori reads neither woff2
  // nor a variable TTF — handed SpaceGrotesk-wght.ttf it dies with
  // "Cannot read properties of undefined (reading '256')", which is the shape
  // of a font table it cannot parse. SpaceGrotesk-500.ttf is that same file
  // instanced at weight 500 with fontTools, checked in beside it.
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
        // The page's own warm near-black, not a generic #000.
        backgroundColor: "#0A0908",
        padding: "72px 80px",
        fontFamily: "Display",
      }}
    >
      <div style={{ display: "flex", color: "#ffffff" }}>
        <RiftBrandLockup markSize={52} />
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          color: "#F4F1EC",
          fontSize: 62,
          lineHeight: 1.15,
          letterSpacing: -1.4,
          maxWidth: 900,
        }}
      >
        The workstation your agents run on.
      </div>

      <div
        style={{
          display: "flex",
          color: "#9A938A",
          fontSize: 26,
          letterSpacing: -0.2,
          maxWidth: 860,
        }}
      >
        Plan, write, execute and verify inside a real sandbox — with a terminal,
        a filesystem and the frontier models already wired in.
      </div>
    </div>,
    {
      ...size,
      fonts: [{ name: "Display", data: display, style: "normal", weight: 500 }],
    },
  );
}
