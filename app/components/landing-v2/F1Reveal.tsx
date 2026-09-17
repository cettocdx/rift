"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { F1_EASE_OUT } from "./f1-design";

export function F1Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const revealClassName = [
    "motion-reduce:!transform-none",
    "motion-reduce:!opacity-100",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <motion.div
      data-f1-reveal
      className={revealClassName}
      initial={{ opacity: 0, transform: "translateY(16px)" }}
      whileInView={{ opacity: 1, transform: "translateY(0px)" }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{
        duration: 0.65,
        delay,
        ease: F1_EASE_OUT,
      }}
    >
      {children}
    </motion.div>
  );
}
