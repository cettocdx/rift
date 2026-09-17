import { LiveWorkbench } from "@/app/components/landing-v2/LiveWorkbench";
import { RiftMiniApp } from "@/app/components/landing-v2/RiftMiniApp";
import { XMesh } from "@/app/components/landing-x/XMesh";
import { RENDERERS, VENDORS } from "@/app/components/landing-x/x-mark-data";

import { HReveal } from "./HReveal";
import { HStudioShots } from "./HStudioShots";
import { H_CONTAINER, H_HEADING, H_LABEL } from "./h-system";

type Mark = {
  id: string;
  name: string;
  Logo?: React.ComponentType<{ size?: number; className?: string }>;
};

/** The models/tools that belong to one section, laid inside its card. */
function MarkRow({ marks, more }: { marks: Mark[]; more?: number }) {
  return (
    <ul className="mt-auto flex flex-wrap items-center gap-x-3.5 gap-y-2 pt-1">
      {marks.map((m) => (
        <li
          key={m.id}
          className="flex items-center gap-1.5 text-[var(--h-ink)]"
        >
          {m.Logo ? <m.Logo size={15} className="text-[var(--h-ink)]" /> : null}
          <span className="text-[12px] tracking-[-0.01em]">{m.name}</span>
        </li>
      ))}
      {more ? (
        <li className="font-[family-name:var(--h-mono)] text-[11px] text-[var(--h-ink-45)]">
          +{more}
        </li>
      ) : null}
    </ul>
  );
}

/** A colourful gradient card (x.ai news-tile look, no orange): gradient art on
 *  top, the section's pitch and its own marks on the light card below. */
function Card({
  palette,
  seed,
  index,
  name,
  title,
  body,
  marks,
  more,
}: {
  palette: "violet" | "ice" | "forest";
  seed: number;
  index: number;
  name: string;
  title: string;
  body: string;
  marks: Mark[];
  more?: number;
}) {
  return (
    <HReveal delayMs={index * 90} className="h-full">
      <div className="group flex h-full flex-col overflow-hidden rounded-[14px] border border-[var(--h-line)] bg-[var(--h-panel)] transition-shadow duration-500 hover:shadow-[0_28px_70px_-46px_rgba(28,27,27,0.55)]">
        <div className="relative aspect-[16/10] overflow-hidden">
          <div className="absolute inset-0 transition-transform duration-[1400ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.05]">
            <XMesh palette={palette} seed={seed} />
          </div>
          <span className="absolute left-4 top-3.5 font-[family-name:var(--h-mono)] text-[11px] uppercase tracking-[0.14em] text-white/85">
            0{index + 1} · {name}
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-2.5 p-5">
          <h3 className="text-[16.5px] font-medium leading-[1.22] tracking-[-0.01em] text-[var(--h-ink)]">
            {title}
          </h3>
          <p className="text-[13px] leading-[1.5] text-[var(--h-ink-70)]">
            {body}
          </p>
          <MarkRow marks={marks} more={more} />
        </div>
      </div>
    </HReveal>
  );
}

/** An OLED-black app frame — the product shown as it really renders. */
function Screen({
  label,
  note = "the real app",
  live = true,
  children,
}: {
  label: string;
  note?: string;
  live?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-[var(--h-line)] bg-[var(--h-panel)] shadow-[0_40px_100px_-55px_rgba(28,27,27,0.6)]">
      <div className="flex items-center justify-between border-b border-[var(--h-line)] bg-[var(--h-deep)] px-4 py-2.5 font-[family-name:var(--h-mono)] text-[10.5px] uppercase tracking-[0.1em]">
        <span className="text-[var(--h-ink)]">
          {label}
          {live ? " · live" : ""}
        </span>
        <span className="text-[var(--h-ink-45)]">{note}</span>
      </div>
      <div className="bg-black p-1.5">
        <div className="overflow-hidden rounded-[5px] border border-white/5">
          {children}
        </div>
      </div>
    </div>
  );
}

const RENDERER_MARKS: Mark[] = RENDERERS.slice(0, 5).map((m) => ({
  id: m.id,
  name: m.name,
  Logo: m.Logo ?? undefined,
}));

const HACK_MARKS: Mark[] = [
  { id: "nmap", name: "nmap" },
  { id: "ports", name: "ports" },
  { id: "tls", name: "tls cert" },
  { id: "cve", name: "findings" },
];

/**
 * The three systems. First the pitch as three colourful gradient cards side by
 * side — each carrying its own models. Then the product itself, spread across a
 * bento rather than stacked full-width: the Build loop running live beside a
 * grid of real Studio output, and the Workbench given the widest single stage.
 */
export function HProducts() {
  return (
    <div className="bg-[var(--h-panel)]">
      <section className="border-t border-[var(--h-line)] py-20 lg:py-28">
        <div className={H_CONTAINER}>
          <HReveal>
            <p className={H_LABEL}>The workstation</p>
            <h2 className={`${H_HEADING} mt-4 max-w-[20ch]`}>
              Three tools. One machine.
            </h2>
          </HReveal>

          {/* Side-by-side gradient cards */}
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card
              palette="violet"
              seed={12}
              index={0}
              name="Build"
              title="The loop, end to end."
              body="Reads the code, makes the change, runs what it wrote — and won't call it done until the tests pass and the preview is built."
              marks={VENDORS}
            />
            <Card
              palette="ice"
              seed={41}
              index={1}
              name="Studio"
              title="Every renderer, one prompt box."
              body="Images and video in the same thread as the code that needed them. Pick the model for the shot; one run history, one bill."
              marks={RENDERER_MARKS}
              more={Math.max(0, RENDERERS.length - RENDERER_MARKS.length)}
            />
            <Card
              palette="forest"
              seed={73}
              index={2}
              name="Hack Workbench"
              title="Scoped, authorised, evidenced."
              body="An offensive toolchain that runs only against a target you've declared, verifies findings before it reports them, and keeps the evidence. Included with Max."
              marks={HACK_MARKS}
            />
          </div>

          {/* The product, spread — Build live beside real Studio output */}
          <div className="mt-4 grid gap-4 lg:grid-cols-5">
            <HReveal delayMs={60} id="build" className="scroll-mt-20 lg:col-span-3">
              <Screen label="build">
                <RiftMiniApp
                  variant="bare"
                  initialSurface="build"
                  showSidebar={false}
                />
              </Screen>
            </HReveal>
            <HReveal delayMs={140} id="studio" className="scroll-mt-20 lg:col-span-2">
              <Screen label="studio" live={false} note="four real generations">
                <div className="bg-black p-3">
                  <HStudioShots columns={2} label={null} />
                </div>
              </Screen>
            </HReveal>
          </div>

          {/* Workbench — the widest single stage */}
          <HReveal delayMs={60} id="workbench" className="mt-4 scroll-mt-20">
            <Screen label="workbench" note="scanme.nmap.org · live">
              <LiveWorkbench variant="bare" />
            </Screen>
          </HReveal>
          <HReveal delayMs={100} className="mt-6 text-center">
            <a
              href="/signup"
              className="inline-flex font-[family-name:var(--h-mono)] text-[12px] uppercase tracking-[0.1em] text-[var(--h-ink)] underline decoration-[var(--h-line)] underline-offset-[6px] transition-colors hover:decoration-[var(--h-ink)]"
            >
              Run a scan against your own scope &rarr;
            </a>
          </HReveal>
        </div>
      </section>
    </div>
  );
}
