"use client";

import { ByteDance, Flux, Google, Kling, OpenAI, XAI } from "@lobehub/icons";
import { motion, useReducedMotion } from "motion/react";
import type { ComponentType } from "react";

import { Reveal } from "./Reveal";

import { MICRO_LABEL_CLASS } from "./type-scale";

/**
 * Whose generation models Studio runs on.
 *
 * Same treatment as the Build row, for the same reason: naming every model
 * dates the page the first time one is added or retired, and the argument is
 * not how many there are — it is that they are all here, behind one prompt box,
 * on one bill.
 */

type Vendor = {
  name: string;
  Logo: ComponentType<{ size?: number; className?: string }>;
};

const VENDORS: Vendor[] = [
  { name: "OpenAI", Logo: OpenAI },
  { name: "Google", Logo: Google },
  { name: "Black Forest Labs", Logo: Flux },
  { name: "ByteDance", Logo: ByteDance },
  { name: "Kling", Logo: Kling },
  { name: "xAI", Logo: XAI },
];

export function StudioVendors() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="mt-14">
      <Reveal>
        <p className={MICRO_LABEL_CLASS}>Generates with models from</p>
      </Reveal>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {VENDORS.map((vendor, index) => (
          <Reveal key={vendor.name} delay={index * 0.05} className="h-full">
            <motion.div
              whileHover={reduceMotion ? undefined : { y: -2 }}
              transition={{ type: "spring", bounce: 0, duration: 0.32 }}
              // Same fixed height as the Build row, so the two sets read as one
              // system rather than two differently sized grids.
              className="flex h-[104px] flex-col items-center justify-center gap-3 rounded-[8px] border border-border bg-[var(--surface,#0c0c0c)] px-3 text-foreground"
            >
              <vendor.Logo size={24} />
              <span className="text-center text-[12px] font-medium leading-[1.3] tracking-[-0.005em]">
                {vendor.name}
              </span>
            </motion.div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
