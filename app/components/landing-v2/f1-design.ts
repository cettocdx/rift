import type { CSSProperties } from "react";

export const F1_PALETTE = {
  "--font-cursor-ui": '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  "--font-display": '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  "--font-sans": '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  "--font-mono":
    "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, monospace",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  "--background": "#080808",
  "--foreground": "#F3F3EF",
  "--surface": "#101010",
  "--border": "#282828",
  "--border-strong": "#3A3A3A",
  "--muted-foreground": "#A9A9A2",
  "--cursor-text-secondary": "#A9A9A2",
  "--primary": "#FF756A",
  "--signal-bright": "#FF756A",
  colorScheme: "dark",
} as CSSProperties;

export const F1_EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const F1_CONTAINER_CLASS =
  "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10";
export const F1_DISPLAY_CLASS =
  "text-[48px] leading-[0.96] tracking-[-0.025em] font-medium sm:text-[56px] lg:text-[72px] xl:text-[88px]";
export const F1_SECTION_TITLE_CLASS =
  "text-[34px] leading-[1.06] tracking-[-0.025em] font-medium sm:text-[40px] lg:text-[48px] xl:text-[54px]";
export const F1_LEAD_CLASS =
  "text-[17px] leading-[1.5] tracking-[-0.006em] text-foreground/70 lg:text-[18px]";
export const F1_BODY_CLASS = "text-[16px] leading-[1.55] text-foreground/65";
export const F1_LABEL_CLASS =
  "font-mono text-[11px] leading-[1.45] uppercase tracking-[0.1em] text-foreground/50";
export const F1_SECTION_CLASS = "py-14 sm:py-16 lg:py-24";
