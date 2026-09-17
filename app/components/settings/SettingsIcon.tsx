"use client";

import {
  Bot,
  CircleUserRound,
  CreditCard,
  KeyRound,
  Keyboard,
  Palette,
  PanelsTopLeft,
  Settings2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { SettingsIconId } from "@/lib/settings/registry";

/**
 * The registry names an icon; this resolves the name. Keeping the mapping here
 * is what lets the registry stay importable by server components and by a test
 * with no DOM.
 */
const ICONS: Record<SettingsIconId, LucideIcon> = {
  general: Settings2,
  appearance: Palette,
  workbench: PanelsTopLeft,
  agents: Bot,
  "api-keys": KeyRound,
  privacy: ShieldCheck,
  billing: CreditCard,
  keyboard: Keyboard,
  account: CircleUserRound,
};

export function SettingsIcon({
  icon,
  className,
}: {
  icon: SettingsIconId;
  className?: string;
}) {
  const Icon = ICONS[icon];
  return <Icon aria-hidden className={className} strokeWidth={1.7} />;
}
