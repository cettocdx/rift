import { DevLabGate } from "@/app/components/pro/DevLabGate";

export const metadata = {
  title: "RIFT Lab — Local Preview",
  robots: { index: false, follow: false },
};

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return <DevLabGate>{children}</DevLabGate>;
}
