"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

import { logoNeedsPlate } from "@/app/components/mcp-logo-tone";
import { RiftLogo } from "@/components/icons/rift-logo";

import { CONNECTORS } from "./x-mark-data";

/**
 * The connector globe — a real, draggable sphere.
 *
 * The first version was a 2D SVG projection spun by a CSS `rotate`: it read as
 * a globe from across the room and fell apart the moment anyone tried to grab
 * it, because there was nothing to grab. This is the thing itself — every dot
 * and connector has a real position on a unit sphere, a yaw/pitch pair rotates
 * them each frame and projects them, and a pointer drives the rotation. On
 * release the sphere keeps the throw and coasts to rest. gumloop's globe does
 * exactly this.
 *
 * The interaction follows the apple-design guidance: pointer capture and 1:1
 * tracking (direct manipulation), a release velocity from the last two moves
 * (velocity handoff), per-frame friction handing back to an idle drift
 * (momentum), and a loop that reads the live rotation every frame so a grab
 * mid-coast never jumps (interruptibility). Reduced motion drops the idle
 * drift and the coast but keeps the drag.
 *
 * The dots and orbit threads are a `<canvas>` — cheap for a few hundred points
 * where live SVG nodes would thrash the DOM. The pucks stay HTML (logo images)
 * and are positioned by writing to their refs each frame, never React state,
 * so a turning sphere is zero re-renders. The loop runs only while visible.
 */

const DPR_CAP = 2;
const DOT_COUNT = 220;
const ORBIT_COUNT = 6;
const IDLE_YAW = 0.0016;
const FRICTION = 0.94;
const VELOCITY_FLOOR = 0.0016;
const DRAG_SENSITIVITY = 0.008;

type Vec3 = { x: number; y: number; z: number };

function fibSphere(n: number, i: number): Vec3 {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (i / Math.max(1, n - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = i * golden;
  return { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
}

const DOTS = Array.from({ length: DOT_COUNT }, (_, i) => fibSphere(DOT_COUNT, i));

/** Every connector, no cap — a real position on the sphere. */
const NODES = CONNECTORS.map((entry, i) => ({
  entry,
  base: fibSphere(CONNECTORS.length, i),
}));

function rot(v: Vec3, yaw: number, pitch: number): Vec3 {
  const cyw = Math.cos(yaw);
  const syw = Math.sin(yaw);
  const x1 = v.x * cyw + v.z * syw;
  const z1 = -v.x * syw + v.z * cyw;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return { x: x1, y: v.y * cp - z1 * sp, z: v.y * sp + z1 * cp };
}

export function XKnowledgeGlobe({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const puckRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let yaw = -0.4;
    let pitch = 0.32;
    let vYaw = reduced ? 0 : IDLE_YAW;
    let vPitch = 0;
    let dragging = false;
    let idle = !reduced;

    let last: { x: number; y: number; t: number } | null = null;
    let prev: { x: number; y: number; t: number } | null = null;

    let size = 0;
    let cx = 0;
    let cy = 0;
    let radius = 0;
    let dpr = 1;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      size = Math.min(rect.width, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      cx = size / 2;
      cy = size / 2;
      radius = size * 0.42;
    };
    resize();

    const ink =
      getComputedStyle(host).getPropertyValue("--x-ink").trim() || "#000";

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      ctx.lineWidth = 1;
      for (let o = 0; o < ORBIT_COUNT; o++) {
        const tilt = (o / ORBIT_COUNT) * Math.PI - Math.PI / 2;
        ctx.beginPath();
        for (let s = 0; s <= 64; s++) {
          const a = (s / 64) * Math.PI * 2;
          const p = rot(
            {
              x: Math.cos(a),
              y: Math.sin(a) * Math.sin(tilt),
              z: Math.sin(a) * Math.cos(tilt),
            },
            yaw,
            pitch,
          );
          const sx = cx + p.x * radius;
          const sy = cy - p.y * radius;
          if (s === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.05;
        ctx.stroke();
      }

      for (const d of DOTS) {
        const p = rot(d, yaw, pitch);
        const depth = (p.z + 1) / 2;
        ctx.beginPath();
        ctx.arc(
          cx + p.x * radius,
          cy - p.y * radius,
          0.6 + depth * 1.5,
          0,
          Math.PI * 2,
        );
        ctx.fillStyle = ink;
        ctx.globalAlpha = 0.08 + depth * 0.5;
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      for (let i = 0; i < NODES.length; i++) {
        const el = puckRefs.current[i];
        if (!el) continue;
        const p = rot(NODES[i].base, yaw, pitch);
        const depth = (p.z + 1) / 2;
        const scale = 0.72 + depth * 0.28;
        el.style.transform = `translate(-50%,-50%) translate(${cx + p.x * radius}px, ${cy - p.y * radius}px) scale(${scale})`;
        el.style.opacity = String(0.25 + depth * 0.75);
        el.style.zIndex = String(Math.round(depth * 100));
        el.style.pointerEvents = depth > 0.5 ? "auto" : "none";
      }
    };

    let raf = 0;
    let visible = true;

    const tick = () => {
      if (!dragging) {
        if (idle) {
          yaw += IDLE_YAW;
        } else {
          yaw += vYaw;
          pitch += vPitch;
          vYaw *= FRICTION;
          vPitch *= FRICTION;
          if (
            Math.abs(vYaw) < VELOCITY_FLOOR &&
            Math.abs(vPitch) < VELOCITY_FLOOR
          ) {
            if (reduced) {
              draw();
              raf = 0;
              return;
            }
            idle = true;
          }
        }
      }
      pitch = Math.max(-1.2, Math.min(1.2, pitch));
      draw();
      raf = visible ? requestAnimationFrame(tick) : 0;
    };
    const startLoop = () => {
      if (!raf && visible) raf = requestAnimationFrame(tick);
    };

    const onDown = (e: PointerEvent) => {
      dragging = true;
      idle = false;
      vYaw = 0;
      vPitch = 0;
      last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      prev = last;
      host.setPointerCapture(e.pointerId);
      startLoop();
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging || !last) return;
      yaw += (e.clientX - last.x) * DRAG_SENSITIVITY;
      pitch += (e.clientY - last.y) * DRAG_SENSITIVITY;
      prev = last;
      last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (last && prev && last.t > prev.t) {
        const dt = last.t - prev.t;
        vYaw = (((last.x - prev.x) * DRAG_SENSITIVITY) / dt) * 16;
        vPitch = (((last.y - prev.y) * DRAG_SENSITIVITY) / dt) * 16;
      }
      try {
        host.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      startLoop();
    };

    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onUp);

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            resize();
            draw();
          })
        : null;
    ro?.observe(host);

    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            ([entry]) => {
              visible = entry.isIntersecting;
              if (visible) startLoop();
            },
            { threshold: 0.05 },
          )
        : null;
    if (io) io.observe(host);

    draw();
    startLoop();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      ro?.disconnect();
      io?.disconnect();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={`relative isolate mx-auto aspect-square w-full max-w-[420px] cursor-grab touch-none select-none active:cursor-grabbing ${className ?? ""}`}
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden />

      <div className="pointer-events-none absolute left-1/2 top-1/2 z-[60] flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--x-ink)] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.4)]">
        <RiftLogo size={20} className="text-[var(--x-ground)]" />
      </div>

      {NODES.map(({ entry }, i) => {
        const plated = logoNeedsPlate(entry.logoPath);
        return (
          <span
            key={entry.id}
            ref={(el) => {
              puckRefs.current[i] = el;
            }}
            title={entry.name}
            className="absolute left-0 top-0 flex size-9 items-center justify-center rounded-[10px] border-[0.5px] border-[var(--x-line)] bg-[var(--x-ground)] shadow-[0_6px_16px_-8px_rgba(0,0,0,0.35)] will-change-transform"
            style={{ transform: "translate(-50%,-50%)" }}
          >
            <Image
              src={entry.logoPath}
              alt={entry.name}
              width={20}
              height={20}
              className={`size-[20px] rounded-[5px] object-contain ${plated ? "bg-white p-[2px]" : ""}`}
            />
          </span>
        );
      })}
    </div>
  );
}
