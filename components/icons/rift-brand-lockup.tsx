import type { FC } from "react";
import { RIFT_SYMBOL_PATH, RIFT_WORDMARK_PATHS } from "@/lib/brand/logo";

export interface RiftBrandLockupProps {
  /** Canvas height. Package 11's horizontal proportions remain fixed. */
  markSize?: number;
  /** Legacy minimum letter height; never stretches the supplied lettering. */
  textSize?: number;
  /** Kept for compatibility; spacing comes from the approved horizontal asset. */
  gap?: number;
  className?: string;
  markClassName?: string;
  textClassName?: string;
  decorative?: boolean;
  label?: string;
}

/** Exact Package 11 horizontal lockup, with color inherited from its surface. */
export const RiftBrandLockup: FC<RiftBrandLockupProps> = ({
  markSize = 28,
  textSize = 14,
  className,
  markClassName,
  textClassName,
  decorative = false,
  label = "RIFT",
}) => {
  const height = Math.max(markSize, (textSize * 152) / 104);
  return (
    <svg
      width={(height * 428) / 152}
      height={height}
      viewBox="0 0 428 152"
      fill="currentColor"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      focusable="false"
      className={`shrink-0 select-none ${className ?? ""}`}
    >
      <g transform="translate(16 17) scale(1.2)" className={markClassName}>
        <path d={RIFT_SYMBOL_PATH} />
        <path d={RIFT_SYMBOL_PATH} transform="rotate(180 50 50)" />
      </g>
      <g
        transform="translate(165 27) scale(1)"
        fillRule="evenodd"
        className={textClassName}
      >
        {RIFT_WORDMARK_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
};
