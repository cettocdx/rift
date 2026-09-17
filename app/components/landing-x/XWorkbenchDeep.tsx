import { Reveal } from "./reveal";
import {
  X_CAPTION,
  X_CONTAINER,
  X_INTRO,
  X_LABEL,
  X_SECTION,
} from "./x-system";

/**
 * What the Hack Workbench actually does, in gumloop's "detail band" shape.
 *
 * ── Why this section exists ──
 *
 * The Workbench had one section: a live pass against scanme.nmap.org and the
 * report it produced. That is the right *hero* for it and the wrong *whole* —
 * a reader watched one recon pass and had no idea the surface runs a hundred
 * tools across twelve named operations, gates every one to a declared scope,
 * and is the single thing on the page a competitor cannot assemble from an API
 * key. gumloop.com answers "what can it do" with a band of unequal cards, each
 * a different shape carrying a different kind of proof. This is that band.
 *
 * ── Every figure is read from the product ──
 *
 * The twelve operations are `OPERATIONS` in lib/operations/operations.ts — the
 * same list the Workbench renders in its rail, with the same labels and the
 * same one-line descriptions. The toolchain groups are the section headings of
 * `PREINSTALLED_PENTESTING_TOOLS` in lib/system-prompt.ts, the string the
 * sandbox is actually told it has, and the count is of the tools named in it.
 * Nothing here is written for the page; if a tool is added to the sandbox it
 * appears here, and if one is removed it stops appearing, because both are
 * derived at module load. The one number that is prose — "Included with Max" —
 * is the gate in lib/auth/premium-access.ts, whose own comment calls the
 * Workbench "the flagship capability of RIFT Max".
 */

/* ── The twelve operations, from the product's own rail ────────────────── */

// Imported rather than re-typed, so the section can never list an operation
// the product does not have. Kept to label + desc — the fields, the prompt
// builders and the icons are the running surface's job, not this summary's.
import { OPERATIONS } from "@/lib/operations/operations";
// The toolchain string the sandbox is initialised with. Parsed here into its
// group headings and a total, so "a hundred tools" is a count rather than a
// claim.
import { TOOLCHAIN } from "@/lib/workbench/toolchain";

const OPS = OPERATIONS.map((op) => ({
  label: op.label,
  desc: op.desc,
}));



export function XWorkbenchDeep() {
  return (
    <section className="border-t-[0.5px] border-t-[var(--x-line)] py-14 md:py-16 min-[1280px]:py-20">
      <div className={X_CONTAINER}>
        <Reveal>
          <p className={X_LABEL}>Inside the Workbench</p>
          <h2
            className={`${X_SECTION} mt-5 max-w-[20ch] text-balance text-[var(--x-ink)]`}
          >
            The whole toolchain, scoped and evidenced
          </h2>
          <p className={`${X_INTRO} mt-5 max-w-[560px]`}>
            {TOOLCHAIN.total} preinstalled tools across{" "}
            {TOOLCHAIN.groups.length} categories, {OPS.length} one-click
            operations, and a container torn down after every run. It is the one
            thing on this page an API key cannot assemble. Included with Max.
          </p>
        </Reveal>

        {/*
         * The band. Two unequal columns, each a different kind of proof —
         * gumloop's own arrangement. The operations are the *what*, the
         * toolchain is the *how much*, and neither is a repeat of the other.
         */}
        <div className="mt-12 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          {/* Operations — the rail, as a two-up list of ruled rows. */}
          <Reveal>
            <div className="flex h-full flex-col rounded-[20px] bg-[var(--x-raise)] p-6 md:p-8">
              <p className={X_LABEL}>One-click operations</p>
              <p className={`${X_CAPTION} mt-2`}>
                Each drops a scoped, authorised prompt into the run — the same
                twelve the Workbench rail carries.
              </p>
              <ul className="mt-6 grid gap-x-8 sm:grid-cols-2">
                {OPS.map((op, i) => (
                  <li
                    key={op.label}
                    className={`py-3 ${
                      // Drop the rule under the last row of each column so the
                      // list does not close itself off.
                      i < OPS.length - 2
                        ? "border-b-[0.5px] border-b-[var(--x-line)]"
                        : ""
                    }`}
                  >
                    <p className="text-[14px] font-medium tracking-[-0.025em] text-[var(--x-ink)]">
                      {op.label}
                    </p>
                    <p className={`${X_CAPTION} mt-0.5`}>{op.desc}</p>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          {/* Toolchain — the categories as a two-column count grid, in the
              product's own security register.

              Two columns, not one: twenty-seven rows stacked single-file made
              this panel twice the height of the operations card beside it and
              turned a glance-able count into a scroll. Balanced, it reads as
              what it is — a lot of tools, grouped. */}
          <Reveal step={1}>
            <div className="flex h-full flex-col overflow-hidden rounded-[20px] bg-[#0a0a0a] p-6 md:p-8">
              <p className="font-mono text-[12px] uppercase tracking-[0.06em] text-white/45">
                Preinstalled · {TOOLCHAIN.total} tools
              </p>
              <ul className="mt-6 grid flex-1 grid-cols-1 gap-x-8 sm:grid-cols-2">
                {TOOLCHAIN.groups.map((group) => (
                  <li
                    key={group.name}
                    className="flex items-baseline justify-between gap-3 border-b border-b-white/[0.06] py-2"
                  >
                    <span className="min-w-0 truncate font-mono text-[11.5px] text-white/70">
                      {group.name}
                    </span>
                    <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-[var(--x-live)]">
                      {group.count}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 font-mono text-[11px] leading-[1.6] text-white/35">
                Scoped to a target you declared and are authorised to test.
                Evidence kept with the run · container isolation per session.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
