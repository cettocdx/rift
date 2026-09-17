import type { Metadata } from "next";

import { HLanding } from "@/app/components/landing-h/HLanding";

const TITLE = "RIFT — Building real software. Fast.";
const DESCRIPTION =
  "The agent workstation. Give it the work and it builds on a real machine — filesystem, terminal, every frontier model — proves it, and hands back something that runs.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    url: "/landing/h",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: { index: false, follow: false },
};

export default function HLandingPage() {
  return <HLanding />;
}
