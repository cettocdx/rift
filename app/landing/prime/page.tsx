import type { Metadata } from "next";
import { PrimeLanding } from "@/app/components/landing-prime/PrimeLanding";
export const metadata: Metadata = {
  title: "RIFT — Your next idea. Already in motion.",
  description:
    "Build software. Create media. Test your systems. One AI workspace to take it all further.",
};
export default function Page() {
  return <PrimeLanding />;
}
