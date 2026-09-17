import type { FC, SVGProps } from "react";
import {
  RIFT_SYMBOL_PATH,
  RIFT_SYMBOL_TRANSFORM,
  RIFT_SYMBOL_VIEWBOX,
} from "@/lib/brand/logo";

export interface RiftLogoProps extends SVGProps<SVGSVGElement> {
  size?: number;
  /** Legacy compatibility; the approved artwork is rendered without effects. */
  glow?: boolean;
}

/** Package 11 symbol, including its original proportions and clear space. */
export const RiftLogo: FC<RiftLogoProps> = ({
  size = 38,
  glow: _glow,
  className,
  ...props
}) => (
  <svg
    width={size}
    height={size}
    viewBox={RIFT_SYMBOL_VIEWBOX}
    role="img"
    aria-label="RIFT"
    focusable="false"
    fill="currentColor"
    shapeRendering="geometricPrecision"
    className={`select-none ${className ?? ""}`}
    {...props}
  >
    <g transform={RIFT_SYMBOL_TRANSFORM}>
      <path d={RIFT_SYMBOL_PATH} />
      <path d={RIFT_SYMBOL_PATH} transform="rotate(180 50 50)" />
    </g>
  </svg>
);
