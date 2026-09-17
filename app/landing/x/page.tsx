import type { Metadata } from "next";

import { XLanding } from "@/app/components/landing-x/XLanding";

// No leading "RIFT — ": the root title template is "%s | RIFT", so a "RIFT"
// prefix here renders "RIFT — … | RIFT". The template supplies the brand.
const TITLE = "Give it the work. Get it shipped.";
// Under ~160 chars so it is not truncated in a SERP snippet.
const DESCRIPTION =
  "RIFT runs a frontier agent on a real machine — filesystem, package manager, terminal — and builds and runs the work before it says done.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  /*
   * Share cards. The image is app/landing/x/opengraph-image.tsx — a real
   * 1200x630 rendered from code in the page's own palette. It replaced a
   * metadata reference to a webp that had been deleted with the scale band's
   * photograph, so every share of this index=false URL rendered a grey box.
   * Next uses the file-based image for both og and twitter; declaring images
   * here again would only reintroduce a path that can rot.
   */
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    url: "/landing/x",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  // Out of the index until one of the three parallel builds replaces /.
  robots: { index: false, follow: false },
};

export default function XLandingPage() {
  return <XLanding />;
}
