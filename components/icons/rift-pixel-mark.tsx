import type { FC } from "react";
import { RiftLogo } from "./rift-logo";

interface RiftPixelMarkProps {
  size?: number;
  className?: string;
}

/**
 * Backwards-compatible alias for the canonical {@link RiftLogo}. Keeping this
 * wrapper means every legacy header and sidebar receives the same brand asset.
 */
export const RiftPixelMark: FC<RiftPixelMarkProps> = ({
  size = 38,
  className,
}) => <RiftLogo size={size} className={className} />;
