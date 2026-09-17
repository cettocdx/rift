"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * Shows a sonner toast after a user returns from checkout for extra usage
 * credits. Legacy Stripe confirm routes redirect here with purchase params:
 * personal uses ?extra-usage-purchased=true&amount=<dollars>, team uses
 * ?team-extra-usage-purchased=true&amount=<dollars>. Async payment methods
 * land with a matching pending param while the webhook completes the credit.
 * LemonSqueezy returns with ?tokens-pending=1 while its signed webhook adds
 * the purchased balance.
 *
 * Strips the params from the URL after firing so a reload doesn't re-show it.
 * Reads directly from window.location to match the existing page pattern and
 * avoid forcing a Suspense boundary via next/navigation's useSearchParams.
 */
export function ExtraUsagePurchaseToast() {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;

    const url = new URL(window.location.href);
    const isTeamPurchase =
      url.searchParams.get("team-extra-usage-purchased") === "true";
    const isPersonalPurchase =
      url.searchParams.get("extra-usage-purchased") === "true";
    const isLemonPending = url.searchParams.get("tokens-pending") === "1";
    const isLemonSuccess = url.searchParams.get("tokens-success") === "1";

    if (
      !isTeamPurchase &&
      !isPersonalPurchase &&
      !isLemonPending &&
      !isLemonSuccess
    )
      return;

    firedRef.current = true;

    if (isLemonPending) {
      toast.info("Payment submitted", {
        description:
          "Your add-on credits will appear as soon as LemonSqueezy confirms the payment.",
      });
    } else if (isLemonSuccess) {
      toast.success("Credits added", {
        description: "Your add-on credit balance is ready to use.",
      });
    } else {
      const pending =
        url.searchParams.get(
          isTeamPurchase ? "team-extra-usage-pending" : "extra-usage-pending",
        ) === "true";
      const amountRaw = url.searchParams.get("amount");
      const amount = amountRaw ? Number(amountRaw) : NaN;
      const amountLabel =
        Number.isFinite(amount) && amount > 0 ? `$${amount}` : null;

      if (pending) {
        toast.info("Payment received", {
          description: amountLabel
            ? `${amountLabel} in ${isTeamPurchase ? "team " : ""}credits will be added once your payment finalizes.`
            : isTeamPurchase
              ? "Your team credits will be added once your payment finalizes."
              : "Your credits will be added once your payment finalizes.",
        });
      } else {
        toast.success("Payment successful", {
          description: amountLabel
            ? `Added ${amountLabel} in ${isTeamPurchase ? "team " : ""}extra usage credits.`
            : isTeamPurchase
              ? "Team extra usage credits added to your team balance."
              : "Extra usage credits added to your balance.",
        });
      }
    }

    url.searchParams.delete("tokens-pending");
    url.searchParams.delete("tokens-success");
    url.searchParams.delete("extra-usage-purchased");
    url.searchParams.delete("extra-usage-pending");
    url.searchParams.delete("team-extra-usage-purchased");
    url.searchParams.delete("team-extra-usage-pending");
    url.searchParams.delete("amount");
    // Preserve Next.js App Router's internal history state (routing tree and
    // scroll restoration). Passing {} would clobber it.
    window.history.replaceState(
      window.history.state,
      "",
      url.pathname + url.search + url.hash,
    );
  }, []);

  return null;
}
