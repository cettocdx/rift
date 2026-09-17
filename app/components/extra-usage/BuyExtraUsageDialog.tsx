"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreditCard, X } from "lucide-react";
import {
  TOKEN_PACKAGES,
  MIN_CUSTOM_TOPUP_USD,
  bonusPointsForDollars,
  type TokenPackage,
} from "@/lib/billing/token-packages";
import { formatTokens } from "@/lib/billing/token-display";
import { POINTS_PER_DOLLAR } from "@/lib/billing/credit-units";
import { cn } from "@/lib/utils";

type BuyExtraUsageDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPurchase: (amountDollars: number) => Promise<void>;
  isLoading: boolean;
  title?: string;
  description?: string;
  lineItemLabel?: string;
  errorMessage?: string | null;
};

const MAX_AMOUNT = 999_999;

const formatWithCommas = (value: string): string => {
  const cleanValue = value.replace(/,/g, "");
  return cleanValue.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

const removeCommas = (value: string): string => value.replace(/,/g, "");

const totalTokensForDollars = (dollars: number): number =>
  dollars * POINTS_PER_DOLLAR + bonusPointsForDollars(dollars);

type ContentProps = {
  onPurchase: (amountDollars: number) => Promise<void>;
  isLoading: boolean;
  title: string;
  description: string;
  lineItemLabel: string;
  errorMessage?: string | null;
};

const BuyExtraUsageDialogContent = ({
  onPurchase,
  isLoading,
  title,
  description,
  lineItemLabel,
  errorMessage,
}: ContentProps) => {
  const [selected, setSelected] = useState<TokenPackage["id"] | "custom">(
    "plus",
  );
  const [customAmount, setCustomAmount] = useState<string>("50");

  const selectedPackage =
    selected === "custom"
      ? undefined
      : TOKEN_PACKAGES.find((p) => p.id === selected);

  const customParsed = parseInt(removeCommas(customAmount) || "0", 10);
  const amountDollars = selectedPackage
    ? selectedPackage.priceUsd
    : customParsed;

  const isValidAmount =
    !isNaN(amountDollars) &&
    amountDollars >= MIN_CUSTOM_TOPUP_USD &&
    amountDollars <= MAX_AMOUNT;
  const showMinAmountError =
    selected === "custom" &&
    customAmount !== "" &&
    !isNaN(customParsed) &&
    customParsed < MIN_CUSTOM_TOPUP_USD;
  const showMaxAmountError =
    selected === "custom" &&
    customAmount !== "" &&
    !isNaN(customParsed) &&
    customParsed > MAX_AMOUNT;

  const totalTokens = selectedPackage
    ? selectedPackage.totalTokens
    : isValidAmount
      ? totalTokensForDollars(amountDollars)
      : 0;

  const handlePurchase = async () => {
    if (!isValidAmount) return;
    await onPurchase(amountDollars);
  };

  return (
    <div
      data-ui="buy-extra-usage-scroll"
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 md:p-0"
    >
      <DialogHeader className="pr-12 md:pr-7">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="max-w-[46ch] text-[13px] leading-5 text-muted-foreground">
          {description}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-5 pt-2" aria-busy={isLoading}>
        {/* Package cards */}
        <div
          className="grid grid-cols-2 gap-2.5"
          role="group"
          aria-label="Credit packages"
        >
          {TOKEN_PACKAGES.map((pkg) => {
            const active = selected === pkg.id;
            return (
              <button
                key={pkg.id}
                type="button"
                onClick={() => setSelected(pkg.id)}
                disabled={isLoading}
                aria-pressed={active}
                aria-label={`${pkg.name}: $${pkg.priceUsd} for ${formatTokens(pkg.totalTokens)} credits`}
                className={cn(
                  "relative flex min-h-[108px] cursor-pointer touch-manipulation flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors duration-(--duration-hover) focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60",
                  active
                    ? "border-foreground/35 bg-muted/65 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                    : "border-border/80 bg-card/30 hover:border-foreground/20 hover:bg-muted/35",
                )}
              >
                {pkg.bonusPct > 0 && (
                  <span className="absolute right-2 top-2 rounded-[4px] border border-border/70 bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold text-foreground/80">
                    +{pkg.bonusPct}%
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {pkg.name}
                </span>
                <span className="font-mono text-base font-semibold tabular-nums">
                  {formatTokens(pkg.totalTokens)}
                </span>
                <span className="text-xs text-muted-foreground">credits</span>
                <span className="mt-1 text-sm font-medium">
                  ${pkg.priceUsd}
                </span>
              </button>
            );
          })}
        </div>

        {/* Custom amount */}
        <div>
          <button
            type="button"
            onClick={() => setSelected("custom")}
            disabled={isLoading}
            aria-pressed={selected === "custom"}
            className={cn(
              "mb-2 inline-flex min-h-11 cursor-pointer touch-manipulation items-center rounded-sm text-sm underline-offset-2 transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 md:pointer-fine:min-h-0",
              selected === "custom"
                ? "text-primary underline"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Custom amount
          </button>
          {selected === "custom" && (
            <>
              <Input
                placeholder="$50"
                className="h-11 w-full touch-manipulation md:pointer-fine:h-9"
                type="text"
                value={`$${formatWithCommas(customAmount)}`}
                disabled={isLoading}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9]/g, "");
                  setCustomAmount(val);
                }}
                aria-label="Custom purchase amount"
                aria-invalid={showMinAmountError || showMaxAmountError}
                aria-describedby={
                  showMinAmountError || showMaxAmountError
                    ? "custom-credit-amount-error"
                    : undefined
                }
                autoFocus
              />
              {showMinAmountError && (
                <p
                  id="custom-credit-amount-error"
                  role="alert"
                  className="mt-2 text-sm text-destructive"
                >
                  Minimum amount is ${MIN_CUSTOM_TOPUP_USD}
                </p>
              )}
              {showMaxAmountError && (
                <p
                  id="custom-credit-amount-error"
                  role="alert"
                  className="mt-2 text-sm text-destructive"
                >
                  Maximum amount is $999,999
                </p>
              )}
            </>
          )}
        </div>

        <div className="space-y-2">
          <hr className="mb-5 border-border" />
          <div className="flex justify-between text-sm">
            <span>{lineItemLabel}</span>
            <span className="tabular-nums">
              {formatTokens(totalTokens)} credits
            </span>
          </div>
          <div className="flex justify-between pt-2 text-sm font-medium">
            <span>Total due</span>
            <span>
              ${formatWithCommas(String(isValidAmount ? amountDollars : 0))}
            </span>
          </div>
        </div>

        {/* Payment method — card only, via LemonSqueezy's secure checkout. */}
        <div className="flex items-center gap-2 text-xs leading-5 text-muted-foreground">
          <CreditCard className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            You&apos;ll be redirected to a secure checkout for card payment.
          </span>
        </div>

        {errorMessage ? (
          <p
            role="alert"
            aria-live="assertive"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] leading-5 text-destructive"
          >
            {errorMessage}
          </p>
        ) : null}

        <Button
          onClick={handlePurchase}
          disabled={isLoading || !isValidAmount}
          aria-busy={isLoading}
          className="h-11 w-full touch-manipulation rounded-lg bg-primary text-[14px] font-semibold text-primary-foreground shadow-none transition-colors duration-(--duration-hover) hover:bg-primary/90 active:translate-y-px disabled:opacity-50 motion-reduce:transition-none"
        >
          {isLoading
            ? "Processing…"
            : isValidAmount
              ? `Pay $${amountDollars} with card`
              : "Add credits"}
        </Button>
      </div>
    </div>
  );
};

const BuyExtraUsageDialog = ({
  open,
  onOpenChange,
  onPurchase,
  isLoading,
  title = "Add credits",
  description = "Top up your credit balance. Bigger packs include bonus credits.",
  lineItemLabel = "Credits",
  errorMessage,
}: BuyExtraUsageDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-ui="buy-extra-usage-dialog"
        className="bottom-0 top-auto flex max-h-[calc(100dvh-env(safe-area-inset-top))] w-screen max-w-none translate-y-0 flex-col gap-0 overflow-hidden rounded-b-none rounded-t-xl border-x-0 border-b-0 p-0 sm:max-w-none md:bottom-auto md:top-1/2 md:max-h-[calc(100dvh-2rem)] md:w-full md:max-w-lg md:-translate-y-1/2 md:rounded-lg md:border md:p-4"
        showCloseButton={false}
      >
        <DialogClose
          disabled={isLoading}
          aria-label="Close credit purchase"
          className="absolute right-2 top-2 z-10 flex size-11 touch-manipulation items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 md:pointer-fine:size-8"
        >
          <X className="size-4" aria-hidden="true" />
        </DialogClose>
        {open && (
          <BuyExtraUsageDialogContent
            onPurchase={onPurchase}
            isLoading={isLoading}
            title={title}
            description={description}
            lineItemLabel={lineItemLabel}
            errorMessage={errorMessage}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};

export { BuyExtraUsageDialog };
