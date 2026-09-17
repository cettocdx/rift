import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { HackSessionEntry } from "./HackSessionEntry";
import { RiftPixelMark } from "@/components/icons/rift-pixel-mark";
import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import { hasHackWorkbenchAccess } from "@/lib/auth/premium-access";
import { ChatSDKError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hack Workbench | RIFT",
  description:
    "RIFT Max's terminal workspace for authorized security assessments.",
};

// Immersive full-screen Hack Workbench. Authorization deliberately lives in
// this page (not only a layout or client component) and is repeated by the API.
const HACK_SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function HackPage({
  searchParams,
}: {
  searchParams: Promise<{
    session?: string | string[];
  }>;
}) {
  let access: Awaited<ReturnType<typeof getUserIDAndPro>>;

  try {
    access = await getUserIDAndPro();
  } catch (error) {
    if (error instanceof ChatSDKError && error.type === "unauthorized") {
      redirect("/login?redirect=/hack");
    }
    throw error;
  }

  if (!hasHackWorkbenchAccess(access.subscription)) {
    return <MaxHackGate />;
  }

  const query = await searchParams;
  const requestedSession = Array.isArray(query.session)
    ? query.session[0]
    : query.session;
  const validSession =
    requestedSession && HACK_SESSION_ID.test(requestedSession)
      ? requestedSession
      : undefined;
  return (
    <HackSessionEntry
      key={access.userId}
      accountId={access.userId}
      requestedSession={validSession}
      durableEnabled={
        process.env.RIFT_DURABLE_HACK_ENABLED === "true" &&
        process.env.RIFT_DURABLE_DISPATCH_ADMISSION === "true"
      }
    />
  );
}

function MaxHackGate() {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#080b10] px-5 py-12 font-sans text-[#ecf2f7]">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(circle at 50% 0%, rgba(43, 183, 255, 0.13), transparent 38%), linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px)",
          backgroundSize: "auto, 32px 32px, 32px 32px",
        }}
      />

      <section className="relative w-full max-w-[660px] overflow-hidden rounded-xl border border-white/10 bg-[#0d1117]/95 shadow-2xl shadow-black/40">
        <div className="flex h-11 items-center justify-between border-b border-white/10 px-4 text-[11px] text-white/45">
          <Link
            href="/"
            className="inline-flex items-center gap-2 transition-colors hover:text-white"
          >
            <ArrowLeft className="size-3.5" />
            Back to RIFT
          </Link>
          <span className="tracking-[0.14em]">MAX EXCLUSIVE</span>
        </div>

        <div className="px-6 py-9 sm:px-10 sm:py-11">
          <div className="flex items-center gap-3">
            <RiftPixelMark size={40} />
            <span className="rounded border border-sky-300/20 bg-sky-300/[0.06] px-2 py-1 text-[9px] tracking-[0.16em] text-sky-200">
              HACK WORKBENCH
            </span>
          </div>

          <div className="mt-8 flex size-11 items-center justify-center rounded-lg border border-sky-300/20 bg-sky-300/[0.06] text-sky-200">
            <LockKeyhole className="size-5" strokeWidth={1.5} />
          </div>
          <h1 className="mt-5 rift-page-title text-white">RIFT Max required</h1>
          <p className="mt-3 max-w-xl font-sans text-[14px] leading-6 text-white/58">
            Hack Workbench is the focused terminal workspace for authorized
            recon, tool execution, live evidence, and report generation. It is
            available exclusively with RIFT Max at $129 per month.
          </p>

          <div className="mt-7 grid gap-2.5 sm:grid-cols-2">
            {[
              "Isolated security toolchain",
              "Live terminal execution trace",
              "Evidence-backed final reports",
              "Full assessment task library",
            ].map((feature) => (
              <div
                key={feature}
                className="flex items-center gap-2.5 rounded-md border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 font-sans text-[12.5px] text-white/65"
              >
                <ShieldCheck
                  className="size-3.5 shrink-0 text-sky-300"
                  strokeWidth={1.5}
                />
                {feature}
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-col gap-3 border-t border-white/[0.08] pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-sans text-[12px] text-white/38">
              Your current plan remains unchanged until checkout is complete.
            </p>
            <Link
              href="/upgrade?feature=hack"
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-sky-300 px-4 font-sans text-[12.5px] font-semibold text-[#071018] transition-colors hover:bg-sky-200"
            >
              Upgrade to Max
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
