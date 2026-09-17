import { RootShellPresence } from "@/app/components/RootShellPresence";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { RiftPixelMark } from "@/components/icons/rift-pixel-mark";

export default function LabHubPage() {
  return (
    <div className="pro-shell flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
      <RootShellPresence kind="pro" />
      <div
        className="pro-shell-bg pointer-events-none fixed inset-0"
        aria-hidden
      />
      <div className="relative z-10 flex flex-col items-center gap-4">
        <RiftPixelMark size={56} />
        <h1 className="text-2xl font-medium tracking-tight">RIFT Pro Lab</h1>
        <p className="max-w-md text-[14px] text-muted-foreground">
          Dev-only preview. Cursor-grade UI on localhost — production stays
          untouched.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <Link
            href="/lab/landing"
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-5 py-2.5 text-[13px] hover:bg-white/[0.04]"
          >
            Marketing landing <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/lab/app"
            className="inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-2.5 text-[13px] font-medium text-background"
          >
            Open app <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-5 py-2.5 text-[13px] text-muted-foreground"
          >
            Production UI
          </Link>
        </div>
      </div>
    </div>
  );
}
