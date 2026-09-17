"use client";

import React, { useState } from "react";
import { mockBillingQueryArgs } from "@/lib/billing/mock-billing";
import { useAuth, type AuthUser } from "@/app/hooks/useAuth";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  LogOut,
  LifeBuoy,
  ChevronDown,
  ChevronsUpDown,
  MoreHorizontal,
  Settings,
  Download,
  Gift,
  X,
  Gem,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useGlobalState } from "@/app/contexts/GlobalState";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { clientLogout } from "@/lib/utils/logout";
import { useAuthActions } from "@convex-dev/auth/react";
import { useSettingsNavigation } from "@/app/components/settings/useSettingsNavigation";
import { ReferralRewardDialog } from "./ReferralRewardDialog";
import { formatBalanceTokens } from "@/lib/billing/token-display";
import { RiftPixelMark } from "@/components/icons/rift-pixel-mark";
import { MonthlyUsageSummary } from "./usage/MonthlyUsageSummary";
import type { SubscriptionTier } from "@/types";

import { toast } from "sonner";

/*
 * A row in the account menu.
 *
 * The menu inherited the primitive's 14px row with a full-strength foreground
 * icon, which put the heaviest type in the product inside its smallest surface
 * -- every glyph competed with its own label. 13px on a muted glyph is the step
 * the reference menu uses, and it matches the sidebar rows the menu opens from.
 */
const ACCOUNT_MENU_ITEM_CLASS =
  "h-8 gap-2 rounded-[6px] px-2 text-ui leading-5 [&_svg]:text-[var(--cursor-icon-secondary)]";

const NEXT_PUBLIC_HELP_CENTER_URL =
  process.env.NEXT_PUBLIC_HELP_CENTER_URL || "https://help.rift.co/en/";

const REFERRAL_CARD_DISMISSED_COOKIE = "referral_sidebar_dismissed";

type SidebarIdentityMode = "standard" | "name-only";

type SidebarIdentityUser = Pick<
  AuthUser,
  "email" | "firstName" | "lastName" | "name"
>;

const normalizeDisplayName = (value: string | null | undefined) =>
  value?.trim().replace(/\s+/g, " ") ?? "";

const isGenericDisplayName = (value: string) => value.toLowerCase() === "user";

const capitalizeEmailWord = (word: string) =>
  word ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : "";

/**
 * Prefer the exact profile name. Older accounts without one get a readable,
 * non-sensitive label from the local part of their existing email address.
 */
export const getSidebarDisplayName = (user: SidebarIdentityUser): string => {
  const profileName = normalizeDisplayName(user.name);
  if (profileName && !isGenericDisplayName(profileName)) return profileName;

  const splitProfileName = normalizeDisplayName(
    [user.firstName, user.lastName].filter(Boolean).join(" "),
  );
  if (splitProfileName && !isGenericDisplayName(splitProfileName)) {
    return splitProfileName;
  }

  const emailLocalPart = (user.email.split("@")[0] ?? "").split("+")[0];
  const readableEmailName = emailLocalPart
    .normalize("NFKC")
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(capitalizeEmailWord)
    .join(" ");

  return readableEmailName || "Account";
};

/** Current public plan names; legacy paid tiers stay in the Pro family. */
export const getSidebarPlanLabel = (
  subscription: SubscriptionTier,
): "Free" | "Pro" | "Max" => {
  if (subscription === "free") return "Free";
  if (subscription === "ultra") return "Max";
  return "Pro";
};

const readCookie = (name: string): string | null => {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(
      `(?:^|; )${name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1")}=([^;]*)`,
    ),
  );
  return match ? decodeURIComponent(match[1]) : null;
};

const writeCookie = (name: string, value: string, days: number) => {
  if (typeof document === "undefined") return;
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
};

const ReferralSidebarCard = ({
  isCollapsed,
  onOpen,
}: {
  isCollapsed: boolean;
  onOpen: () => void;
}) => {
  const [dismissed, setDismissed] = useState(
    () => readCookie(REFERRAL_CARD_DISMISSED_COOKIE) === "1",
  );

  if (dismissed) return null;

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    writeCookie(REFERRAL_CARD_DISMISSED_COOKIE, "1", 365);
    setDismissed(true);
  };

  if (isCollapsed) {
    return (
      <div className="mb-1">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="referral-button-collapsed"
                variant="secondary"
                size="sm"
                className="h-8 w-full border-0 px-2"
                onClick={onOpen}
                aria-label="Refer a friend"
              >
                <Gift className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Refer a friend</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  return (
    <div className="group/referral-card relative mb-2">
      <button
        type="button"
        onClick={onOpen}
        aria-label="Refer a friend and earn credits per paid referral"
        className="bg-muted/50 hover:bg-muted/80 border-sidebar-border flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 pr-9 text-left transition-colors focus-visible:outline-none"
      >
        <div className="bg-background/70 border-sidebar-border flex size-8 shrink-0 items-center justify-center rounded-full border">
          <Gift className="size-4" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-foreground truncate text-sm font-medium leading-none">
            Refer a friend
          </p>
          <p className="text-muted-foreground truncate text-xs">
            Earn credits per paid referral
          </p>
        </div>
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss referral card"
        title="Dismiss"
        className="bg-background/80 text-muted-foreground hover:bg-background hover:text-foreground border-sidebar-border absolute top-2 right-2 flex size-6 items-center justify-center rounded-full border opacity-100 shadow-sm transition-[opacity,colors] focus-visible:opacity-100 focus-visible:outline-none [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/referral-card:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
};

const GithubIcon = ({ className, ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} {...props}>
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);

const XIcon = ({ className, ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} {...props}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const SidebarUserNav = ({
  isCollapsed = false,
  identityMode = "standard",
}: {
  isCollapsed?: boolean;
  identityMode?: SidebarIdentityMode;
}) => {
  const { user } = useAuth();
  const { signOut } = useAuthActions();
  const { hrefFor } = useSettingsNavigation();
  const settingsHref = hrefFor(null);
  const {
    subscription,
    isCheckingProPlan = false,
    isSubscriptionReady = true,
  } = useGlobalState();
  const { resolvedTheme, setTheme } = useTheme();
  const [referralDialogOpen, setReferralDialogOpen] = useState(false);
  const isPaidUser = subscription !== "free";
  // Free / Pro / Pro-plus can still move up a tier; Max & Team can't.
  const canUpgradePlan =
    subscription === "free" ||
    subscription === "pro" ||
    subscription === "pro-plus";

  const extraUsageSettings = useQuery(
    api.extraUsage.getExtraUsageSettings,
    mockBillingQueryArgs(subscription),
  );
  const tokenBalancePoints = extraUsageSettings?.balancePoints ?? 0;

  if (!user) return null;

  // Determine if user has pro subscription

  const handleLogOut = async () => {
    try {
      // Clear the Convex Auth session (cookie + server state) first.
      await signOut();
    } catch {
      // ignore — still clear local state and redirect below
    }
    // Clear local drafts/model selection and land on the public home.
    clientLogout("/");
  };

  const handleHelpCenter = () => {
    const newWindow = window.open(
      NEXT_PUBLIC_HELP_CENTER_URL,
      "_blank",
      "noopener,noreferrer",
    );
    if (newWindow) {
      newWindow.opener = null;
    }
  };

  const handleGitHub = () => {
    const newWindow = window.open(
      "https://github.com/cettocdx/rift",
      "_blank",
      "noopener,noreferrer",
    );
    if (newWindow) {
      newWindow.opener = null;
    }
  };

  const handleXCom = () => {
    const newWindow = window.open(
      "https://x.com/rift_sys",
      "_blank",
      "noopener,noreferrer",
    );
    if (newWindow) {
      newWindow.opener = null;
    }
  };

  const getUserInitials = () => {
    const firstName = user.firstName?.charAt(0)?.toUpperCase() || "";
    const lastName = user.lastName?.charAt(0)?.toUpperCase() || "";
    if (firstName && lastName) {
      return firstName + lastName;
    }
    if (firstName) {
      return firstName;
    }
    if (lastName) {
      return lastName;
    }
    return user.email?.charAt(0)?.toUpperCase() || "U";
  };

  const displayName = getSidebarDisplayName(user);
  const membershipReady = isSubscriptionReady && !isCheckingProPlan;
  const membershipLabel = membershipReady
    ? getSidebarPlanLabel(subscription)
    : "…";

  const tokenBalanceLabel =
    subscription === "team"
      ? "Team · unlimited"
      : extraUsageSettings === undefined
        ? "··· tokens"
        : `${formatBalanceTokens(tokenBalancePoints)} tokens`;

  const sessionDockMenu = (
    <>
      <DropdownMenuLabel className="px-2 pb-1 pt-1.5 font-normal">
        <p
          data-testid="user-email"
          className="min-w-0 truncate text-ui-label leading-4 text-muted-foreground"
        >
          {user.email}
        </p>
      </DropdownMenuLabel>

      <DropdownMenuSeparator />

      {canUpgradePlan && (
        <DropdownMenuItem
          data-testid="upgrade-plan-button"
          onSelect={() => {
            window.location.href = "/upgrade";
          }}
          className={ACCOUNT_MENU_ITEM_CLASS}
        >
          <span className="flex size-[18px] items-center justify-center rounded-md bg-gradient-to-br from-[var(--signal-bright)] to-primary shadow-sm">
            <Gem className="size-[11px] text-white" strokeWidth={2} />
          </span>
          <span className="font-medium">Upgrade plan</span>
        </DropdownMenuItem>
      )}

      {isPaidUser && (
        <DropdownMenuItem
          data-testid="referral-menu-item"
          onSelect={() => setReferralDialogOpen(true)}
          className={ACCOUNT_MENU_ITEM_CLASS}
        >
          <Gift
            className="size-[15px] text-[var(--cursor-icon-secondary)]"
            strokeWidth={1.6}
          />
          <span>Refer a friend</span>
        </DropdownMenuItem>
      )}

      <DropdownMenuItem
        data-testid="settings-button"
        asChild
        className={ACCOUNT_MENU_ITEM_CLASS}
      >
        <Link href={settingsHref}>
          <Settings
            className="size-[15px] text-[var(--cursor-icon-secondary)]"
            strokeWidth={1.6}
          />
          <span>Settings</span>
        </Link>
      </DropdownMenuItem>

      <DropdownMenuItem
        data-testid="theme-toggle"
        onSelect={(e) => {
          e.preventDefault();
          setTheme(resolvedTheme === "dark" ? "light" : "dark");
        }}
        className={ACCOUNT_MENU_ITEM_CLASS}
      >
        {resolvedTheme === "dark" ? (
          <Sun
            className="size-[15px] text-[var(--cursor-icon-secondary)]"
            strokeWidth={1.6}
          />
        ) : (
          <Moon
            className="size-[15px] text-[var(--cursor-icon-secondary)]"
            strokeWidth={1.6}
          />
        )}
        <span>{resolvedTheme === "dark" ? "Light mode" : "Dark mode"}</span>
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      <DropdownMenuItem
        data-testid="logout-button"
        onSelect={handleLogOut}
        className={ACCOUNT_MENU_ITEM_CLASS}
      >
        <LogOut
          className="size-[15px] text-[var(--cursor-icon-secondary)]"
          strokeWidth={1.6}
        />
        <span>Log out</span>
      </DropdownMenuItem>
    </>
  );

  return (
    <div
      className="relative"
      data-rift-account-footer={identityMode === "name-only" || undefined}
    >
      <ReferralRewardDialog
        open={referralDialogOpen}
        onOpenChange={setReferralDialogOpen}
      />

      <MonthlyUsageSummary
        isCollapsed={isCollapsed}
        subscription={subscription}
      />

      {isCollapsed ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              data-testid="user-menu-button-collapsed"
              type="button"
              className="flex w-full cursor-pointer items-center justify-center rounded-md p-2 transition-colors hover:bg-accent focus-visible:outline-none"
              aria-haspopup="menu"
              aria-label={`Session menu, ${tokenBalanceLabel}`}
            >
              <RiftPixelMark size={26} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-[240px] rounded-xl py-1"
            align="center"
            side="top"
            sideOffset={4}
          >
            {sessionDockMenu}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              data-testid="user-menu-button"
              type="button"
              className="flex w-full items-center gap-2.5 rounded-[12px] p-1.5 text-left transition-colors duration-(--duration-hover) hover:bg-accent focus-visible:outline-none active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
              aria-haspopup="menu"
              aria-label={`Account menu for ${displayName}${
                identityMode === "name-only" && membershipReady
                  ? `, ${membershipLabel}`
                  : ""
              }`}
            >
              {identityMode === "name-only" ? (
                /* The reference editor's own account row: a round avatar,
                   the name with the plan stacked under it in the quiet ink,
                   and an overflow ellipsis at the far edge. Two quiet lines,
                   not one strung-out one -- the plan is a fact about the
                   account, and under the name is where that app files it. */
                <span className="flex min-w-0 flex-1 items-center gap-2.5 pl-0.5 pr-1">
                  <Avatar className="size-6 shrink-0">
                    <AvatarImage
                      src={user.profilePictureUrl ?? undefined}
                      alt=""
                    />
                    <AvatarFallback className="bg-muted text-[10px] font-normal text-foreground">
                      {getUserInitials()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-1 flex-col text-left">
                    <span
                      data-testid="sidebar-user-display-name"
                      className="min-w-0 truncate text-ui-nav font-[418] leading-[18px] text-foreground"
                      title={displayName}
                    >
                      {displayName}
                    </span>
                    <span
                      data-testid="sidebar-membership-tier"
                      aria-label={
                        membershipReady
                          ? `${membershipLabel} membership`
                          : "Membership loading"
                      }
                      className="min-w-0 truncate text-ui-label font-[418] leading-4 text-muted-foreground"
                    >
                      {membershipLabel}
                    </span>
                  </span>
                  <MoreHorizontal className="size-4 shrink-0 text-[var(--cursor-icon-secondary)]" />
                </span>
              ) : (
                <>
                  <Avatar className="size-8 shrink-0">
                    <AvatarImage
                      src={user.profilePictureUrl ?? undefined}
                      alt={displayName}
                    />
                    <AvatarFallback className="bg-muted text-ui-caption font-medium text-foreground">
                      {getUserInitials()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ui-nav font-[418] leading-[18px] text-foreground">
                      {displayName}
                    </p>
                    <p
                      data-testid="sidebar-user-email"
                      className="truncate text-ui-caption leading-tight text-muted-foreground"
                    >
                      {user.email}
                    </p>
                  </div>
                  <ChevronsUpDown className="size-4 shrink-0 text-[var(--cursor-icon-secondary)]" />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[240px] rounded-xl py-1"
            align="center"
            side="top"
            sideOffset={8}
          >
            {sessionDockMenu}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};

export default SidebarUserNav;
