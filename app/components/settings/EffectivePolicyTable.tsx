"use client";

import { useState } from "react";
import { ChevronRight, Layers } from "lucide-react";
import {
  resolveEffectivePolicy,
  type EffectivePolicySetting,
  type PolicyLayer,
} from "@/lib/ai/agents/policy-inheritance";
import { cn } from "@/lib/utils";

/**
 * Effective policy, and which layer decided it.
 *
 * Section 18.4 asks settings to show inheritance. The value alone does not
 * answer the question a person actually has -- "why can this agent do that,
 * and where do I change it" -- so each row opens to the chain that produced it.
 *
 * Layers that cannot carry a setting say so, with the reason. Drawing them as
 * empty rows would imply someone could fill them, which is a hierarchy this
 * product does not have.
 */

const STATE_TONE: Record<PolicyLayer["state"], string> = {
  source: "text-foreground",
  inherits: "text-muted-foreground",
  "not-configurable": "text-muted-foreground/55",
};

function LayerRow({ layer }: { layer: PolicyLayer }) {
  return (
    <li className="flex min-w-0 items-baseline gap-2 py-1">
      <span
        aria-hidden
        className={cn(
          "mt-1 size-1.5 shrink-0 rounded-full",
          layer.state === "source"
            ? "bg-[var(--primary)]"
            : layer.state === "inherits"
              ? "bg-muted-foreground/40"
              : "bg-transparent border border-muted-foreground/30",
        )}
      />
      <span
        className={cn(
          "w-[132px] shrink-0 text-ui-label",
          STATE_TONE[layer.state],
        )}
      >
        {layer.label}
      </span>
      <span className="min-w-0 flex-1 text-ui-label leading-4">
        {layer.state === "source" ? (
          <span className="text-foreground">{layer.value}</span>
        ) : layer.state === "inherits" ? (
          <span className="text-muted-foreground">
            {layer.reason ?? "Inherits from above"}
          </span>
        ) : (
          <span className="text-muted-foreground/70">{layer.reason}</span>
        )}
      </span>
      {layer.state === "source" ? (
        <span className="shrink-0 rounded bg-[var(--primary)]/12 px-1 py-px text-[9px] uppercase tracking-[0.06em] text-[var(--primary)]">
          In effect
        </span>
      ) : null}
    </li>
  );
}

function SettingRow({ setting }: { setting: EffectivePolicySetting }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="border-b border-border/50 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 py-2 text-left transition-colors hover:bg-accent/25 focus-visible:outline-none focus-visible:bg-accent/25"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform duration-(--duration-hover) motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-ui-label text-foreground">
          {setting.label}
        </span>
        <span className="shrink-0 text-ui-label text-muted-foreground">
          {setting.effectiveValue}
        </span>
        <span className="hidden shrink-0 text-ui-caption text-muted-foreground/70 sm:inline">
          via {setting.decidedBy}
        </span>
      </button>

      {open ? (
        <ul className="pb-2 pl-5 pr-1">
          {setting.chain.map((layer) => (
            <LayerRow key={layer.id} layer={layer} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function EffectivePolicyTable(
  props: Parameters<typeof resolveEffectivePolicy>[0],
) {
  const settings = resolveEffectivePolicy(props);

  return (
    <section
      data-ui="effective-policy"
      aria-label="Effective policy and inheritance"
      className="rounded-lg border border-border/70"
    >
      <header className="flex items-center gap-1.5 border-b border-border/50 px-3 py-2">
        <Layers aria-hidden className="size-3.5 text-muted-foreground" />
        <h3 className="text-ui-label font-medium text-foreground">
          Effective policy
        </h3>
        <p className="ml-auto text-ui-caption text-muted-foreground">
          Open a row to see which layer set it
        </p>
      </header>

      <ul className="px-3">
        {settings.map((setting) => (
          <SettingRow key={setting.key} setting={setting} />
        ))}
      </ul>
    </section>
  );
}
