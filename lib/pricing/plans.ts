/**
 * The subscription tiers, in one place.
 *
 * Both the pricing page and the landing page render these. Keeping a second
 * hand-written copy on the marketing page is how a site ends up advertising a
 * price the checkout no longer charges — the duplicate goes stale silently,
 * and nobody notices until a customer does.
 */

export type Plan = {
  name: string;
  price: string;
  cadence: string;
  blurb: string;
  features: string[];
  cta: string;
  href: "/signup" | "/upgrade" | "/upgrade?feature=hack";
  highlight?: boolean;
};

import { INCLUDED_CREDITS_BY_TIER } from "@/lib/billing/included-credits";
import { POINTS_PER_DOLLAR } from "@/lib/billing/credit-units";
import { getFreeRequestLimit } from "@/lib/rate-limit/free-config";

/**
 * Credits, with the dollar figure they actually represent.
 *
 * "500,000 credits every month" is a number a buyer cannot price — it was the
 * one figure on the pricing page with no denominator. The chain that gives it
 * one is an invariant across three modules: one credit is one rate-limit point
 * (included-credits.ts), and POINTS_PER_DOLLAR is 10,000 (credit-units.ts), so
 * the grant divided by that is the monthly metered-usage budget in dollars.
 * Derived here rather than typed, so the credits and the dollars cannot drift
 * apart and neither can drift from the tier grant.
 */
const creditLine = (tier: keyof typeof INCLUDED_CREDITS_BY_TIER): string => {
  const credits = INCLUDED_CREDITS_BY_TIER[tier];
  const dollars = Math.round(credits / POINTS_PER_DOLLAR);
  return `${credits.toLocaleString("en-US")} credits — $${dollars} of metered usage — every month`;
};

export const PLANS: Plan[] = [
  {
    name: "Free",
    price: "$0",
    cadence: "forever",
    blurb: "Try the core workspace, no card required.",
    features: [
      `${getFreeRequestLimit()} questions per day (Ask)`,
      "1 full agent run each month",
      "Build and Studio access",
      "Isolated cloud sandbox",
    ],
    cta: "Start free",
    href: "/signup",
  },
  {
    name: "Pro",
    price: "$39",
    cadence: "/ month",
    blurb: "For makers who ship every week.",
    features: [
      "Everything in Free",
      creditLine("pro"),
      "No daily or monthly caps — metered by credits",
      "Unlimited chats & projects",
      "Priority sandboxes",
    ],
    cta: "Choose Pro",
    href: "/upgrade",
    highlight: true,
  },
  {
    name: "Max",
    price: "$129",
    cadence: "/ month",
    blurb: "For power users and small teams.",
    features: [
      "Everything in Pro",
      "Exclusive Hack Workbench access",
      creditLine("ultra"),
      "Personal API keys",
      "Highest limits & priority",
      "Early access to new tools",
    ],
    cta: "Choose Max",
    href: "/upgrade?feature=hack",
  },
];
