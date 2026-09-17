import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChatMode } from "@/types/chat";
import { isAgentMode } from "@/lib/utils/mode-helpers";

type CostTier = "low" | "medium" | "high" | "very-high";

// Cost tier per product-facing RIFT tier id. Runtime security traffic currently
// resolves through the shared Grok route; these tiers describe the retail UI.
export function getCostTier(modelId: string, mode?: ChatMode): CostTier {
  switch (modelId) {
    case "rift-standard":
      return mode && isAgentMode(mode) ? "medium" : "low";
    case "rift-pro":
      return "high";
    case "rift-max":
      return "very-high";
    default:
      return "medium";
  }
}

const COST_CONFIG: Record<CostTier, { label: string; activeClass: string }> = {
  low: {
    label: "low cost",
    activeClass:
      "text-emerald-600/90 dark:text-emerald-400/90 border-emerald-500/30",
  },
  medium: {
    label: "medium cost",
    activeClass: "text-amber-600/90 dark:text-amber-400/90 border-amber-500/30",
  },
  high: {
    label: "high cost",
    activeClass:
      "text-orange-600/90 dark:text-orange-400/90 border-orange-500/30",
  },
  "very-high": {
    label: "very high cost",
    activeClass: "text-red-600/90 dark:text-red-400/90 border-red-500/30",
  },
};

export function CostIndicator({
  modelId,
  mode,
}: {
  modelId: string;
  mode?: ChatMode;
}) {
  const tier = getCostTier(modelId, mode);
  const config = COST_CONFIG[tier];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={`Cost: ${config.label}`}
          className={`inline-flex items-center font-mono text-[9px] uppercase tracking-widest cursor-default border px-1 leading-tight ${config.activeClass}`}
        >
          {config.label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={4} className="text-xs px-2 py-1">
        {config.label}
      </TooltipContent>
    </Tooltip>
  );
}
