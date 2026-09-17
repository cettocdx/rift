import {
  Alibaba,
  ByteDance,
  Flux,
  Google,
  Kling,
  Minimax,
  OpenAI,
  Qwen,
  Runway,
  Sora,
  XAI,
} from "@lobehub/icons";
import { createElement, type ComponentType } from "react";

import { MEDIA_MODELS } from "@/types/chat";

import { X_CAPTION, X_LABEL } from "./x-system";

/**
 * The roster wall.
 *
 * ── What this replaces ──
 *
 * The Studio section named its models in one place only: a caption in the
 * corner of each of four generated images. A reader asking the obvious
 * question — *which* models? — got four names out of twelve, as photo credits.
 *
 * The first attempt at fixing that went too far the other way: two columns of
 * rows carrying a name, a badge, a one-line description and the provider slug
 * for all twelve. Every field was true and checkable and the whole thing was a
 * wall of text in a section whose argument is that you do not have to think
 * about models very hard. The second showed all twelve as tiles, which put
 * five Google entries in a row and read as "we resell Google".
 *
 * So: one row of chips, one model per vendor, a colour mark and a name. The
 * count in the line above is still every model; the chips are the flagships,
 * chosen by the badge ranking in BADGE_RANK rather than by hand.
 *
 * ── Why the marks are the colour variants ──
 *
 * `@lobehub/icons` ships each vendor twice: a monochrome mark that takes
 * `currentColor`, and `.Color`, the brand artwork. Everywhere else on this page
 * the monochrome one is right, because the page has no hue in it by design.
 * Here it is wrong: the one thing this grid has to communicate at a glance is
 * *how many different vendors* are behind one prompt box, and twelve identical
 * black glyphs communicate the opposite. The colour is the information.
 */

type Mark = ComponentType<{ size?: number; className?: string }>;

/**
 * The vendors, in the order they appear on the wall.
 *
 * Matched on the model-name prefix, so a model added to types/chat.ts joins
 * its vendor without a second edit here.
 *
 * `@lobehub/icons` only ships a `.Color` variant for some of these — Google,
 * ByteDance, Kling, Qwen and MiniMax have one; Flux, xAI, OpenAI and Runway do
 * not, and do not need one, because their brand marks are monochrome by
 * design. Reaching for `Flux.Color` is a type error rather than a fallback,
 * which is the package being helpful.
 *
 * Sora and Wan get rows of their own rather than being folded into OpenAI and
 * Qwen. They bill to the same two companies, and an earlier cut of this file
 * matched them that way — which meant the wall showed GPT Image 2 and Qwen
 * Image 3 Pro and silently dropped both video models, so a reader learned that
 * RIFT does OpenAI images and never learned it does OpenAI video. They ship
 * under their own names and their own artwork; the wall is read as a list of
 * things you can pick, and they are two of them.
 */
const VENDORS: { id: string; match: RegExp; Logo: Mark }[] = [
  { id: "google", match: /^(nano banana|gemini|veo)/i, Logo: Google.Color as Mark },
  { id: "bytedance", match: /^(seedream|seedance)/i, Logo: ByteDance.Color as Mark },
  { id: "bfl", match: /^flux/i, Logo: Flux as Mark },
  { id: "kling", match: /^kling/i, Logo: Kling.Color as Mark },
  { id: "xai", match: /^(grok|imagine)/i, Logo: XAI as Mark },
  { id: "openai", match: /^(gpt|dall)/i, Logo: OpenAI as Mark },
  { id: "sora", match: /^sora/i, Logo: Sora as Mark },
  { id: "qwen", match: /^qwen/i, Logo: Qwen.Color as Mark },
  { id: "alibaba", match: /^wan/i, Logo: Alibaba.Color as Mark },
  { id: "runway", match: /^runway/i, Logo: Runway as Mark },
  { id: "minimax", match: /^hailuo/i, Logo: Minimax.Color as Mark },
];

/**
 * Which model represents a vendor.
 *
 * The wall shows one model per vendor, not all twelve — five Google entries in
 * a row says "we resell Google" rather than "pick the model that suits the
 * shot". Picking one is a judgement, so it is made by a rule rather than by
 * hand: the badges in types/chat.ts already rank the roster, and this is that
 * ranking written down. A tie falls to the module's own order.
 *
 * Change the order here, not the tiles — the tiles are derived.
 */
const BADGE_RANK = [
  "Max",
  "Premium",
  "Creative",
  "Motion",
  "Photo",
  "Default",
  "Fast",
];

const rank = (badge: string) => {
  const i = BADGE_RANK.indexOf(badge);
  return i === -1 ? BADGE_RANK.length : i;
};

/** One model per vendor, the highest-ranked badge each. */
const FLAGSHIPS = VENDORS.map((vendor) => {
  const owned = MEDIA_MODELS.filter((model) => vendor.match.test(model.name));
  const best = owned.reduce<(typeof owned)[number] | undefined>(
    (winner, model) =>
      !winner || rank(model.badge) < rank(winner.badge) ? model : winner,
    undefined,
  );
  return best ? { ...vendor, name: best.name, badge: best.badge } : null;
}).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

function VendorMark({ vendor }: { vendor: string }) {
  const logo = VENDORS.find((entry) => entry.id === vendor)?.Logo;
  return (
    <span className="flex size-7 shrink-0 items-center justify-center">
      {logo ? (
        // `createElement`, not `<Logo />`: aliasing a component to a local and
        // rendering it as JSX trips `react-hooks/static-components`, which
        // cannot tell a lookup in a static table from a component built during
        // render. This is the former; saying so beats suppressing the rule.
        createElement(logo, { size: 22 })
      ) : (
        <span className="size-1.5 rounded-full bg-[var(--x-ink-30)]" />
      )}
    </span>
  );
}

export function XRenderers() {
  return (
    <div>
      <div className="flex flex-col items-center text-center">
        <p className={X_LABEL}>The roster</p>
        {/* No count. The roster gains models whenever a vendor ships one, and
            a figure printed here is a promise about its size that goes stale
            the same week — the argument is the breadth, not the number. */}
        <p className={`${X_CAPTION} mt-3 max-w-[46ch]`}>
          Image and video, one key, one bill. The flagship of each vendor is
          below.
        </p>
      </div>

      <ul className="mt-10 flex flex-wrap justify-center gap-2">
        {FLAGSHIPS.map((entry) => (
          <li
            key={entry.id}
            className="flex items-center gap-2.5 rounded-full bg-[var(--x-raise)] py-2 pl-2.5 pr-4 transition-colors duration-150 hover:bg-[var(--x-raise-strong)] motion-reduce:transition-none"
          >
            <VendorMark vendor={entry.id} />
            <span className="whitespace-nowrap text-[13.5px] font-medium tracking-[-0.025em] text-[var(--x-ink)]">
              {entry.name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
