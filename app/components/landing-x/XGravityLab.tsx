"use client";

import { useEffect, useRef } from "react";

/**
 * Gravity Lab — the artifact the receipt's run produced, live and interactive.
 *
 * The receipt used to show a flat screenshot of this. It is the *output* of a
 * real run ("build a gravity simulation: bouncing balls with collisions"), and
 * an output you can push around is a far better proof than a picture of one —
 * so it is the actual thing, running, in the frame.
 *
 * The look is built the way the rest of the page's dark graphics are: every
 * body is drawn with additive blending over a frame that is faded rather than
 * cleared, so motion leaves a trail and overlapping glows sum toward white —
 * a cheap, convincing bloom with no post-processing pass. Bodies carry a faint
 * RGB separation in their halo, which is what keeps the light reading as light
 * rather than as flat coloured circles.
 *
 * Interaction:
 *   • the pointer is a gravity well — bodies fall toward it while it is over
 *     the canvas, and harder while it is pressed;
 *   • click / tap spawns a new body with a flick of momentum;
 *   • everything collides with everything, elastically, and with the walls.
 *
 * Cost is bounded the same way every animated surface here is: one rAF, gated
 * by an IntersectionObserver and `document.hidden`; DPR capped; a hard cap on
 * body count; full teardown on unmount. Under `prefers-reduced-motion` the
 * simulation does not run — a single settled frame is drawn instead.
 */

type Body = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** 0 blue · 1 white · 2 warm — picks the halo's dominant channel. */
  tone: number;
};

const MAX_BODIES = 46;
const START_BODIES = 26;

/** Deterministic, so the opening arrangement is the same every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Two schemes, because this component has two hosts.
 *
 * `chromatic` is the original and stays the default: /landing/h re-exports
 * this file as HGravityLab and is built on the blue-and-warm register, so
 * changing these in place would restyle a page nobody asked to change.
 *
 * `neutral` is /landing/x, whose palette carries no hue at all — the ink is
 * pure black and every tint under it is an alpha of that black. A cold-blue
 * artifact in the middle of it is the one place a reader would find a colour
 * the rest of the page has no explanation for. The warm tone survives the
 * translation: the objection is to blue, and a page with a single warm accent
 * inside one dark frame still reads as monochrome.
 */
type Scheme = "chromatic" | "neutral";

const SCHEMES: Record<
  Scheme,
  {
    tones: [number, number, number][];
    /** The guaranteed paint when the loop is not running. */
    ground: string;
    /** The per-frame fade that makes the trail. */
    trail: string;
    /** The pointer's gravity well. */
    well: string;
  }
> = {
  chromatic: {
    tones: [
      [120, 170, 255], // cold blue
      [235, 240, 255], // near white
      [255, 180, 120], // warm
    ],
    ground: "#06080e",
    trail: "rgba(6, 8, 14, 0.28)",
    well: "rgba(150,190,255,0.18)",
  },
  neutral: {
    tones: [
      [178, 178, 178], // graphite
      [240, 240, 240], // near white
      [255, 180, 120], // warm
    ],
    ground: "#070707",
    trail: "rgba(7, 7, 7, 0.28)",
    well: "rgba(255,255,255,0.14)",
  },
};

export function XGravityLab({
  className,
  scheme = "chromatic",
}: {
  className?: string;
  scheme?: Scheme;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const { tones: TONES, ground, trail, well } = SCHEMES[scheme];
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.cursor = "crosshair";
    canvas.setAttribute("role", "img");
    canvas.setAttribute(
      "aria-label",
      "Gravity Lab — an interactive physics simulation of glowing bodies",
    );
    host.appendChild(canvas);

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rand = rng(20260823);

    let w = 0;
    let h = 0;
    const bodies: Body[] = [];

    const spawn = (x: number, y: number, vx = 0, vy = 0, r = 0) => {
      if (bodies.length >= MAX_BODIES) bodies.shift();
      bodies.push({
        x,
        y,
        vx,
        vy,
        r: r || 5 + rand() * 12,
        tone: Math.floor(rand() * 3),
      });
    };

    const seed = () => {
      bodies.length = 0;
      for (let i = 0; i < START_BODIES; i += 1) {
        spawn(
          rand() * w,
          rand() * h * 0.5,
          (rand() - 0.5) * 40,
          rand() * 20,
          5 + rand() * 12,
        );
      }
    };

    const resize = () => {
      w = host.clientWidth;
      h = host.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!bodies.length) seed();
      // Always leave a valid frame: the tick is gated by visibility and does
      // not run at all under reduced-motion, so the only guaranteed paint is
      // here. Without it the canvas stays its clear colour whenever the loop
      // is off — a black rectangle where the artifact should be.
      ctx.fillStyle = ground;
      ctx.fillRect(0, 0, w, h);
      draw();
    };

    // Pointer as a gravity well.
    const pointer = { x: 0, y: 0, active: false, pressed: false };
    const toLocal = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
    };
    const onMove = (e: PointerEvent) => {
      toLocal(e);
      pointer.active = true;
    };
    const onLeave = () => {
      pointer.active = false;
      pointer.pressed = false;
    };
    const onDown = (e: PointerEvent) => {
      toLocal(e);
      pointer.pressed = true;
      // A spawn with a flick away from where they pressed.
      spawn(
        pointer.x,
        pointer.y,
        (rand() - 0.5) * 120,
        -40 - rand() * 80,
        7 + rand() * 12,
      );
    };
    const onUp = () => {
      pointer.pressed = false;
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);

    const GRAV = 26; // constant downward pull
    const REST = 0.72; // wall restitution

    const step = (dt: number) => {
      const n = bodies.length;
      // Integrate.
      for (let i = 0; i < n; i += 1) {
        const b = bodies[i];
        b.vy += GRAV * dt;
        if (pointer.active) {
          const dx = pointer.x - b.x;
          const dy = pointer.y - b.y;
          const d2 = dx * dx + dy * dy + 400;
          const pull = (pointer.pressed ? 5200 : 2100) / d2;
          b.vx += dx * pull * dt;
          b.vy += dy * pull * dt;
        }
        // gentle drag so the system settles rather than heating up
        b.vx *= 0.999;
        b.vy *= 0.999;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        // walls
        if (b.x - b.r < 0) {
          b.x = b.r;
          b.vx = Math.abs(b.vx) * REST;
        } else if (b.x + b.r > w) {
          b.x = w - b.r;
          b.vx = -Math.abs(b.vx) * REST;
        }
        if (b.y - b.r < 0) {
          b.y = b.r;
          b.vy = Math.abs(b.vy) * REST;
        } else if (b.y + b.r > h) {
          b.y = h - b.r;
          b.vy = -Math.abs(b.vy) * REST;
          b.vx *= 0.98;
        }
      }
      // Pairwise elastic collisions (n is small and capped).
      for (let i = 0; i < n; i += 1) {
        const a = bodies[i];
        for (let j = i + 1; j < n; j += 1) {
          const b = bodies[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);
          const min = a.r + b.r;
          if (dist > 0 && dist < min) {
            const nx = dx / dist;
            const ny = dy / dist;
            const overlap = (min - dist) / 2;
            a.x -= nx * overlap;
            a.y -= ny * overlap;
            b.x += nx * overlap;
            b.y += ny * overlap;
            // relative velocity along the normal
            const rvx = b.vx - a.vx;
            const rvy = b.vy - a.vy;
            const rel = rvx * nx + rvy * ny;
            if (rel < 0) {
              const ma = a.r * a.r;
              const mb = b.r * b.r;
              const imp = (2 * rel) / (ma + mb);
              a.vx += imp * mb * nx;
              a.vy += imp * mb * ny;
              b.vx -= imp * ma * nx;
              b.vy -= imp * ma * ny;
            }
          }
        }
      }
    };

    const draw = () => {
      // Fade rather than clear — this is the trail and the bloom base.
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = trail;
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = "lighter";
      for (const b of bodies) {
        const [cr, cg, cb] = TONES[b.tone];
        // Wide soft halo.
        const halo = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 4.2);
        halo.addColorStop(0, `rgba(${cr},${cg},${cb},0.55)`);
        halo.addColorStop(0.4, `rgba(${cr},${cg},${cb},0.14)`);
        halo.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * 4.2, 0, Math.PI * 2);
        ctx.fill();
        // Bright core.
        const core = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        core.addColorStop(0, "rgba(255,255,255,0.95)");
        core.addColorStop(0.6, `rgba(${cr},${cg},${cb},0.9)`);
        core.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // The gravity well, when the pointer is over the canvas.
      if (pointer.active) {
        const ring = ctx.createRadialGradient(
          pointer.x,
          pointer.y,
          0,
          pointer.x,
          pointer.y,
          pointer.pressed ? 90 : 60,
        );
        ring.addColorStop(0, well);
        ring.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = ring;
        ctx.beginPath();
        ctx.arc(
          pointer.x,
          pointer.y,
          pointer.pressed ? 90 : 60,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    };

    let frame = 0;
    let visible = false;
    let last = 0;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (!visible || document.hidden) {
        last = now;
        return;
      }
      // Clamp dt so a tab returning from the background does not explode.
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      // Two substeps for stable collisions at speed.
      step(dt / 2);
      step(dt / 2);
      draw();
    };

    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) last = performance.now();
      },
      { rootMargin: "120px" },
    );
    io.observe(host);

    if (!still) frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      canvas.remove();
    };
    // `scheme` is read at the top of the effect and closed over by `draw`, so
    // it has to be a dependency. It is a literal at both call sites, so this
    // never actually re-runs — but a lint suppression here would be the kind
    // that quietly breaks the day someone makes it stateful.
  }, [scheme]);

  return <div ref={hostRef} className={className} />;
}
