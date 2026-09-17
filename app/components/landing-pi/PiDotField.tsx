"use client";

import { useEffect, useRef } from "react";

/**
 * The field — the page's one piece of generative material.
 *
 * ── Measured, not guessed ──
 *
 * The reference page's bands are not canvases. Pulled on 21 Aug 2026 they are
 * pre-rendered PNGs — `compute-bg.png` at 4200x1080, `lab.png` at 4200x1052 —
 * served at 1398 wide. Only one canvas exists on that whole page and it is an
 * interactive widget. Worth knowing, because it explains the quality: those
 * are authored images, so matching them procedurally means matching what is
 * actually in them rather than approximating the impression.
 *
 * What is in them, read off the files at full size:
 *
 *   1. **A resting grid.** Both are, underneath everything, a regular lattice
 *      of near-black dots covering the entire frame — an LED wall with nothing
 *      playing on it. Every dot carries a faint and *individual* colour bias,
 *      so the ground has grain instead of being a flat wash. The first version
 *      of this component had no ground at all, which is the main reason it
 *      read as a placeholder: it was a gradient in a box, not a material.
 *
 *   2. **Per-element channel separation.** In `compute-bg` each bright bar is
 *      literally three adjacent columns — one red, one green, one blue, a
 *      pixel apart. Not a subtle tint: the channels are fully separated and
 *      converge to white only where they overlap. It is the look of a
 *      photographed display, and it is the detail doing the most work.
 *
 *   3. **One nameable geometry per band.** A wedge of bars converging on a
 *      vanishing point off the left edge. A lattice with curved trails rising
 *      out of the bottom into two bright clusters. A diagonal front of dashes.
 *      Each is a structure; none is noise.
 *
 * ── On colour ──
 *
 * Theirs resolves green. Copying a competitor's one saturated colour is the
 * move that reads as imitation rather than craft, so what is taken here is the
 * *separation*, not the hue: three channels drawn offset and composited
 * additively, which returns to neutral wherever the field is dense and leaves
 * colour only on the edges. The cast stays achromatic, like the rest of this
 * page.
 *
 * ── On speed ──
 *
 * Theirs do not move at all, and that is not a limitation they worked around —
 * it is most of why the page feels composed. Nothing on it competes with the
 * copy for attention.
 *
 * Ours move, because a band about throughput that is perfectly still is a
 * missed opportunity, but the first version moved far too fast and in the
 * worst possible way: a binary gate resampled at sixty frames a second, which
 * is a strobe rather than an animation. Every rate here was then cut by
 * roughly half again. A dash now takes two to three seconds to travel its
 * period and the activity waves take the better part of a minute, so the field
 * reads as a texture that happens to breathe rather than as something playing.
 * If it draws the eye off the headline it is still too fast.
 *
 * ── Why a canvas anyway ──
 *
 * A field of twenty thousand glyphs drawn three times is one element and three
 * passes a frame; the same thing as DOM nodes is a layout catastrophe.
 */

export type DotFieldShape = "columns" | "horizon" | "flare";

/** The three channels, drawn offset and added. R left, G centre, B right. */
const CHANNELS: readonly [number, number, number, number][] = [
  [-1, 255, 58, 68],
  [0, 64, 255, 150],
  [1, 90, 130, 255],
];

/** Resting-lattice geometry, off the reference at its served width. */
const GRID_PITCH = 22;
const GRID_DOT = 1.4;

/** Deterministic per-cell noise — a cell must not flicker frame to frame. */
const hash = (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

export function PiDotField({
  shape = "columns",
  className = "",
  /** 0 stops the animation entirely; used for the reduced-motion path. */
  speed = 1,
}: {
  shape?: DotFieldShape;
  className?: string;
  speed?: number;
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
    const rate = reduced ? 0 : speed;

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

    /**
     * One glyph, reused so a frame allocates nothing: position, size, weight,
     * and how far its channels separate.
     */
    const g = { x: 0, y: 0, w: 1.4, h: 1.4, a: 0, fringe: 1 };

    /**
     * The wall at rest.
     *
     * Under every band. Each cell is dim and favours one channel, drawn from a
     * stable hash so the ground has grain rather than being a flat wash, and a
     * slow breath crosses it so a band with nothing else happening is still
     * alive.
     */
    const lattice = (
      t: number,
      channel: number,
      weight: number,
      emit: () => void,
    ) => {
      g.w = GRID_DOT;
      g.h = GRID_DOT;
      g.fringe = 1;
      for (let y = GRID_PITCH * 0.5; y < height; y += GRID_PITCH) {
        for (let x = GRID_PITCH * 0.5; x < width; x += GRID_PITCH) {
          const n = hash(x, y);
          // Two cells in five stay dark. Lighting every cell — which this did
          // — is total coverage, and total coverage at low alpha is a veil
          // over the band rather than a wall behind it. Measured against the
          // reference, whose field lights under 2% of its frame.
          if (n < 0.4) continue;
          const bias = n < 0.6 ? 0 : n < 0.8 ? 1 : 2;
          const lean = bias === channel ? 1 : 0.28;
          // Its own slow rhythm per cell rather than one wave across the
          // whole wall, so the ground never pulses in unison.
          const breath = 0.55 + 0.45 * Math.sin(t * (0.05 + n * 0.08) + n * 40);
          g.x = x;
          g.y = y;
          g.a = 0.22 * lean * breath * weight;
          emit();
        }
      }
    };

    /**
     * Sandboxes, in perspective — their Compute wedge.
     *
     * Bars standing on a ground plane that converges off the left edge, so the
     * envelope opens as a wedge toward the viewer. Each bar is a column of 1px
     * dots rather than a solid rule, which is what gives the band texture at
     * any size, and the dots climb, so the shape reads as throughput rather
     * than as a decoration that happens to recede.
     */
    const columns = (t: number, emit: () => void) => {
      const COUNT = 104;
      const mid = height * 0.55;
      for (let i = 0; i < COUNT; i += 1) {
        // Even steps in world space; a power curve puts the vanishing point
        // hard against the left edge, so the bars crowd there and open out
        // toward the viewer. The first attempt inverted this and culled most
        // of the run, which is why the wedge came out as an even picket
        // fence.
        const u = i / (COUNT - 1);
        const x = width * Math.pow(u, 2.25);
        const depth = 0.06 + 0.94 * u;

        const seed = hash(i * 13.7, 4.2);
        // A slow standing wave decides which bars are busy, and a few sit
        // dark whatever the wave says — a full wall is a texture, a wall with
        // gaps is a set of things.
        const wave = Math.max(0, Math.sin(i * 0.34 - t * 0.09 + seed * 5));
        const busy = seed > 0.88 ? 0.12 : 0.52 + 0.48 * wave;
        // The envelope: a wedge, short at the vanishing point and running off
        // the top and bottom of the frame at the near end.
        // A hard wedge. The reference goes from bars a few pixels tall at the
        // vanishing point to bars running off the top and bottom of the frame
        // at the near end, and it is that ratio — not the convergence of the
        // spacing — that makes the band read as depth. A gentle exponent gave
        // an even picket fence twice.
        const reach =
          height * (0.012 + 1.2 * Math.pow(depth, 2.6)) * (0.62 + 0.38 * busy);
        const pitch = 1.2 + depth * 1.1;

        // Snapped to whole device pixels. Fractional widths antialias, the
        // three channels bleed into each other's edges, and the separation —
        // the entire point of the effect — composites back to grey. At dpr 2
        // a half-CSS-pixel step is one device pixel, so this is the finest
        // grid the fringing can survive.
        g.w = Math.max(0.5, Math.round((0.55 + depth * 1.1) * 2) / 2);
        g.h = Math.max(0.5, Math.round((0.5 + depth * 0.6) * 2) / 2);
        // Adjacent, not overlapping: side by side is what reads as three
        // columns.
        g.fringe = g.w;

        // The travelling dash pattern, as a *continuous* weight.
        //
        // This was a gate: `(y * 1.9 + t * 58 + i * 9) % 6 > 4.9 → skip`. At
        // sixty frames a second that phase advances almost a whole unit per
        // frame inside a modulus of six, so every dot was being resampled
        // on and off at random — which is not an animation, it is a strobe,
        // and it was the harshest thing on the page.
        //
        // Now the phase moves slowly and drives alpha through a soft band, so
        // each dot brightens and dims rather than switching. The floor keeps
        // the bar continuously present: a dot that reaches zero still reads as
        // a blink no matter how smoothly it got there.
        const period = pitch * 3.4;
        for (let y = mid - reach; y < mid + reach; y += pitch) {
          const phase = (((y + t * 3 + i * 4) % period) + period) % period;
          const band = Math.abs(phase / period - 0.5) * 2;
          const travel = 0.34 + 0.66 * (1 - band * band);
          const fall = 1 - Math.pow(Math.abs(y - mid) / reach, 1.7);
          g.x = Math.round(x * 2) / 2;
          g.y = Math.round(y * 2) / 2;
          // Near bars run to full white. In the reference the near end of the
          // wedge is the brightest thing on the page by a wide margin, and
          // three channels at full alpha under `lighter` is exactly white —
          // which is what makes the fringing show only at the edges.
          g.a = fall * busy * travel * (0.3 + 0.7 * depth) * 1.55;
          if (g.a > 0.02) emit();
        }
      }
    };

    /**
     * A run, over time — their Lab lattice.
     *
     * Trails rising out of the bottom edge and curving away, lighting the
     * cells they pass through, with brightness gathering into two clusters. In
     * the reference those clusters are the only saturated thing in the frame
     * and everything else is nearly black; that ratio is the whole effect, so
     * it is kept.
     */
    const horizonField = (t: number, emit: () => void) => {
      const TRAILS = 44;
      for (let s = 0; s < TRAILS; s += 1) {
        const k = s / (TRAILS - 1);
        const seed = hash(s * 7.3, 91.1);
        const foot = width * (0.04 + 0.96 * k);
        const bend = (0.35 + seed * 0.9) * width * 0.22;
        // Two clusters drift along the row of feet; a trail near one is lit.
        const c1 = 0.5 + 0.34 * Math.sin(t * 0.055);
        const c2 = 0.5 + 0.42 * Math.sin(t * 0.041 + 2.4);
        const near = Math.max(
          Math.max(0, 1 - Math.abs(k - c1) * 5),
          Math.max(0, 1 - Math.abs(k - c2) * 6.5) * 0.85,
        );
        // Every trail is faintly present; the clusters are what burn. In the
        // reference the ratio between the two is the whole picture — a lattice
        // with two hot spots, not a lattice with a wash over it.
        const lit = 0.16 + 1.5 * near * near;

        const steps = 46;
        for (let j = 0; j < steps; j += 1) {
          const p = j / (steps - 1);
          // Rises fast, then flattens — the curve of the reference.
          const y = height * (1.02 - Math.pow(p, 0.62) * 0.98);
          const x = foot + bend * Math.pow(p, 2.1);
          if (x > width + 4) break;
          // Continuous, not gated — see the note in `columns`. The trail
          // reads as something moving along it instead of a row of lamps
          // being switched.
          const phase = (((j * 3 + t * 2.2 + s * 5) % 9) + 9) % 9;
          const travel =
            0.3 + 0.7 * Math.max(0, 1 - Math.abs(phase / 9 - 0.5) * 2.6);
          const fade = (1 - p * 0.75) * travel;
          g.x = x;
          g.y = y;
          g.w = 1;
          g.h = 1;
          g.fringe = 1 + near * 1.2;
          g.a = lit * fade;
          if (g.a > 0.02) emit();
        }
      }
    };

    /**
     * Tokens, streaming — their Inference diagonal.
     *
     * A front crossing the frame on the diagonal, drawn as dashes so the
     * texture has direction, with a hard leading edge and a long tail. The
     * edge separates hardest into colour, which is what makes it read as
     * something passing rather than something merely lit.
     */
    const flare = (t: number, emit: () => void) => {
      const PITCH = 8;
      for (let y = PITCH * 0.5; y < height; y += PITCH) {
        for (let x = PITCH * 0.5; x < width + PITCH; x += PITCH) {
          const u = x / width;
          const v = y / height;
          const along = u * 0.78 + v * 0.46;
          // Its own phase, and re-derived after the slowdown. The shared
          // offset put this front just short of the frame at rest, so the band
          // painted empty and the copy sat on a blank rectangle. 21 puts the
          // head at 1.15 when the page opens, which is the far side of the
          // frame; a full sweep now takes 36 seconds.
          const head = (((t + 21) * 0.055) % 2) - 0.42;
          const d = along - head;
          if (d > 0.03) continue;
          const core = d > -0.035 ? 1 : 0.5;
          const i = Math.max(0, 1 + d * 1.2) * core;
          if (i <= 0.03) continue;
          const n = hash(x, y);
          g.x = x;
          g.y = y;
          // Dashes, longest at the front, and a few cells stay short.
          g.w = 1.6 + Math.round(i * 5) * (n > 0.78 ? 0.35 : 1);
          g.h = 1.6;
          g.fringe = 1 + i * 1.6;
          g.a = i * (0.24 + 0.76 * u) * 1.35;
          emit();
        }
      }
    };

    const draw = (now: number) => {
      // Offset, not zero. Two of the three shapes sweep a front across the
      // frame, and at t=0 that front is still outside it — the first painted
      // frame came out empty, which reads as a broken graphic rather than as
      // one about to start. Beginning mid-cycle costs nothing and means the
      // band is never blank.
      const t = 7.5 + (rate === 0 ? 0 : ((now - start) / 1000) * rate);

      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, width, height);
      // Additive: where all three channels land together the field returns to
      // neutral and only the edges keep a hue, which is what subpixel
      // separation physically is.
      ctx.globalCompositeOperation = "lighter";

      const run =
        shape === "columns"
          ? columns
          : shape === "horizon"
            ? horizonField
            : flare;

      // One pass per channel, so `fillStyle` is set a few dozen times a frame
      // rather than sixty thousand — the entire cost of a field this size.
      for (let c = 0; c < CHANNELS.length; c += 1) {
        const [offset, r, gr, b] = CHANNELS[c];
        const prefix = `rgba(${r},${gr},${b},`;
        let last = -1;
        const emit = () => {
          const q = Math.round(Math.min(1, g.a) * 40) / 40;
          if (q !== last) {
            ctx.fillStyle = `${prefix}${q})`;
            last = q;
          }
          ctx.fillRect(g.x + offset * g.fringe, g.y, g.w, g.h);
        };
        if (shape !== "columns") {
          lattice(t, c, shape === "horizon" ? 1 : 0.55, emit);
          last = -1;
        }
        run(t, emit);
      }

      ctx.globalCompositeOperation = "source-over";
      if (rate !== 0) frame = requestAnimationFrame(draw);
    };

    resize();
    frame = requestAnimationFrame(draw);

    const observer = new ResizeObserver(() => {
      resize();
      start = performance.now();
      if (rate === 0) requestAnimationFrame(draw);
    });
    observer.observe(canvas);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [shape, speed]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`block size-full ${className}`}
    />
  );
}
