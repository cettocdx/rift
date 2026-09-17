import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingPageRift3 } from "@/app/components/landing/LandingPageRift3";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function Rift3LandingPage() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.RIFT_ENABLE_LEGACY_LANDING_PREVIEWS !== "true"
  ) {
    notFound();
  }

  return (
    <div className="h-full overflow-y-auto">
      <LandingPageRift3 />
    </div>
  );
}
