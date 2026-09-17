import type { Metadata } from "next";
import Link from "next/link";
import {
  MarketingBody,
  MarketingPage,
} from "@/app/components/marketing/MarketingPage";
import { XPlanTable } from "@/app/components/landing-x/XClose";
import {
  X_CAPTION,
  X_LABEL,
  X_NUMERAL,
  X_SECTION,
} from "@/app/components/landing-x/x-system";
import { TOKEN_PACKAGES } from "@/lib/billing/token-packages";

export const metadata: Metadata = {
  title: "Pricing | RIFT",
  description:
    "RIFT pricing: start free, choose Pro ($39/mo) for Build and Studio, or Max ($129/mo) for exclusive Hack Workbench access.",
  openGraph: {
    title: "Pricing | RIFT",
    description:
      "Choose Pro ($39/mo) for Build and Studio, or Max ($129/mo) for exclusive Hack Workbench access.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Pricing | RIFT",
    description:
      "Choose Pro ($39/mo) for Build and Studio, or Max ($129/mo) for exclusive Hack Workbench access.",
  },
};

export const dynamic = "force-static";

/**
 * The credit packs, read off the checkout's own catalogue.
 *
 * This page used to carry a hand-written copy — "Starter $20 / 200,000
 * credits" and three more — beside the ladder that actually charges. Every
 * figure below now comes from `TOKEN_PACKAGES`, where the token counts are
 * themselves derived from the price and the volume bonus, so a change to the
 * bonus schedule cannot leave the marketing page advertising the old grant.
 */
const PACKS = TOKEN_PACKAGES.map((pack) => ({
  name: pack.name,
  price: `$${pack.priceUsd.toLocaleString("en-US")}`,
  credits: `${pack.totalTokens.toLocaleString("en-US")} credits`,
  bonus: pack.bonusPct > 0 ? `+${pack.bonusPct}%` : undefined,
}));

export default function PricingPage() {
  return (
    <MarketingPage
      eyebrow="Pricing"
      title="Start free. Pay for the runs you actually make."
      lede="Build and Studio are free to use. Paid plans add a monthly credit pool, and Max is the only plan that unlocks Hack Workbench."
    >
      <MarketingBody>
        {/* The landing's own table, not a second drawing of it. The plan
            names inside it are h3s, so the group needs its own h2 — visible
            only to a screen reader, because the page title already says it. */}
        <h2 className="sr-only">Plans</h2>
        <XPlanTable />

        <section className="mt-20 border-t-[0.5px] border-t-[var(--x-line)] pt-14">
          <p className={X_LABEL}>Top-ups</p>
          <h2
            className={`${X_SECTION} mt-5 max-w-[22ch] text-balance text-[var(--x-ink)]`}
          >
            Run out mid-month? Top up.
          </h2>
          <p className={`${X_CAPTION} mt-5 max-w-[60ch]`}>
            Credit packs are one-time purchases and never expire. Credits are
            spent per request, priced on the model and the length of the run, so
            a long build costs more than a quick question.
          </p>

          <dl className="mt-12 grid divide-y-[0.5px] divide-[var(--x-line)] border-t-[0.5px] border-t-[var(--x-line)] sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x-[0.5px]">
            {PACKS.map((pack) => (
              <div
                key={pack.name}
                className="flex flex-col py-8 lg:px-8 lg:first:pl-0 lg:last:pr-0"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[15px] font-medium leading-[22px] tracking-[-0.025em] text-[var(--x-ink)]">
                    {pack.name}
                  </dt>
                  {pack.bonus ? (
                    <span className={`${X_LABEL} text-[var(--x-live)]`}>
                      {pack.bonus}
                    </span>
                  ) : null}
                </div>
                <dd
                  className={`${X_NUMERAL} mt-6 text-[34px] text-[var(--x-ink)]`}
                >
                  {pack.price}
                </dd>
                <dd className={`${X_CAPTION} mt-2 tabular-nums`}>
                  {pack.credits}
                </dd>
              </div>
            ))}
          </dl>
          <p className={`${X_CAPTION} mt-6 text-[13px]`}>
            Custom amounts from $10 to $999,999 are available at checkout, and
            larger packs carry a volume bonus.
          </p>
        </section>

        <section className="mt-20 border-t-[0.5px] border-t-[var(--x-line)] pt-14">
          <p className={X_LABEL}>Payment</p>
          <h2
            className={`${X_SECTION} mt-5 max-w-[22ch] text-balance text-[var(--x-ink)]`}
          >
            Card, monthly, cancel whenever.
          </h2>
          <p className={`${X_CAPTION} mt-5 max-w-[60ch]`}>
            Subscriptions renew monthly and can be cancelled at any time. Your
            balance and top-ups are shown in the app and drawn down as you run
            requests. Our{" "}
            <Link
              href="/refund-policy"
              className="text-[var(--x-ink)] underline decoration-[var(--x-line-soft)] underline-offset-4 transition-colors hover:decoration-[var(--x-ink)] motion-reduce:transition-none"
            >
              refund policy
            </Link>{" "}
            covers the rest.
          </p>
        </section>
      </MarketingBody>
    </MarketingPage>
  );
}
