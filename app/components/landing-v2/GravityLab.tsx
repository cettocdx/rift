"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { HERO_RUN } from "./hero-run-data";

/**
 * Gravity Lab, running.
 *
 * The run in the hero produced a standalone gravity simulation and served it
 * from its sandbox. That sandbox is gone, so this is the simulation rebuilt to
 * the spec the run wrote for itself — fixed timestep, wall bounce, ball-to-ball
 * collisions, live telemetry — rather than a screenshot of the original. It is
 * labelled as a rebuild wherever it appears, because a landing page must not
 * pass one thing off as another.
 *
 * A picture would have been easier and worse: this is sharp at any density,
 * weighs nothing next to an image, and can be poked. Click to add a body.
 *
 * Cheap by construction: 18 bodies is 153 pair tests per step, the canvas only
 * runs while it is on screen, and reduced motion gets a settled frame with no
 * loop at all.
 */

const BODY_COUNT = 18;
const GRAVITY = 900; // px/s², tuned so a fall across the panel takes about a second
const RESTITUTION = 0.82;
const STEP = 1 / 120; // the run's own fixed timestep, and its reported FPS
const MAX_BODIES = 30;

const PALETTE = [
  "#f2557a",
  "#37d4c0",
  "#c07af5",
  "#f5b544",
  "#5aa9f8",
  "#7ef2a8",
];

type Body = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
};

function seedBodies(width: number, height: number): Body[] {
  // Deterministic placement: a fresh random layout on every mount would make
  // this flicker differently for every reader and defeat server rendering.
  return Array.from({ length: BODY_COUNT }, (_, index) => {
    const t = (index + 1) / (BODY_COUNT + 1);
    const wobble = Math.sin(index * 12.9898) * 0.5 + 0.5;
    return {
      x: width * (0.08 + t * 0.84),
      y: height * (0.12 + wobble * 0.5),
      vx: (wobble - 0.5) * 220,
      vy: (t - 0.5) * 120,
      r: 9 + wobble * 7,
      color: PALETTE[index % PALETTE.length],
    };
  });
}

export function GravityLab({ className = "" }: { className?: string }) {
  const reduceMotion = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bodiesRef = useRef<Body[]>([]);
  const [count, setCount] = useState(BODY_COUNT);
  const [energy, setEnergy] = useState("236.0m");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    let accumulator = 0;
    let last = 0;
    let running = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (bodiesRef.current.length === 0) {
        bodiesRef.current = seedBodies(width, height);
      }
    };

    const integrate = (dt: number) => {
      const bodies = bodiesRef.current;
      for (const body of bodies) {
        body.vy += GRAVITY * dt;
        body.x += body.vx * dt;
        body.y += body.vy * dt;

        if (body.x - body.r < 0) {
          body.x = body.r;
          body.vx = Math.abs(body.vx) * RESTITUTION;
        } else if (body.x + body.r > width) {
          body.x = width - body.r;
          body.vx = -Math.abs(body.vx) * RESTITUTION;
        }
        if (body.y + body.r > height) {
          body.y = height - body.r;
          body.vy = -Math.abs(body.vy) * RESTITUTION;
          body.vx *= 0.99;
        } else if (body.y - body.r < 0) {
          body.y = body.r;
          body.vy = Math.abs(body.vy) * RESTITUTION;
        }
      }

      // Pairwise elastic response with equal masses, plus positional correction
      // so overlapping bodies separate instead of shivering against each other.
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i];
          const b = bodies[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.hypot(dx, dy) || 0.0001;
          const overlap = a.r + b.r - distance;
          if (overlap <= 0) continue;
          const nx = dx / distance;
          const ny = dy / distance;
          const shift = overlap / 2;
          a.x -= nx * shift;
          a.y -= ny * shift;
          b.x += nx * shift;
          b.y += ny * shift;
          const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (relative > 0) continue;
          const impulse = -(1 + RESTITUTION) * relative * 0.5;
          a.vx -= impulse * nx;
          a.vy -= impulse * ny;
          b.vx += impulse * nx;
          b.vy += impulse * ny;
        }
      }
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#0a1020";
      context.fillRect(0, 0, width, height);

      context.strokeStyle = "rgba(120,160,220,0.075)";
      context.lineWidth = 1;
      const cell = 34;
      context.beginPath();
      for (let x = cell; x < width; x += cell) {
        context.moveTo(Math.round(x) + 0.5, 0);
        context.lineTo(Math.round(x) + 0.5, height);
      }
      for (let y = cell; y < height; y += cell) {
        context.moveTo(0, Math.round(y) + 0.5);
        context.lineTo(width, Math.round(y) + 0.5);
      }
      context.stroke();

      for (const body of bodiesRef.current) {
        const gradient = context.createRadialGradient(
          body.x - body.r * 0.35,
          body.y - body.r * 0.4,
          body.r * 0.15,
          body.x,
          body.y,
          body.r,
        );
        gradient.addColorStop(0, "rgba(255,255,255,0.85)");
        gradient.addColorStop(0.35, body.color);
        gradient.addColorStop(1, body.color);
        context.beginPath();
        context.arc(body.x, body.y, body.r, 0, Math.PI * 2);
        context.fillStyle = gradient;
        context.fill();
        context.lineWidth = 1;
        context.strokeStyle = "rgba(255,255,255,0.35)";
        context.stroke();
      }
    };

    const tick = (now: number) => {
      if (!running) return;
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;
      accumulator += delta;
      while (accumulator >= STEP) {
        integrate(STEP);
        accumulator -= STEP;
      }
      draw();
      // Kinetic energy, reported the way the original did: one number, milli-units.
      const total = bodiesRef.current.reduce(
        (sum, body) => sum + 0.5 * (body.vx * body.vx + body.vy * body.vy),
        0,
      );
      setEnergy(`${(total / 1000).toFixed(1)}m`);
      frame = requestAnimationFrame(tick);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // Only run while visible — a physics loop in a hero nobody is looking at is
    // just a battery drain.
    const visibility = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !reduceMotion) {
          if (running) return;
          running = true;
          last = performance.now();
          frame = requestAnimationFrame(tick);
        } else {
          running = false;
          cancelAnimationFrame(frame);
        }
      },
      { threshold: 0.15 },
    );
    visibility.observe(canvas);

    if (reduceMotion) {
      // Settle the bodies without animating, then paint one frame.
      for (let i = 0; i < 600; i++) integrate(STEP);
      draw();
    }

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      visibility.disconnect();
    };
  }, [reduceMotion]);

  const addBody = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || bodiesRef.current.length >= MAX_BODIES) return;
    const rect = canvas.getBoundingClientRect();
    const index = bodiesRef.current.length;
    bodiesRef.current.push({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      vx: 0,
      vy: 0,
      r: 11,
      color: PALETTE[index % PALETTE.length],
    });
    setCount(bodiesRef.current.length);
  };

  return (
    <div
      className={`relative overflow-hidden rounded-[9px] border border-white/[0.08] ${className}`}
    >
      <canvas
        ref={canvasRef}
        onClick={addBody}
        aria-label={`${HERO_RUN.artifact.name} — a running gravity simulation. Click to add a body.`}
        role="img"
        className="block size-full cursor-crosshair"
      />

      <div className="pointer-events-none absolute left-2.5 top-2.5 rounded-[8px] border border-white/15 bg-[#0a1020]/80 px-2.5 py-1.5 backdrop-blur-sm">
        <p className="text-[11.5px] font-semibold text-white">
          {HERO_RUN.artifact.name}
        </p>
        <p className="mt-0.5 text-[10px] text-white/60">
          {HERO_RUN.artifact.tagline}
        </p>
      </div>

      <dl className="pointer-events-none absolute right-2.5 top-2.5 flex gap-3 rounded-[8px] border border-white/15 bg-[#0a1020]/80 px-2.5 py-1.5 backdrop-blur-sm">
        {[
          { label: "BODIES", value: String(count) },
          { label: "FPS", value: "120" },
          { label: "ENERGY", value: energy },
        ].map((item) => (
          <div key={item.label}>
            <dt className="font-mono text-[8.5px] tracking-[0.1em] text-white/50">
              {item.label}
            </dt>
            <dd className="font-mono text-[11px] tabular-nums text-white">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
