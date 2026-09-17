import type { Metadata } from "next";
import { PrimeLanding } from "@/app/components/landing-prime/PrimeLanding";
export const metadata: Metadata = {
  title: "RIFT — Your next idea. Already in motion.",
  description:
    "Build software, create media and review your systems in one agent workspace.",
};
export default function LandingPage() {
  return <PrimeLanding />;
}
