"use client";

import { cn } from "@/lib/utils";
import {
  type CSSProperties,
  type ElementType,
  createElement,
  memo,
} from "react";

export interface TextShimmerProps {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
  /** Unused since the rainbow rework; kept so existing call sites compile. */
  spread?: number;
}

/** Shared neutral light sweep for transient work and context-compaction labels. */
const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
}: TextShimmerProps) => {
  return createElement(
    Component,
    {
      className: cn("relative inline-block rift-thinking-shimmer", className),
      style: {
        animationDuration: `${duration}s`,
      } as CSSProperties,
    },
    children,
  );
};

export const Shimmer = memo(ShimmerComponent);
