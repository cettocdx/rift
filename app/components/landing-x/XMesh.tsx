"use client";

import { useEffect, useRef } from "react";

/**
 * The fluid mesh gradient — the vivid card art on the reference's news row and
 * bento tiles.
 *
 * The rest of this page has no accent colour at all, which is deliberate and
 * copied from the reference. The reference gets away with it because colour is
 * not absent from the page, it is *quarantined*: every saturated thing on x.ai
 * lives inside a card, and the page around those cards is pure near-black. So
 * the colour reads as artwork rather than as branding, and one card can be
 * orange and the next violet without the site looking like it has six brands.
 *
 * How the look is actually made — and it is not a CSS gradient:
 *
 *   1. Four or five big radial blobs of *saturated* colour are laid over a
 *      dark base at a deliberately tiny resolution (see `LOD`, ~40px wide).
 *   2. That grid is drawn up to full size through the browser's bilinear
 *      filter. The interpolation between such coarse samples is what produces
 *      the organic, liquid boundaries; drawing the same blobs at full size
 *      gives you four hard circles and looks like a lava lamp.
 *   3. Grain over the top, which does double duty as it does in XAtmosphere:
 *      it dithers away the banding an 8-bit gradient would otherwise show, and
 *      it stops the surface looking like vector art.
 *
 * Every value is a pure function of `seed`, so a tile renders identically on
 * every load and on the server-rendered markup it hydrates into — no
 * Math.random, no mismatch, no reshuffle when React re-renders the row.
 */

/**
 * The blob field's resolution. This is the single most important number in the
 * file: at 40 the boundaries are liquid, at 120 they are recognisably circles,
 * and at 12 the whole tile is mush.
 */
const LOD = 40;
const NOISE = 96;

/** A blob: position, radius and which palette stop it carries. */
type Blob = { x: number; y: number; r: number; stop: number };

export type MeshPalette = {
  /** The ground the blobs sit on. Dark, and usually a deep tint of the hue. */
  base: string;
  /** Two to four stops, lightest last — the last one becomes the hot core. */
  stops: string[];
};

/**
 * Sampled from the reference's own cards rather than invented, because the
 * thing that makes them read as expensive is the *value* structure: a very
 * dark ground, one mid hue doing most of the area, and a small very light hot
 * spot. Pick three arbitrary mid-tones instead and it looks like a stock
 * gradient generator.
 */
export const MESH_PALETTES: Record<string, MeshPalette> = {
  ember: {
    base: "#1a0a02",
    stops: ["#7a2a05", "#e2650f", "#ffb765", "#fbe6cb"],
  },
  violet: {
    base: "#150a2b",
    stops: ["#3d1b70", "#8a35c9", "#c862e0", "#f0b8ee"],
  },
  amber: {
    base: "#0b0603",
    stops: ["#4a1d05", "#94430a", "#e07b1e", "#ffd79a"],
  },
  forest: {
    base: "#04120a",
    stops: ["#0d3a1c", "#2b7d3a", "#63b552", "#c6e9a8"],
  },
  ice: { base: "#040a16", stops: ["#0d2a52", "#2166ab", "#4fa3e0", "#c2e6ff"] },
  /**
   * The hue-free one, added for /landing/x — whose ink is pure black and which
   * wants no blue anywhere. `ice` is left exactly as it is because
   * /landing/h's product row still uses it, and editing a shared palette to
   * settle one page's argument restyles the other silently.
   *
   * The value structure is the same as every entry above and that is the part
   * that matters: a very dark ground, one mid doing most of the area, and a
   * small very light hot spot. Take the hue out and keep those three and it
   * still reads as a lit surface rather than as a grey gradient.
   */
  graphite: {
    base: "#080808",
    stops: ["#1f1f1f", "#4a4a4a", "#828282", "#c8c8c8"],
  },
  rose: {
    base: "#1a0614",
    stops: ["#5c0f38", "#a81f6e", "#e04d9e", "#ffc2e6"],
  },
};

/** Deterministic and cheap. Any stable hash would do; this one is well-mixed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hex(c: string): [number, number, number] {
  const v = parseInt(c.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function buildBlobs(seed: number, count: number): Blob[] {
  const rand = rng(seed);
  const blobs: Blob[] = [];
  for (let i = 0; i < count; i += 1) {
    blobs.push({
      // Blobs are allowed well outside the tile. A composition whose sources
      // all sit inside the frame reads as a pattern; the reference's cards are
      // always a crop of something larger.
      x: -0.15 + rand() * 1.3,
      y: -0.15 + rand() * 1.3,
      r: 0.62 + rand() * 0.55,
      // Later blobs are hotter, so the light stacks toward one place instead
      // of every hue fighting for the same area.
      stop: i,
    });
  }
  return blobs;
}

function buildNoise(): HTMLCanvasElement {
  const tile = document.createElement("canvas");
  tile.width = NOISE;
  tile.height = NOISE;
  const ctx = tile.getContext("2d");
  if (!ctx) return tile;
  const data = ctx.createImageData(NOISE, NOISE);
  for (let i = 0; i < data.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 255;
    data.data[i] = v;
    data.data[i + 1] = v;
    data.data[i + 2] = v;
    data.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return tile;
}

export function XMesh({
  palette = "ember",
  seed = 1,
  className,
}: {
  palette?: keyof typeof MESH_PALETTES;
  seed?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const host = canvas.parentElement;
    if (!host) return;

    const noise = buildNoise();
    let frame = 0;

    const draw = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;

      const pal = MESH_PALETTES[palette] ?? MESH_PALETTES.ember;
      const stops = pal.stops.map(hex);
      const base = hex(pal.base);
      const blobs = buildBlobs(seed, stops.length);

      const lw = LOD;
      const lh = Math.max(2, Math.round((LOD * h) / w));
      const field = document.createElement("canvas");
      field.width = lw;
      field.height = lh;
      const fctx = field.getContext("2d");
      if (!fctx) return;

      const img = fctx.createImageData(lw, lh);
      for (let y = 0; y < lh; y += 1) {
        for (let x = 0; x < lw; x += 1) {
          const nx = x / lw;
          const ny = y / lh;
          let r = base[0];
          let g = base[1];
          let b = base[2];

          for (const blob of blobs) {
            const dx = nx - blob.x;
            const dy = ny - blob.y;
            const d = Math.sqrt(dx * dx + dy * dy) / blob.r;
            // Smoothstep, not a gaussian. A gaussian never reaches zero, so
            // every blob tints the whole tile and the result goes grey; this
            // one is exactly zero past its radius, which keeps each hue where
            // it was put.
            const t = d >= 1 ? 0 : (1 - d) * (1 - d) * (3 - 2 * (1 - d));
            // Not squared. Squaring the smoothstep confined each hue to a tight
            // core and left most of the tile sitting on the near-black base, so
            // the row read as four dark rectangles where the reference has four
            // saturated ones. `t` alone lets a blob carry its colour most of the
            // way to its radius, which is what fills a card with light.
            const a = t;
            const [sr, sg, sb] = stops[blob.stop];
            // Screen. Additive clips to white the moment two blobs meet, and
            // the reference's cards keep their hue exactly where the light is
            // strongest.
            r = 255 - ((255 - r) * (255 - sr * a)) / 255;
            g = 255 - ((255 - g) * (255 - sg * a)) / 255;
            b = 255 - ((255 - b) * (255 - sb * a)) / 255;
          }

          const i = (y * lw + x) * 4;
          img.data[i] = r;
          img.data[i + 1] = g;
          img.data[i + 2] = b;
          img.data[i + 3] = 255;
        }
      }
      fctx.putImageData(img, 0, 0);

      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(field, 0, 0, canvas.width, canvas.height);

      const pattern = ctx.createPattern(noise, "repeat");
      if (pattern) {
        ctx.globalCompositeOperation = "overlay";
        ctx.globalAlpha = 0.085;
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
    };

    draw();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    });
    observer.observe(host);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [palette, seed]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className ?? ""}`}
    />
  );
}
