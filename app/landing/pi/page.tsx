import type { Metadata } from "next";

import { PrimeLanding } from "@/app/components/landing-pi/PrimeLanding";

export const metadata: Metadata = {
  title: "RIFT — The agent workstation",
  description:
    "Plan, build, verify and ship from one surface. Real sandboxes, a real terminal, and the frontier models already wired in.",
  // A second, parallel landing built from scratch in primeintellect.ai's
  // language, so the two can be compared side by side before either replaces
  // the other. Out of the index until that decision is made.
  robots: { index: false, follow: false },
};

export default function PrimeLandingPage() {
  return <PrimeLanding />;
}
