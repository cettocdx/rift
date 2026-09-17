import type { Metadata } from "next";

import { QuietLanding } from "@/app/components/landing-v3/QuietLanding";

/**
 * v2's landing page with one rendered object in the hero and a warmer, quieter
 * ground. Kept on its own route so the two treatments can be looked at side by
 * side without either having to win first.
 */
export const metadata: Metadata = {
  title: "RIFT — The agent workstation",
  description:
    "Plan, build, verify and ship from one surface. Real sandboxes, a real terminal, and the frontier models already wired in.",
  robots: { index: false, follow: false },
};

export default function LandingV3Page() {
  return <QuietLanding />;
}
