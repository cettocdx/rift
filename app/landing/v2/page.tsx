import type { Metadata } from "next";

import { LandingV2 } from "@/app/components/landing-v2/LandingV2";

export const metadata: Metadata = {
  title: "RIFT — The agent workstation",
  description:
    "Plan, build, verify and ship from one surface. Real sandboxes, a real terminal, and the frontier models already wired in.",
  // `/` is the canonical URL for this page now. This route stays available
  // for opening the page directly while it is worked on, and stays out of the
  // index so the two never compete for the same query.
  robots: { index: false, follow: false },
};

export default function LandingV2Page() {
  return <LandingV2 />;
}
