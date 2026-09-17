import {
  Anthropic,
  ByteDance,
  Flux,
  Google,
  Kling,
  Moonshot,
  OpenAI,
  Qwen,
  XAI,
  ZAI,
} from "@lobehub/icons";
import type { ComponentType } from "react";

import {
  MCP_CATALOG,
  hasConfiguredMcpEndpoint,
} from "@/app/components/mcpCatalog";
import { BUILD_MODELS, MEDIA_MODELS } from "@/types/chat";

/**
 * Who is behind the product, resolved once.
 *
 * This used to live inside a single component that stacked all three lists in
 * one column — vendors, then renderers, then connectors, three wrapped rows of
 * marks under each other. That block answered three unrelated questions in one
 * place and none of them where the reader was actually asking: whose models
 * run the code (Build), what renders the pixels (Studio), and what the agent
 * can reach (connectors). Each list now belongs to its own section and gets a
 * visual built for what it is — a ring, a mosaic and a constellation.
 *
 * Nothing here is hand-typed. Every list is read from the module the product
 * itself uses, which is what stopped a model we do not ship appearing on the
 * page with a competitor's logo beside it.
 */

export type Mark = ComponentType<{ size?: number; className?: string }>;

const VENDOR_LOGOS: Record<string, Mark> = {
  OpenAI,
  Anthropic,
  xAI: XAI,
  MoonshotAI: Moonshot,
  Alibaba: Qwen,
  "Z.ai": ZAI,
};

const VENDOR_LABELS: Record<string, string> = { MoonshotAI: "Moonshot" };

/** The reasoning vendors, derived from the models Build actually offers. */
export const VENDORS = [...new Set(BUILD_MODELS.map((m) => m.provider))]
  .filter((provider) => provider in VENDOR_LOGOS)
  .map((provider) => ({
    id: provider,
    name: VENDOR_LABELS[provider] ?? provider,
    Logo: VENDOR_LOGOS[provider],
  }));

/**
 * Renderer marks are matched by name prefix rather than by an id table,
 * because the ids churn ("nano_banana_pro" became "nano_banana_2") while the
 * vendor a model belongs to does not.
 */
const RENDERER_MARKS: { match: RegExp; Logo: Mark }[] = [
  { match: /^(nano banana|gemini|veo)/i, Logo: Google },
  { match: /^(seedream|seedance)/i, Logo: ByteDance },
  { match: /^flux/i, Logo: Flux },
  { match: /^kling/i, Logo: Kling },
  { match: /^(grok|imagine)/i, Logo: XAI },
  { match: /^(gpt|dall)/i, Logo: OpenAI },
  { match: /^(qwen|wan)/i, Logo: Qwen },
];

export const RENDERERS = MEDIA_MODELS.map((model) => ({
  id: model.id,
  name: model.name,
  Logo: RENDERER_MARKS.find((entry) => entry.match.test(model.name))?.Logo,
}));

/**
 * Connectors the product can actually open — the same predicate the
 * application gates on, so a mark can never appear for something that would
 * fail the moment a reader signed up and clicked it.
 */
export const CONNECTORS = MCP_CATALOG.filter(hasConfiguredMcpEndpoint);
