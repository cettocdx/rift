"use client";

import { useEffect, useRef } from "react";

/**
 * The atmosphere layer — the reason the page reads as photography rather than
 * as CSS.
 *
 * SpaceX's pages are almost entirely black, and the thing that keeps them from
 * looking like an empty div is a single enormous, extremely soft light source:
 * the lit edge of the earth under a black sky, or the glow a plume throws onto
 * the dark around it. It is one gradient. The reason it is hard to copy is not
 * the shape — it is that a gradient this wide and this dark *bands*.
 *
 * A CSS `radial-gradient` interpolates in 8-bit sRGB. Across 900px of near-black
 * the steps between #0a0a0a and #10131a are whole integers, so the browser draws
 * perhaps twelve visible bands and the eye finds every one of them. That is the
 * difference between this and the "glow div" every dark landing page has.
 *
 * So it is drawn, not declared, in three passes:
 *
 *   1. The field is computed at a *small* size (see `FIELD_H`) and blown up by
 *      the browser's bilinear filter. Upscaling smooth data is free and lands
 *      the value between the 8-bit steps rather than on them.
 *   2. A tiled noise plate goes over it at low alpha. This is ordered dithering
 *      by another name: ±1/255 of per-pixel noise pushes each pixel across the
 *      quantisation boundary at a different place, and the bands dissolve. It
 *      is also, not coincidentally, film grain, which is why the result reads
 *      as a photograph of light rather than a rendering of it.
 *   3. Nothing animates. This is a still, drawn once per resize. A background
 *      that costs a rAF frame for the life of the page is a background that
 *      makes everything in front of it stutter on a laptop.
 */

type Variant = "limb" | "plume" | "wash";

/**
 * The field is computed this tall and stretched. 180px carries every gradient
 * on this page — they are all low-frequency by construction — and it means the
 * per-pixel loop runs ~57k times instead of ~2M.
 */
const FIELD_H = 180;
const NOISE = 128;

/**
 * The sphere, in field units where 1.0 is the frame's height. Big enough that
 * roughly a fifth of the arc crosses a 16:9 frame — any tighter and it reads
 * as a ball, any wider and the curvature disappears again.
 */
const RADIUS = 2.35;
/** How far the atmosphere extends above the surface. ~2.5% of the radius. */
const SHELL = 0.058;

/**
 * Colour, in the two registers the reference uses.
 *
 * `limb` is the lit edge of something enormous seen from outside its shadow:
 * *narrow* — the brightness is in the last few percent before the horizon, not
 * spread evenly up the frame. `plume` is combustion: warm, wider, and falling
 * off to nothing much faster.
 *
 * The limb was blue-white ([150,192,255]) and is now neutral. That is not a
 * taste edit: the only thing that renders it is /landing/x's closing frame,
 * and that page's palette has no hue in it — an arc of cold blue was the last
 * colour on the page with nothing else to agree with. Neutral white reads as
 * the same photograph shot in black and white, which is the register the rest
 * of the page is already in.
 *
 * Both are kept dark on purpose. The page's type is white; an atmosphere that
 * competes with it has stopped being atmosphere.
 */
const PALETTE: Record<
  Variant,
  { core: [number, number, number]; gain: number }
> = {
  limb: { core: [232, 232, 232], gain: 1.25 },
  plume: { core: [255, 174, 104], gain: 0.62 },
  wash: { core: [222, 222, 222], gain: 0.26 },
};

function buildNoise(): HTMLCanvasElement {
  const tile = document.createElement("canvas");
  tile.width = NOISE;
  tile.height = NOISE;
  const ctx = tile.getContext("2d");
  if (!ctx) return tile;
  const data = ctx.createImageData(NOISE, NOISE);
  for (let i = 0; i < data.data.length; i += 4) {
    // Monochrome noise. Coloured noise on a near-black ground reads as a dead
    // pixel, not as grain.
    const v = 128 + (Math.random() - 0.5) * 255;
    data.data[i] = v;
    data.data[i + 1] = v;
    data.data[i + 2] = v;
    data.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return tile;
}

export function XAtmosphere({
  variant = "limb",
  className,
  /** Where the light sits horizontally, 0–1. */
  cx = 0.5,
  /**
   * Where the horizon sits vertically, 0–1. For `limb` this is the line the
   * brightness runs along; above it the sky goes black, below it the ground
   * falls away.
   */
  cy = 0.82,
  /** Multiplier on the palette's own gain, for a section that wants less. */
  intensity = 1,
}: {
  variant?: Variant;
  className?: string;
  cx?: number;
  cy?: number;
  intensity?: number;
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

      // The aspect the field is computed at. Kept honest so an ellipse drawn
      // in field space lands as the same ellipse after the stretch.
      const fw = Math.max(2, Math.round(FIELD_H * (w / h)));
      const field = document.createElement("canvas");
      field.width = fw;
      field.height = FIELD_H;
      const fctx = field.getContext("2d");
      if (!fctx) return;

      // Field space is normalised 0–1 on both axes, so a circle drawn in it
      // would stretch into an ellipse on a wide viewport. Scaling x by the
      // aspect makes the sphere a sphere again.
      const aspect = fw / FIELD_H;

      const img = fctx.createImageData(fw, FIELD_H);
      const { core, gain } = PALETTE[variant];
      const g = gain * intensity;

      for (let y = 0; y < FIELD_H; y += 1) {
        const ny = y / FIELD_H;
        for (let x = 0; x < fw; x += 1) {
          const nx = x / fw;

          let a: number;
          if (variant === "limb") {
            /*
             * A real limb, not a glow at the bottom of the frame.
             *
             * The first version was an ellipse, and an ellipse wide enough to
             * span the viewport has no visible curvature left in it — it read
             * as a flat band of light lying along the bottom edge, which is
             * the thing every dark landing page already has.
             *
             * This is a sphere instead. The centre sits far below the frame
             * and the radius is large enough that only the top of it crosses;
             * what you see is the shell at d ≈ R, which is a genuine arc. The
             * body below it is dark — a planet occludes, it does not glow —
             * and the atmosphere above falls off over a few percent of the
             * radius, brightest right at the surface. That asymmetry is the
             * whole effect: light hugging a curve with something solid under
             * it.
             */
            const dx = (nx - cx) * aspect;
            const dy = ny - cy;
            const d = Math.sqrt(dx * dx + dy * dy);
            const t = (d - RADIUS) / SHELL;
            a =
              t < 0
                ? // Inside the body. Not black — a limb seen against the sun
                  // has a hairline of light on the surface itself — but it
                  // dies four times faster than the atmosphere above it.
                  Math.exp(-t * t * 16)
                : Math.exp(-t * t);
            a *= 0.34 + 0.66 * Math.exp(-dx * dx * 0.55);
          } else if (variant === "plume") {
            const dx = (nx - cx) / 0.66;
            const dy = (ny - cy) / 0.34;
            const d = Math.sqrt(dx * dx + dy * dy);
            a = Math.exp(-d * d * 1.5);
          } else {
            // A wash has no source. It is a bias across the whole frame, used
            // where a section needs to not be flat black but must not look
            // like it is lit from somewhere.
            const dx = (nx - cx) / 1.15;
            const dy = (ny - cy) / 0.95;
            a = Math.exp(-(dx * dx + dy * dy) * 1.1);
          }

          // Squared, not cubed. The shell falloff is already a gaussian and
          // is far tighter than the blobs the cube was tuned for; cubing it as
          // well left the limb invisible on anything but an OLED.
          a = a * a * g;

          const i = (y * fw + x) * 4;
          img.data[i] = core[0] * a;
          img.data[i + 1] = core[1] * a;
          img.data[i + 2] = core[2] * a;
          img.data[i + 3] = 255;
        }
      }
      fctx.putImageData(img, 0, 0);

      // The visible canvas is capped below devicePixelRatio: this is smooth
      // data with grain on top, and there is nothing at 2× for a retina pass
      // to resolve except four times the memory.
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

      // Pass 2 — the dither. `overlay` lifts and darkens around mid-grey and
      // leaves true black alone, so the grain lands on the gradient and not on
      // the empty sky above it.
      const pattern = ctx.createPattern(noise, "repeat");
      if (pattern) {
        ctx.globalCompositeOperation = "overlay";
        ctx.globalAlpha = 0.055;
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
    };

    draw();

    // Coalesced to one frame: a drag-resize fires continuously and each draw
    // walks the whole field.
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    });
    observer.observe(host);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [variant, cx, cy, intensity]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className ?? ""}`}
    />
  );
}
