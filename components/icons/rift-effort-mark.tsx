import type { SVGProps } from "react";
import { RiftLogo } from "./rift-logo";

/** Reasoning uses the same approved brand symbol as the rest of RIFT. */
export function RiftEffortMark({
  size = 16,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <RiftLogo
      size={size}
      aria-hidden="true"
      data-rift-mark="effort"
      {...props}
    />
  );
}
