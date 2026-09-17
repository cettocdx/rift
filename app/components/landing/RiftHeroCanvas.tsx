"use client";

import { RIFT_SYMBOL_PATH, RIFT_WORDMARK_PATHS } from "@/lib/brand/logo";
import { useEffect, useRef } from "react";

/**
 * Interactive particle-morph hero for the RIFT landing page.
 * A cyan point-cloud continuously morphs between three target forms —
 * a scattered scan field, the "RIFT" wordmark, and the canonical RIFT glyph.
 * The cursor acts as a live scan probe: nearby particles are displaced and
 * energized, a targeting reticle tracks the pointer, and scan beams connect
 * to the closest points. Pauses offscreen, respects prefers-reduced-motion.
 */

type Pt = { x: number; y: number };

const SIGNAL = "217, 119, 87"; // --signal (dark) as rgb
const FORMS = ["cloud", "wordmark", "mark", "cloud"] as const;

function fitPoints(raw: Pt[], w: number, h: number, scale: number): Pt[] {
  if (raw.length === 0) return raw;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of raw) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;
  const target = Math.min(w, h) * scale;
  const s = target / Math.max(bw, bh);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return raw.map((p) => ({
    x: w / 2 + (p.x - cx) * s,
    y: h / 2 + (p.y - cy) * s,
  }));
}

function sampleDraw(
  drawFn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  bufW: number,
  bufH: number,
  step: number,
): Pt[] {
  const c = document.createElement("canvas");
  c.width = bufW;
  c.height = bufH;
  const ctx = c.getContext("2d");
  if (!ctx) return [];
  ctx.clearRect(0, 0, bufW, bufH);
  drawFn(ctx, bufW, bufH);
  const data = ctx.getImageData(0, 0, bufW, bufH).data;
  const pts: Pt[] = [];
  for (let y = 0; y < bufH; y += step) {
    for (let x = 0; x < bufW; x += step) {
      const a = data[(y * bufW + x) * 4 + 3];
      if (a > 128) pts.push({ x, y });
    }
  }
  return pts;
}

function buildWordmark(w: number, h: number): Pt[] {
  return sampleDraw(
    (ctx, bw, bh) => {
      ctx.fillStyle = "#fff";
      const scale = Math.min(bw / 287, bh / 152);
      ctx.translate((bw - 287 * scale) / 2, (bh - 152 * scale) / 2);
      ctx.scale(scale, scale);
      ctx.translate(24, 27);
      for (const path of RIFT_WORDMARK_PATHS)
        ctx.fill(new Path2D(path), "evenodd");
    },
    Math.floor(w),
    Math.floor(h),
    3,
  );
}

function buildMark(size: number): Pt[] {
  return sampleDraw(
    (ctx, bw, bh) => {
      ctx.save();
      ctx.scale(bw / 124, bh / 124);
      ctx.translate(12, 12);
      ctx.fillStyle = "#fff";
      const symbol = new Path2D(RIFT_SYMBOL_PATH);
      ctx.fill(symbol);
      ctx.translate(100, 100);
      ctx.rotate(Math.PI);
      ctx.fill(symbol);
      ctx.restore();
    },
    Math.floor(size),
    Math.floor(size),
    2,
  );
}

function buildCloud(count: number, w: number, h: number): Pt[] {
  const pts: Pt[] = [];
  const rx = w * 0.44;
  const ry = h * 0.44;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random());
    pts.push({
      x: w / 2 + Math.cos(a) * rx * r,
      y: h / 2 + Math.sin(a) * ry * r,
    });
  }
  return pts;
}

function resample(src: Pt[], n: number): Pt[] {
  if (src.length === 0) return [];
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = src[i % src.length];
    const j = i >= src.length ? 6 : 0;
    out.push({
      x: p.x + (Math.random() - 0.5) * j,
      y: p.y + (Math.random() - 0.5) * j,
    });
  }
  return out;
}

export function RiftHeroCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;

    type P = {
      x: number;
      y: number;
      tx: number;
      ty: number;
      s: number;
      glow: number;
    };
    let particles: P[] = [];
    let forms: Pt[][] = [];
    let formIdx = 0;
    let count = 0;

    const pointer = { x: 0, y: 0, active: false };
    const PROBE_R = 130;

    const assignTargets = (idx: number) => {
      const f = forms[idx];
      if (!f) return;
      for (let i = 0; i < particles.length; i++) {
        const t = f[i] ?? f[i % f.length];
        particles[i].tx = t.x;
        particles[i].ty = t.y;
      }
    };

    const rebuild = () => {
      const rect = wrap.getBoundingClientRect();
      w = Math.max(320, rect.width);
      h = Math.max(320, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      count = Math.min(3200, Math.floor((w * h) / 720));

      const word = fitPoints(buildWordmark(380, 150), w, h, 0.66);
      const mark = fitPoints(buildMark(220), w, h, 0.5);
      const cloud = buildCloud(count, w, h);
      forms = FORMS.map((f) =>
        f === "cloud"
          ? resample(cloud, count)
          : f === "wordmark"
            ? resample(word, count)
            : resample(mark, count),
      );

      const start = forms[0];
      particles = new Array(count).fill(0).map((_, i) => {
        const t = start[i] ?? { x: w / 2, y: h / 2 };
        return {
          x: t.x + (Math.random() - 0.5) * 40,
          y: t.y + (Math.random() - 0.5) * 40,
          tx: t.x,
          ty: t.y,
          s: 0.7 + Math.random() * 1.1,
          glow: 0,
        };
      });
      assignTargets(0);
    };

    let raf = 0;
    let visible = true;
    let last = performance.now();
    let morphClock = 0;
    let morphT = 0;
    const MORPH_EVERY = 3600;

    const tick = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;

      morphClock += dt;
      morphT = Math.min(1, morphT + dt / 900);
      if (morphClock >= MORPH_EVERY) {
        morphClock = 0;
        morphT = 0;
        formIdx = (formIdx + 1) % forms.length;
        assignTargets(formIdx);
      }

      ctx.clearRect(0, 0, w, h);
      const ease = 0.085;
      const px = pointer.x;
      const py = pointer.y;
      const beams: P[] = [];

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += (p.tx - p.x) * ease;
        p.y += (p.ty - p.y) * ease;

        // cursor scan-probe: displace + energize nearby particles
        if (pointer.active) {
          const ox = p.x - px;
          const oy = p.y - py;
          const d2 = ox * ox + oy * oy;
          if (d2 < PROBE_R * PROBE_R) {
            const d = Math.sqrt(d2) || 1;
            const f = 1 - d / PROBE_R;
            p.x += (ox / d) * f * 16;
            p.y += (oy / d) * f * 16;
            p.glow = Math.max(p.glow, f);
            if (d < 60 && beams.length < 60) beams.push(p);
          }
        }
        p.glow *= 0.92;

        const dx = p.tx - p.x;
        const dy = p.ty - p.y;
        const speed = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 60);
        const alpha = Math.min(1, 0.16 + speed * 0.28 + p.glow * 0.45);
        ctx.fillStyle = `rgba(${SIGNAL}, ${alpha})`;
        const r = p.s * (1 + speed * 0.7 + p.glow * 1.4);
        ctx.fillRect(p.x, p.y, r, r);
      }

      // scan beams + reticle
      if (pointer.active) {
        ctx.lineWidth = 1;
        for (const b of beams) {
          ctx.strokeStyle = `rgba(${SIGNAL}, ${0.1 + b.glow * 0.2})`;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        drawReticle(now);
      }

      if (visible && !reduce) raf = requestAnimationFrame(tick);
    };

    const drawReticle = (now: number) => {
      const px = pointer.x;
      const py = pointer.y;
      const pulse = (Math.sin(now / 320) + 1) / 2;
      ctx.save();
      ctx.strokeStyle = `rgba(${SIGNAL}, 0.85)`;
      ctx.lineWidth = 1.25;
      // outer ring
      ctx.beginPath();
      ctx.arc(px, py, 24 + pulse * 3, 0, Math.PI * 2);
      ctx.stroke();
      // inner dashed ring
      ctx.strokeStyle = `rgba(${SIGNAL}, 0.4)`;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.arc(px, py, 13, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // crosshair ticks
      ctx.strokeStyle = `rgba(${SIGNAL}, 0.7)`;
      const t = 7;
      const g = 4;
      ctx.beginPath();
      ctx.moveTo(px - 24 - t, py);
      ctx.lineTo(px - g - 13, py);
      ctx.moveTo(px + g + 13, py);
      ctx.lineTo(px + 24 + t, py);
      ctx.moveTo(px, py - 24 - t);
      ctx.lineTo(px, py - g - 13);
      ctx.moveTo(px, py + g + 13);
      ctx.lineTo(px, py + 24 + t);
      ctx.stroke();
      // center dot
      ctx.fillStyle = `rgba(${SIGNAL}, 1)`;
      ctx.beginPath();
      ctx.arc(px, py, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const drawStatic = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        ctx.fillStyle = `rgba(${SIGNAL}, 0.55)`;
        ctx.fillRect(p.tx, p.ty, p.s, p.s);
      }
    };

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.active = true;
    };
    const onLeave = () => {
      pointer.active = false;
    };
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerleave", onLeave);

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        if (visible && !reduce) {
          last = performance.now();
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(tick);
        } else {
          cancelAnimationFrame(raf);
        }
      },
      { threshold: 0.05 },
    );

    let ro: ResizeObserver | null = null;
    const init = () => {
      rebuild();
      if (reduce) {
        formIdx = 2;
        assignTargets(2);
        for (const p of particles) {
          p.x = p.tx;
          p.y = p.ty;
        }
        drawStatic();
      } else {
        raf = requestAnimationFrame(tick);
      }
      io.observe(wrap);
      ro = new ResizeObserver(() => {
        rebuild();
        if (reduce) drawStatic();
      });
      ro.observe(wrap);
    };

    init();
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        rebuild();
        if (reduce) drawStatic();
      });
    }

    return () => {
      cancelAnimationFrame(raf);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerleave", onLeave);
      io.disconnect();
      ro?.disconnect();
    };
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 60% at 50% 40%, transparent 35%, var(--background) 88%)",
        }}
        aria-hidden
      />
    </div>
  );
}
