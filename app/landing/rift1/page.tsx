import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingPageRift1 } from "@/app/components/landing/LandingPageRift1";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function Rift1LandingPage() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.RIFT_ENABLE_LEGACY_LANDING_PREVIEWS !== "true"
  ) {
    notFound();
  }

  return (
    <div className="h-full overflow-y-auto">
      <LandingPageRift1 />
    </div>
  );
}
