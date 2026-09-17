"use client";

import { Anthropic, Moonshot, OpenAI, Qwen, XAI, ZAI } from "@lobehub/icons";
import { motion, useReducedMotion } from "motion/react";
import type { ComponentType } from "react";

import { ModelFlow } from "./ModelFlow";
import { Reveal } from "./Reveal";

import { MICRO_LABEL_CLASS } from "./type-scale";

/**
 * Whose models Build runs on.
 *
 * Only the marks, no model names and no count. A named list dates the moment a
 * model is added or retired, and a headline number invites a comparison the
 * page cannot win — what matters is that the frontier labs are all here and you
 * are not choosing a vendor when you choose the tool.
 *
 * The marks come from a maintained icon set rather than being redrawn by hand,
 * and render in `currentColor` so the row stays monochrome instead of becoming
 * a strip of clashing brand palettes.
 */

type Vendor = {
  name: string;
  Logo: ComponentType<{ size?: number; className?: string }>;
};

const VENDORS: Vendor[] = [
  { name: "OpenAI", Logo: OpenAI },
  { name: "Anthropic", Logo: Anthropic },
  { name: "xAI", Logo: XAI },
  { name: "Moonshot AI", Logo: Moonshot },
  { name: "Alibaba", Logo: Qwen },
  { name: "Z.ai", Logo: ZAI },
];

export function BuildModels() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="mt-14">
      <Reveal>
        <p className={MICRO_LABEL_CLASS}>Runs on models from</p>
      </Reveal>

      {/* One column count, one cell shape. Every tile is the same height and
          holds the same two things, so the row reads as a set rather than as
          boxes that happened to land next to each other.
          Six columns because there are six vendors: at five, the last one
          dropped to a row of its own and the set stopped reading as a set. */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {VENDORS.map((vendor, index) => (
          <Reveal key={vendor.name} delay={index * 0.05} className="h-full">
            <motion.div
              whileHover={reduceMotion ? undefined : { y: -2 }}
              transition={{ type: "spring", bounce: 0, duration: 0.32 }}
              className="flex h-[104px] flex-col items-center justify-center gap-3 rounded-[8px] border border-border bg-[var(--surface,#0c0c0c)] px-3 text-foreground"
            >
              <vendor.Logo size={24} />
              <span className="text-center text-[12px] font-medium tracking-[-0.005em]">
                {vendor.name}
              </span>
            </motion.div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.28}>
        <ModelFlow />
      </Reveal>
    </div>
  );
}
