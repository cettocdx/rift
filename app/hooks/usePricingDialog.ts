import type { SubscriptionTier } from "@/types";

/**
 * Upgrade CTAs across the app (rate-limit prompts, file-upload limits, the
 * message error state, etc.) route here. They now send the user to the
 * dedicated in-app `/upgrade` page, where subscribing redirects to the
 * LemonSqueezy hosted checkout and credits can be topped up.
 */
const goToUpgrade = () => {
  if (typeof window !== "undefined") {
    window.location.href = "/upgrade";
  }
};

export const usePricingDialog = (_subscription?: SubscriptionTier) => {
  return {
    showPricing: false,
    handleClosePricing: () => {},
    openPricing: goToUpgrade,
  };
};

/** Send the user to the dedicated upgrade page. */
export const redirectToPricing = goToUpgrade;
