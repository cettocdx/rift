import type { FC } from "react";
import {
  RIFT_WORDMARK_PATHS,
  RIFT_WORDMARK_TRANSFORM,
  RIFT_WORDMARK_VIEWBOX,
} from "@/lib/brand/logo";

export interface RiftWordmarkProps {
  /** Height of the supplied vector canvas, including its clear space. */
  height?: number;
  className?: string;
  fill?: string;
  decorative?: boolean;
  showTagline?: boolean;
  tagline?: string;
  taglineClassName?: string;
  title?: string;
}

/** Approved outlined lettering; no font installation or replacement is needed. */
export const RiftWordmark: FC<RiftWordmarkProps> = ({
  height = 24,
  className,
  fill = "currentColor",
  decorative = false,
  showTagline = false,
  tagline = "autonomous offensive intelligence",
  taglineClassName,
  title = "RIFT",
}) => {
  const word = (
    <svg
      width={(height * 287) / 152}
      height={height}
      viewBox={RIFT_WORDMARK_VIEWBOX}
      fill={fill}
      fillRule="evenodd"
      focusable="false"
      className={showTagline ? undefined : className}
      role={decorative || showTagline ? undefined : "img"}
      aria-label={decorative || showTagline ? undefined : title}
      aria-hidden={decorative || showTagline || undefined}
    >
      <g transform={RIFT_WORDMARK_TRANSFORM}>
        {RIFT_WORDMARK_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
  return showTagline ? (
    <span
      className={`inline-flex flex-col items-center ${className ?? ""}`}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative || undefined}
    >
      {word}
      <span
        className={taglineClassName ?? "text-muted-foreground"}
        style={{ fontSize: Math.max(8, height * 0.4), marginTop: 4 }}
      >
        {tagline}
      </span>
    </span>
  ) : (
    word
  );
};
