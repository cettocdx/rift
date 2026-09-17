"use client";

import { useState } from "react";
import { useAction } from "convex/react";

import { api } from "@/convex/_generated/api";

import { BuyExtraUsageDialog } from "./BuyExtraUsageDialog";

type AddOnCreditsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCheckoutRedirect?: (url: string) => void;
};

/**
 * Connected add-on checkout used by every in-app billing surface.
 * Package selection stays in BuyExtraUsageDialog; this component owns the
 * single LemonSqueezy action, redirect, loading, and error contract.
 */
const AddOnCreditsDialog = ({
  open,
  onOpenChange,
  onCheckoutRedirect,
}: AddOnCreditsDialogProps) => {
  const createTopup = useAction(api.extraUsageActions.createLemonsqueezyTopup);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setCheckoutError(null);
    onOpenChange(nextOpen);
  };

  const handlePurchase = async (amountDollars: number) => {
    if (isPurchasing) return;

    setCheckoutError(null);
    setIsPurchasing(true);
    try {
      const result = await createTopup({
        amountDollars,
        baseUrl: window.location.origin,
      });

      if (!result.url) {
        const message = result.error || "Could not start checkout";
        setCheckoutError(message);
        return;
      }

      if (onCheckoutRedirect) {
        onCheckoutRedirect(result.url);
      } else {
        window.location.assign(result.url);
      }
    } catch {
      const message = "Could not start checkout";
      setCheckoutError(message);
    } finally {
      setIsPurchasing(false);
    }
  };

  return (
    <BuyExtraUsageDialog
      open={open}
      onOpenChange={handleOpenChange}
      onPurchase={handlePurchase}
      isLoading={isPurchasing}
      title="Add-on credits"
      description="Credits stack on top of your monthly allowance and never expire. Bigger packs include bonus credits."
      lineItemLabel="Credits"
      errorMessage={checkoutError}
    />
  );
};

export { AddOnCreditsDialog };
export type { AddOnCreditsDialogProps };
