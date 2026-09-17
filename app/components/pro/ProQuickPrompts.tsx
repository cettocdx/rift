"use client";

import { Radar, Shield, Terminal, Sparkles } from "lucide-react";
import { useInputApi } from "@/app/contexts/InputContext";

const PROMPTS = [
  { icon: Radar, label: "Recon a domain", text: "Passive recon on " },
  { icon: Shield, label: "Vuln scan", text: "Run a quick web vuln scan on " },
  {
    icon: Terminal,
    label: "Explain output",
    text: "Explain this security finding: ",
  },
  {
    icon: Sparkles,
    label: "Plan an assessment",
    text: "Help me plan a security assessment for ",
  },
] as const;

function focusComposer() {
  requestAnimationFrame(() => {
    const el =
      document.querySelector<HTMLTextAreaElement>(".pro-main textarea");
    el?.focus();
    const len = el?.value.length ?? 0;
    el?.setSelectionRange(len, len);
  });
}

export function ProQuickPrompts() {
  const { setInput } = useInputApi();

  return (
    <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
      {PROMPTS.map(({ icon: Icon, label, text }) => (
        <button
          key={label}
          type="button"
          onClick={() => {
            setInput(text);
            focusComposer();
          }}
          className="pro-quick-prompt inline-flex h-7 items-center gap-2 rounded-full px-3 text-ui-label text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon className="size-3.5 opacity-70" />
          {label}
        </button>
      ))}
    </div>
  );
}
