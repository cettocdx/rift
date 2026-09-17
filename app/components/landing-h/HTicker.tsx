import { H_CONTAINER } from "./h-system";

/**
 * The news bar. Hermeus opens on a single contract announcement with a gold
 * status dot; ours names the thing that is actually new, links to the change-
 * log, and is the only gold on the fold.
 */
export function HTicker() {
  return (
    <div className="border-b border-[var(--h-line)] bg-[var(--h-ground)]">
      <div
        className={`${H_CONTAINER} flex h-9 items-center gap-3 text-[11px] uppercase tracking-[0.12em]`}
      >
        <span className="flex items-center gap-2 font-semibold text-[var(--h-ink)]">
          <span className="size-1.5 rounded-full bg-[var(--h-ink)]" />
          New
        </span>
        <a
          href="#build"
          className="truncate text-[var(--h-ink-70)] transition-colors hover:text-[var(--h-ink)]"
        >
          RIFT runs a full agent on a real machine — filesystem, terminal,
          verified before it says done &rarr;
        </a>
      </div>
    </div>
  );
}
