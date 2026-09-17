"use client";

import { RIFT_SYMBOL_PATH } from "@/lib/brand/logo";

import { useEffect, useRef } from "react";

/**
 * The RIFT mark, scattering and reassembling.
 *
 * ── What it is ──
 *
 * The closing band used a still pixel mark borrowed from /landing/pi. This is
 * the same idea given the motion the section deserves: the mark is rasterised
 * into a grid of cells, each cell is thrown out to a random point, and the
 * whole field eases back into the logo — over and over, with a hold at the
 * assembled state. It is the page's last frame, and "the pieces come together"
 * is the right note for a product whose argument is that it finishes the job.
 *
 * ── Rasterised from the real artwork, not hand-plotted ──
 *
 * The shared path and its rotated copy are the canonical mark (the same geometry
 * `components/icons/rift-logo` draws and `public/rift-icon-mono.svg` holds).
 * They are filled into an offscreen canvas at exactly the cell resolution and
 * read back, so a cell is lit if the mark covers it. The pixel version follows
 * the real mark automatically the day the real mark changes — a hand-plotted
 * grid would silently drift.
 *
 * ── Motion direction ──
 *
 * The first cut exploded: every cell flew to a random bearing and the mark
 * dissolved into noise before reassembling. Three direction defects, in the
 * vocabulary of the motion-art-direction skill:
 *
 *  1. **Wrong personality.** This page is calm-sharp — enterprise, deliberate,
 *     zero overshoot. A radial explosion is kinetic-soft. Mixing cells is the
 *     first cause of motion that reads as cheap, and it read as cheap.
 *  2. **No anchor.** Every cell moved at once, so the eye had no home and the
 *     frame was noise for half the cycle.
 *  3. **The motion carried the wrong meaning.** An exploding logo says
 *     destruction. This page's argument is assembly — pieces arriving into a
 *     verified result — so the mark should *converge*, never shatter.
 *
 * What it does now: the cells arrive on one consistent bearing, in a
 * left-to-right cascade, over a short travel. The mark stays legible the whole
 * way; it resolves rather than reforms. One easing family
 * (`cubic-bezier(0.2, 0, 0, 1)` — Corporate), travel under a fifth of the
 * mark, no overshoot, and a long hold at rest so the still logo is what a
 * reader mostly sees.
 *
 * Canvas rather than DOM: ~900 lit cells as elements would thrash layout every
 * frame. The loop runs only while on screen, and under reduced motion the mark
 * is drawn once, assembled, and left alone.
 */

const MARK_BOX = 124;
const CELLS = 64;

/** Cycle: scatter, assemble, hold. */
const SCATTER_MS = 1300;
const ASSEMBLE_MS = 1600;
const HOLD_MS = 3400;
const CYCLE = SCATTER_MS + ASSEMBLE_MS + HOLD_MS;

/** Deterministic per-cell scatter — a cell must fly to the same place each cycle. */
function hash(i: number) {
  let s = (i * 2654435761) >>> 0;
  s ^= s >>> 15;
  s = (s * 2246822507) >>> 0;
  s ^= s >>> 13;
  return (s >>> 0) / 4294967296;
}

/**
 * The one easing family for this piece — Corporate: decelerate hard into the
 * landing, no overshoot. `cubic-bezier(0.2, 0, 0, 1)` as a scalar.
 */
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export function XShatterMark({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Rasterise the real artwork into a cell mask.
    const cells: {
      cx: number;
      cy: number;
      sx: number;
      sy: number;
      d: number;
    }[] = [];
    const off = document.createElement("canvas");
    off.width = CELLS;
    off.height = CELLS;
    const offCtx = off.getContext("2d", { willReadFrequently: true });
    if (offCtx) {
      const scale = CELLS / MARK_BOX;
      offCtx.setTransform(scale, 0, 0, scale, 0, 0);
      offCtx.fillStyle = "#fff";
      offCtx.translate(12, 12);
      const symbol = new Path2D(RIFT_SYMBOL_PATH);
      offCtx.fill(symbol);
      offCtx.translate(100, 100);
      offCtx.rotate(Math.PI);
      offCtx.fill(symbol);
      const data = offCtx.getImageData(0, 0, CELLS, CELLS).data;
      for (let i = 0; i < CELLS * CELLS; i++) {
        if (data[i * 4 + 3] <= 90) continue;
        const gx = i % CELLS;
        const gy = Math.floor(i / CELLS);
        // One bearing for every cell — down-right, with a little jitter so
        // the field is not a rigid sheet. Travel is short: under a fifth of
        // the mark, which is the intensity budget for a calm-sharp piece.
        const jitter = (hash(i) - 0.5) * 0.5;
        const travel = (0.1 + hash(i + 9001) * 0.06) * CELLS;
        cells.push({
          cx: gx,
          cy: gy,
          sx: gx + travel * (0.85 + jitter),
          sy: gy + travel * (0.45 + jitter),
          // Cascade left-to-right across the mark rather than at random, so
          // the assembly has a direction the eye can follow. A hair of noise
          // keeps the wavefront from looking like a ruler.
          d: (gx / CELLS) * 0.45 + hash(i + 17) * 0.08,
        });
      }
    }

    const reduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let w = 0;
    let h = 0;
    let dpr = 1;
    const resize = () => {
      const rect = host.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();

    const render = (assembled: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // Fit the mark box into the frame with a margin.
      const span = Math.min(w, h) * 0.86;
      const cell = span / CELLS;
      const ox = (w - span) / 2;
      const oy = (h - span) / 2;

      ctx.fillStyle = "#ffffff";
      for (const c of cells) {
        // Per-cell progress, delayed then clamped.
        const t = Math.max(0, Math.min(1, (assembled - c.d) / (1 - c.d)));
        const e = ease(t);
        const x = c.sx + (c.cx - c.sx) * e;
        const y = c.sy + (c.cy - c.sy) * e;
        // Scattered pieces are small and dim; assembled ones are full size.
        // The ramp is what makes the mark *resolve* rather than slide into
        // place — the same reason the page's reveal defocuses rather than
        // translating.
        // Floors, not zeroes: the mark never disappears, it only softens.
        // A logo that dissolves into noise has stopped being a logo.
        const r = cell * (0.3 + e * 0.2);
        ctx.globalAlpha = 0.3 + e * 0.7;
        ctx.beginPath();
        ctx.arc(
          ox + x * cell + cell / 2,
          oy + y * cell + cell / 2,
          r,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    if (reduced) {
      render(1);
      const ro =
        typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(() => {
              resize();
              render(1);
            })
          : null;
      ro?.observe(host);
      return () => ro?.disconnect();
    }

    let raf = 0;
    let visible = true;
    let t0 = performance.now();

    const frame = (now: number) => {
      const p = ((now - t0) % CYCLE) / CYCLE;
      const scatterEnd = SCATTER_MS / CYCLE;
      const assembleEnd = (SCATTER_MS + ASSEMBLE_MS) / CYCLE;
      let assembled: number;
      if (p < scatterEnd) {
        // Flying apart: 1 → 0.
        assembled = 1 - p / scatterEnd;
      } else if (p < assembleEnd) {
        assembled = (p - scatterEnd) / (assembleEnd - scatterEnd);
      } else {
        assembled = 1;
      }
      render(assembled);
      raf = visible ? requestAnimationFrame(frame) : 0;
    };

    const start = () => {
      if (!raf && visible) {
        t0 = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => resize())
        : null;
    ro?.observe(host);

    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            ([e]) => {
              visible = e.isIntersecting;
              if (visible) start();
              else stop();
            },
            { threshold: 0.1 },
          )
        : null;
    if (io) io.observe(host);
    else start();
    start();

    return () => {
      stop();
      ro?.disconnect();
      io?.disconnect();
    };
  }, []);

  return (
    <div ref={hostRef} className={`relative ${className ?? ""}`}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 size-full"
        aria-hidden
      />
    </div>
  );
}
