"use client";

import { RiftLogo } from "@/components/icons/rift-logo";

import { VENDORS } from "./x-mark-data";
import { X_CAPTION, X_LABEL } from "./x-system";

/**
 * The reasoning vendors, as a ring around one key — and now visibly *fed* into
 * it.
 *
 * A wrapped row of six logos is a supplier list; it says "we buy from these
 * people." The claim Build makes is the opposite and it is structural: every
 * one of them sits behind a single account, a single bill and a single run
 * history, so the model is a per-task choice, not a per-vendor subscription. A
 * ring says that in a glance — and a pulse of light running from each mark down
 * its spoke into the centre says the second half: they all resolve to one key.
 *
 * It rhymes with the hero on purpose: the page's two circular compositions are
 * the same idea at two scales.
 *
 * Cost and correctness: the motion is pure CSS. Each spoke's pulse is one
 * element on its own `offset-path` with a per-spoke `animation-delay`; the core
 * breathes on a second keyframe; the outer ring turns on `spin`. No JS timer
 * (which would run for the life of the page) and no state driving which spoke
 * is lit (which renders differently on the server than the browser — a
 * hydration mismatch this project has paid for twice). Reduced motion drops the
 * travelling pulses and holds a legible, lit resting state.
 */
/** See XConnectorField: unrounded floats in style/attribute values hydrate
 *  with a mismatch, because React shortens them on the server and not in the
 *  browser. */
const fixed = (n: number) => Number(n.toFixed(3));

export function XVendorOrbit() {
  const count = VENDORS.length;
  const R = 37;

  const point = (i: number) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    return { x: fixed(50 + Math.cos(angle) * R), y: fixed(50 + Math.sin(angle) * R) };
  };

  return (
    <div className="flex flex-col items-center">
      <p className={X_LABEL}>Reasoning and code</p>
      <p className={`${X_CAPTION} mt-3 max-w-[38ch] text-center`}>
        Frontier vendors behind one key, one bill and one run history.
        Switch mid-thread; the work stays where it is.
      </p>

      <div className="relative mt-12 aspect-square w-full max-w-[340px] sm:max-w-[440px]">
        {/* Two static rings + one slow-turning dashed ring, so the circle reads
            as an active path rather than a drawn border. */}
        <div className="absolute inset-[13%] rounded-full border border-[var(--x-line)]" />
        <div className="absolute inset-[4%] rounded-full border border-[var(--x-line)] opacity-40" />
        <div className="absolute inset-[9%] rounded-full border border-dashed border-[var(--x-line)] opacity-60 [animation:spin_64s_linear_infinite] motion-reduce:[animation:none]" />

        <svg
          aria-hidden
          viewBox="0 0 100 100"
          className="absolute inset-0 size-full overflow-visible"
        >
          {/* The wires — static, faint, so the pulses are the only motion. */}
          {VENDORS.map((vendor, i) => {
            const p = point(i);
            return (
              <line
                key={`w-${vendor.id}`}
                x1="50"
                y1="50"
                x2={p.x}
                y2={p.y}
                stroke="currentColor"
                strokeWidth="0.3"
                className="text-[var(--x-ink)] opacity-[0.16]"
              />
            );
          })}
          {/* The pulses — one per spoke, travelling the wire into the core. */}
          {VENDORS.map((vendor, i) => {
            const p = point(i);
            return (
              <circle
                key={`p-${vendor.id}`}
                r="1.05"
                cx="0"
                cy="0"
                fill="currentColor"
                className="text-white [filter:drop-shadow(0_0_1.6px_rgba(255,255,255,0.9))] motion-reduce:hidden"
                style={{
                  offsetPath: `path('M ${p.x} ${p.y} L 50 50')`,
                  animation: `x-influx 3s cubic-bezier(0.45,0,0.55,1) ${fixed((i / count) * 3)}s infinite`,
                }}
              />
            );
          })}
        </svg>

        {/* The core: a breathing glow, then what all six connect to. */}
        <div
          aria-hidden
          className="absolute left-1/2 top-1/2 size-[150px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(160,180,255,0.5),transparent_66%)] [animation:x-core_4.2s_ease-in-out_infinite]"
        />
        <div className="absolute left-1/2 top-1/2 flex size-[86px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--x-line)] bg-[var(--x-ground)]">
          <RiftLogo size={30} className="text-[var(--x-ink)]" />
        </div>

        {VENDORS.map((vendor, i) => {
          const p = point(i);
          return (
            <div
              key={vendor.id}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2.5"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            >
              <span
                className="flex size-[52px] sm:size-[70px] items-center justify-center rounded-full border border-[var(--x-line)] bg-[var(--x-raise)] text-[var(--x-ink)] [animation:x-orbit-mark_5.4s_ease-in-out_infinite] motion-reduce:[animation:none]"
                style={{ animationDelay: `${fixed((i / count) * 5.4)}s` }}
              >
                <vendor.Logo size={28} />
              </span>
              <span className="text-[10.5px] sm:text-[12px] leading-4 tracking-[-0.01em] text-[var(--x-ink-45)]">
                {vendor.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
