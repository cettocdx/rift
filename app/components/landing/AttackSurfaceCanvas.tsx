"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Live "attack surface" radar for the RIFT landing page.
 * A polar grid maps a target domain (center) to its discovered hosts.
 * A sweep line rotates; as it crosses each host the node pings and a line
 * is appended to the live event ledger. Pauses offscreen, respects
 * prefers-reduced-motion (renders a settled static frame + full ledger).
 */

type Tone = "ok" | "warn" | "crit";

type Node = {
  label: string;
  code: string;
  tag: string;
  tone: Tone;
  angle: number;
  radius: number;
  ping: number;
};

const TONE_RGB: Record<Tone, string> = {
  ok: "70, 209, 138",
  warn: "227, 183, 92",
  crit: "240, 114, 110",
};

const RAW: Omit<Node, "ping">[] = [
  {
    label: "www.acme.com",
    code: "200",
    tag: "nginx · React",
    tone: "ok",
    angle: -1.15,
    radius: 0.62,
  },
  {
    label: "api.acme.com",
    code: "200",
    tag: "Express",
    tone: "ok",
    angle: -0.2,
    radius: 0.84,
  },
  {
    label: "staging.acme.com",
    code: "401",
    tag: "restricted",
    tone: "warn",
    angle: 0.7,
    radius: 0.5,
  },
  {
    label: "vpn.acme.com",
    code: "CVE",
    tag: "OpenVPN 2.4.6",
    tone: "crit",
    angle: 1.6,
    radius: 0.9,
  },
  {
    label: "mail.acme.com",
    code: "200",
    tag: "postfix",
    tone: "ok",
    angle: 2.5,
    radius: 0.55,
  },
  {
    label: "dev.acme.com",
    code: "403",
    tag: "forbidden",
    tone: "warn",
    angle: 3.2,
    radius: 0.78,
  },
  {
    label: "cdn.acme.com",
    code: "200",
    tag: "cloudflare",
    tone: "ok",
    angle: 4.0,
    radius: 0.46,
  },
  {
    label: "git.acme.com",
    code: "200",
    tag: "gitlab",
    tone: "ok",
    angle: 4.9,
    radius: 0.72,
  },
];

function ledgerLine(n: Node) {
  if (n.tone === "crit")
    return {
      code: "CVE",
      label: n.label,
      tag: `${n.tag} · critical`,
      tone: n.tone,
    };
  return { code: n.code, label: n.label, tag: n.tag, tone: n.tone };
}

type Line = {
  id: number;
  code: string;
  label: string;
  tag: string;
  tone: Tone;
};

export function AttackSurfaceCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    label: string;
    code: string;
    tag: string;
    tone: Tone;
  } | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const nodes: Node[] = RAW.map((n) => ({ ...n, ping: -9999 }));
    let dpr = 1;
    let w = 0;
    let h = 0;
    let cx = 0;
    let cy = 0;
    let maxR = 0;

    const SIGNAL = "242, 106, 32";
    const BORDER = "120, 126, 138";

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      w = Math.max(280, rect.width);
      h = Math.max(280, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = w / 2;
      cy = h / 2;
      maxR = Math.min(w, h) * 0.42;
    };

    const pushLine = (n: Node) => {
      const l = ledgerLine(n);
      idRef.current += 1;
      const id = idRef.current;
      setLines((prev) => [...prev, { id, ...l }].slice(-6));
    };

    let sweep = -Math.PI / 2;
    let prevSweep = sweep;
    let hoverLabel: string | null = null;
    const cooldown = new Map<string, number>();

    const nodePos = (n: Node) => ({
      x: cx + Math.cos(n.angle) * n.radius * maxR,
      y: cy + Math.sin(n.angle) * n.radius * maxR,
    });

    const draw = (now: number) => {
      ctx.clearRect(0, 0, w, h);

      ctx.lineWidth = 1;
      for (let i = 1; i <= 4; i++) {
        ctx.strokeStyle = `rgba(${BORDER}, 0.08)`;
        ctx.beginPath();
        ctx.arc(cx, cy, (maxR * i) / 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.strokeStyle = `rgba(${BORDER}, 0.05)`;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR);
        ctx.stroke();
      }

      for (const n of nodes) {
        const p = nodePos(n);
        ctx.strokeStyle = `rgba(${BORDER}, 0.1)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }

      if (!reduce) {
        const grad = ctx.createLinearGradient(
          cx,
          cy,
          cx + Math.cos(sweep) * maxR,
          cy + Math.sin(sweep) * maxR,
        );
        grad.addColorStop(0, `rgba(${SIGNAL}, 0.0)`);
        grad.addColorStop(1, `rgba(${SIGNAL}, 0.5)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(sweep) * maxR, cy + Math.sin(sweep) * maxR);
        ctx.stroke();
        ctx.fillStyle = `rgba(${SIGNAL}, 0.05)`;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, maxR, sweep - 0.5, sweep);
        ctx.closePath();
        ctx.fill();
      }

      for (const n of nodes) {
        const p = nodePos(n);
        const rgb = TONE_RGB[n.tone];
        const since = now - n.ping;
        const pinged = since < 1100;
        const pulse = pinged ? 1 - since / 1100 : 0;
        const isHover = n.label === hoverLabel;

        if (pulse > 0) {
          ctx.strokeStyle = `rgba(${rgb}, ${pulse * 0.8})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6 + (1 - pulse) * 22, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (isHover) {
          ctx.strokeStyle = `rgba(${rgb}, 0.9)`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([2, 4]);
          ctx.strokeStyle = `rgba(${rgb}, 0.45)`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 17, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        const base = reduce ? 0.9 : 0.45 + pulse * 0.55 + (isHover ? 0.4 : 0);
        ctx.fillStyle = `rgba(${rgb}, ${Math.min(1, base)})`;
        ctx.beginPath();
        ctx.arc(
          p.x,
          p.y,
          (n.tone === "crit" ? 4 : 3) + (isHover ? 1.5 : 0),
          0,
          Math.PI * 2,
        );
        ctx.fill();

        if (w > 460) {
          ctx.font = "10px ui-monospace, 'JetBrains Mono', monospace";
          ctx.fillStyle = `rgba(180, 186, 196, ${isHover ? 1 : 0.5 + pulse * 0.4})`;
          ctx.textAlign = p.x < cx ? "end" : "start";
          ctx.textBaseline = "middle";
          const off = p.x < cx ? -8 : 8;
          ctx.fillText(n.label, p.x + off, p.y);
        }
      }

      ctx.fillStyle = `rgba(${SIGNAL}, 0.18)`;
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${SIGNAL}, 1)`;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
      if (w > 460) {
        ctx.font = "600 11px ui-monospace, 'JetBrains Mono', monospace";
        ctx.fillStyle = "rgba(236, 238, 241, 0.9)";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText("acme.com", cx, cy + 18);
      }
    };

    let raf = 0;
    let visible = true;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      prevSweep = sweep;
      sweep += dt * 0.0011;
      if (sweep > Math.PI) sweep -= Math.PI * 2;

      for (const n of nodes) {
        const a = Math.atan2(Math.sin(n.angle), Math.cos(n.angle));
        const crossed =
          (prevSweep <= a && sweep >= a) ||
          (prevSweep > sweep && (a >= prevSweep || a <= sweep));
        const cd = cooldown.get(n.label) ?? 0;
        if (crossed && now - cd > 2000) {
          n.ping = now;
          cooldown.set(n.label, now);
          pushLine(n);
        }
      }

      draw(now);
      if (visible && !reduce) raf = requestAnimationFrame(tick);
    };

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

    resize();
    if (reduce) {
      setLines(
        nodes
          .map((n) => {
            idRef.current += 1;
            return { id: idRef.current, ...ledgerLine(n) };
          })
          .slice(-6),
      );
      draw(performance.now());
    } else {
      raf = requestAnimationFrame(tick);
    }
    io.observe(wrap);
    const ro = new ResizeObserver(() => {
      resize();
      if (reduce) draw(performance.now());
    });
    ro.observe(wrap);

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      let best: Node | null = null;
      let bestD = 24;
      for (const n of nodes) {
        const p = nodePos(n);
        const d = Math.hypot(p.x - mx, p.y - my);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      hoverLabel = best?.label ?? null;
      if (best) {
        const p = nodePos(best);
        setHover({
          x: p.x,
          y: p.y,
          label: best.label,
          code: best.code,
          tag: best.tag,
          tone: best.tone,
        });
        canvas.style.cursor = "pointer";
      } else {
        setHover(null);
        canvas.style.cursor = "default";
      }
      if (reduce) draw(performance.now());
    };
    const onLeave = () => {
      hoverLabel = null;
      setHover(null);
      canvas.style.cursor = "default";
      if (reduce) draw(performance.now());
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border/60 sm:grid-cols-[1.15fr_1fr]">
      <div ref={wrapRef} className="relative min-h-[300px] bg-surface-2">
        <canvas
          ref={canvasRef}
          className="h-full w-full"
          aria-label="Live attack-surface radar mapping a target domain to discovered hosts"
        />
        {hover ? (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover px-2.5 py-1.5 shadow-md"
            style={{ left: hover.x, top: hover.y - 14 }}
          >
            <div className="flex items-center gap-2 text-[11px]">
              <span
                className={
                  hover.tone === "ok"
                    ? "text-success"
                    : hover.tone === "warn"
                      ? "text-warning"
                      : "text-destructive"
                }
              >
                {hover.code}
              </span>
              <span className="font-medium text-foreground">{hover.label}</span>
            </div>
            <div className="text-[10px] text-muted-foreground">{hover.tag}</div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col bg-surface-2 p-4">
        <div className="mb-3 text-[12px] font-medium text-muted-foreground">
          Live findings
        </div>
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 text-[12px] leading-relaxed">
          {lines.length === 0 ? (
            <span className="text-muted-foreground/50">Scanning…</span>
          ) : (
            lines.map((l) => (
              <div
                key={l.id}
                className="flex items-center gap-2 animate-view-enter"
              >
                <span
                  className={
                    l.tone === "ok"
                      ? "text-success"
                      : l.tone === "warn"
                        ? "text-warning"
                        : "text-destructive"
                  }
                >
                  {l.code}
                </span>
                <span className="font-medium text-foreground">{l.label}</span>
                <span className="truncate text-muted-foreground">{l.tag}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
