"use client";

import { RIFT_SYMBOL_PATH } from "@/lib/brand/logo";

import { useEffect, useRef } from "react";

/**
 * The mark, rendered as pixels — the reference's research-card graphic.
 *
 * Prime Intellect closes its research card with its own logo drawn as large
 * pixel blocks standing in a field of small coloured dots, dashes and thin
 * bars. It is the one place on their page where the brand itself becomes the
 * illustration, and it works because the mark is not *pasted onto* a texture:
 * it is made of the same material as the texture, at a coarser grain.
 *
 * ── How this draws it ──
 *
 * The mark is not redrawn here. The shared path and its rotated copy are the exact
 * geometry from the supplied brand package — the same artwork every
 * other surface renders — filled into an offscreen canvas at grid resolution
 * and read back as a mask. A second copy of a logo is a second thing to keep
 * current when the brand moves, and a hand-plotted pixel version would be
 * exactly that.
 *
 * The field around it uses the same channel separation as PiDotField: three
 * offsets composited additively, so density returns to neutral and only edges
 * carry colour.
 */

/** The artwork's own viewBox. */
const MARK_BOX = 124;

/** The three channels, drawn offset and added. Matches PiDotField. */
const CHANNELS: readonly [number, number, number, number][] = [
  [-1, 255, 58, 68],
  [0, 64, 255, 150],
  [1, 90, 130, 255],
];

/** Deterministic per-cell noise — a cell must not flicker frame to frame. */
const hash = (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

/** How many mark cells across. Coarse enough to read as pixels, fine enough
 *  that the mark is still recognisable at a glance. */
const MARK_CELLS = 46;

export function PiPixelMark({
  className = "size-full",
  /** Where the mark's centre sits across the canvas, 0-1. */
  anchorX = 0.5,
  /** How much of the shorter axis the mark occupies, 0-1. */
  scale = 1,
}: {
  className?: string;
  anchorX?: number;
  scale?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    /**
     * The mask, built once.
     *
     * The artwork is filled into a small offscreen canvas at exactly the cell
     * resolution and read back, so a cell is lit if the mark covers it. Doing
     * it this way rather than by eye means the pixel version follows the real
     * mark automatically the day the real mark changes.
     */
    const mask: boolean[] = [];
    const off = document.createElement("canvas");
    off.width = MARK_CELLS;
    off.height = MARK_CELLS;
    const offCtx = off.getContext("2d", { willReadFrequently: true });
    if (offCtx) {
      const scale = MARK_CELLS / MARK_BOX;
      offCtx.setTransform(scale, 0, 0, scale, 0, 0);
      offCtx.fillStyle = "#fff";
      offCtx.translate(12, 12);
      const symbol = new Path2D(RIFT_SYMBOL_PATH);
      offCtx.fill(symbol);
      offCtx.translate(100, 100);
      offCtx.rotate(Math.PI);
      offCtx.fill(symbol);
      const data = offCtx.getImageData(0, 0, MARK_CELLS, MARK_CELLS).data;
      for (let i = 0; i < MARK_CELLS * MARK_CELLS; i += 1) {
        mask[i] = data[i * 4 + 3] > 90;
      }
    }

    let width = 0;
    let height = 0;
    let frame = 0;
    let start = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const g = { x: 0, y: 0, w: 2, h: 2, a: 0, fringe: 1 };

    const draw = (now: number) => {
      const t = reduced ? 6 : (now - start) / 1000;

      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";

      // The mark sits centred and as large as the shorter axis allows.
      const block = Math.max(
        2,
        Math.floor(Math.min(width, height) / MARK_CELLS),
      );
      const markSize = block * MARK_CELLS;
      const originX = (width - markSize) / 2;
      const originY = (height - markSize) / 2;
      const gap = Math.max(1, Math.round(block * 0.18));

      for (let c = 0; c < CHANNELS.length; c += 1) {
        const [offset, r, gr, b] = CHANNELS[c];
        const prefix = `rgba(${r},${gr},${b},`;
        let last = -1;
        const emit = () => {
          const q = Math.round(Math.min(1, g.a) * 32) / 32;
          if (q !== last) {
            ctx.fillStyle = `${prefix}${q})`;
            last = q;
          }
          ctx.fillRect(g.x + offset * g.fringe, g.y, g.w, g.h);
        };

        // ── The scattered field ────────────────────────────────────────────
        //
        // Measured off a 12-second capture of the reference graphic on 22 Aug
        // 2026, because the first version was wrong in three ways at once and
        // all three only show up in motion:
        //
        //   1. **Density.** Their field lights 1.79% of the frame. This drew a
        //      glyph in every cell at low alpha — near total coverage, which
        //      reads as a veil laid over the mark rather than a constellation
        //      behind it.
        //
        //   2. **Motion.** Cross-correlating two frames 500ms apart returns a
        //      shift of exactly zero: the field does not drift, sweep or
        //      travel. Glyphs switch on and off *in place*, and only 3-5% of
        //      pixels change between samples 167ms apart. It is an LED wall
        //      idling, not something playing.
        //
        //   3. **Colour.** Mostly neutral greys, a blue-leaning minority, rare
        //      warm accents — not the even RGB separation the section bands
        //      use.
        //
        // The three together are why theirs is calm and this was not.
        const pitch = 13;
        for (let y = pitch * 0.5; y < height; y += pitch) {
          for (let x = pitch * 0.5; x < width; x += pitch) {
            const n = hash(x, y);
            // Sparse: five cells in six stay dark forever.
            if (n < 0.83) continue;
            const seed = hash(x * 1.7, y * 2.3);
            // Each glyph keeps its own rhythm, so nothing pulses in unison.
            // Between roughly four and eleven seconds a cycle.
            const wave = Math.sin(t * (0.09 + seed * 0.15) + seed * 44);
            // Most of the cycle is spent off, which is what makes a field this
            // sparse read as twinkling rather than blinking.
            const on = Math.max(0, wave - 0.35) / 0.65;
            if (on <= 0.02) continue;

            // Three glyphs by hash, stable per cell.
            if (n > 0.975) {
              g.w = 1.6;
              g.h = 5 + Math.round(seed * 8);
            } else if (n > 0.93) {
              g.w = 3 + Math.round(seed * 3);
              g.h = 1.6;
            } else {
              g.w = 1.6;
              g.h = 1.6;
            }

            // Neutral by default; a minority leans to the channel it was
            // dealt. That is what gives the field its cast without any single
            // cell being a saturated colour.
            const neutral = seed < 0.62;
            const lean = neutral || (seed < 0.9 ? c === 2 : c === 0) ? 1 : 0.34;
            g.x = x;
            g.y = y;
            g.fringe = 1;
            g.a = on * (0.3 + 0.55 * seed) * lean;
            emit();
          }
        }

        // ── The mark ───────────────────────────────────────────────────────
        //
        // Static. Completely.
        //
        // It used to be crossed by a slow diagonal front so the logo
        // "assembled". In the reference the mark does not move at all — it is
        // the one fixed, crisp thing in the frame, and every bit of motion
        // lives in the sparse field around it. That contrast is the effect: a
        // moving mark and a moving field are two things competing, and the
        // mark is the one a reader is trying to look at.
        //
        // What is left is a gradient across the pixels, brighter toward the
        // top right, which is in the reference too and costs nothing.
        g.w = Math.max(1, block - gap);
        g.h = g.w;
        g.fringe = Math.max(1, block * 0.14);
        for (let row = 0; row < MARK_CELLS; row += 1) {
          for (let col = 0; col < MARK_CELLS; col += 1) {
            if (!mask[row * MARK_CELLS + col]) continue;
            const across =
              (col / MARK_CELLS) * 0.6 + (1 - row / MARK_CELLS) * 0.4;
            g.x = originX + col * block;
            g.y = originY + row * block;
            g.a = 0.66 + 0.34 * across;
            emit();
          }
        }
      }

      ctx.globalCompositeOperation = "source-over";
      if (!reduced) frame = requestAnimationFrame(draw);
    };

    resize();
    frame = requestAnimationFrame(draw);

    const observer = new ResizeObserver(() => {
      resize();
      start = performance.now();
      if (reduced) requestAnimationFrame(draw);
    });
    observer.observe(canvas);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [anchorX, scale]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="RIFT"
      className={`block ${className}`}
    />
  );
}
