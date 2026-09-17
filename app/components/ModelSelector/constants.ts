import type { ChatMode, SelectedModel } from "@/types/chat";
import { isAgentMode } from "@/lib/utils/mode-helpers";

export interface ModelOption {
  id: SelectedModel;
  label: string;
  /** Short tagline shown in the hover popup (e.g. "Maximum intelligence for complex work") */
  description?: string;
  /** "Powered by …" line shown beneath the description in the hover popup */
  poweredBy?: string;
  thinking?: boolean;
}

export const ASK_MODEL_OPTIONS: ModelOption[] = [
  {
    id: "rift-standard",
    label: "⬡ Recon",
    description: "Baseline intelligence for reconnaissance",
    poweredBy: "xAI Grok 4.3",
  },
  {
    id: "rift-pro",
    label: "⬢ Strike",
    description: "Advanced capability for complex operations",
    poweredBy: "xAI Grok 4.3",
  },
  {
    id: "rift-max",
    label: "⬥ Dominate",
    description: "Maximum power for unrestricted analysis",
    poweredBy: "xAI Grok 4.3",
  },
];

export const AGENT_MODEL_OPTIONS: ModelOption[] = [
  {
    id: "rift-standard",
    label: "⬡ Recon",
    description: "Autonomous reconnaissance & enumeration",
    poweredBy: "xAI Grok 4.3",
    thinking: true,
  },
  {
    id: "rift-pro",
    label: "⬢ Strike",
    description: "Advanced autonomous exploitation & testing",
    poweredBy: "xAI Grok 4.3",
    thinking: true,
  },
  {
    id: "rift-max",
    label: "⬥ Dominate",
    description: "Maximum autonomous penetration power",
    poweredBy: "xAI Grok 4.3",
    thinking: true,
  },
];

export const getDefaultModelForMode = (mode: ChatMode): SelectedModel => {
  const options = isAgentMode(mode) ? AGENT_MODEL_OPTIONS : ASK_MODEL_OPTIONS;
  return options[0].id;
};
