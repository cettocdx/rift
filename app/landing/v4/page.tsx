import type { Metadata } from "next";

import { MergedLanding } from "@/app/components/landing-v2/MergedLanding";

export const metadata: Metadata = {
  title: "RIFT — The agent workstation",
  description:
    "Plan, build, verify and ship from one surface. Real sandboxes, a real terminal, and the frontier models already wired in.",
  // Built alongside the live page rather than on top of it: a second session is
  // editing the same components, and a route of its own is the only way to
  // finish this one without the two overwriting each other. Out of the index
  // until it replaces /.
  robots: { index: false, follow: false },
};

export default function LandingV4Page() {
  return <MergedLanding />;
}
