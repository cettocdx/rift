"use client";

import { ArrowLeft, Check } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  MarketingBody,
  MarketingPage,
} from "@/app/components/marketing/MarketingPage";
import {
  X_CAPTION,
  X_LABEL,
  X_SECTION,
} from "@/app/components/landing-x/x-system";
import { RiftBrandLockup } from "@/components/icons/rift-brand-lockup";
import { DownloadSection } from "./DownloadSection";
import { desktopReleaseStatus, downloadLinks } from "./constants";
import { AppleIcon, DownloadIcon, WindowsIcon } from "./icons";

function DownloadContent() {
  return (
    <div>
      <div>
        {/*
         * One hero, not two.
         *
         * This page rendered the shell's title — "RIFT on your machine." — and
         * then its own h1, "Take RIFT beyond the browser.", directly beneath
         * it: two competing headlines and two h1s in one document. The shell's
         * is the one that stays, because every other public page's title comes
         * from the same place.
         */}
        <section
          aria-label="Get RIFT"
          className="grid gap-10 pb-12 sm:pb-16 lg:grid-cols-[minmax(0,0.82fr)_minmax(440px,1.18fr)] lg:items-start lg:gap-14"
        >
          <div className="min-w-0 lg:pt-1">
            <p className={X_LABEL}>Desktop</p>
            <p className={`${X_CAPTION} mt-5 max-w-[46ch]`}>
              Install the desktop app for focused builds and local workflows, or
              add RIFT to your mobile home screen. Linux and anything else keeps
              working in the browser with nothing to install.
            </p>
          </div>

          <div
            aria-labelledby="download-options-title"
            className="min-w-0 rounded-[16px] border-[0.5px] border-[var(--x-line-soft)] bg-[var(--x-raise)] p-4 sm:p-5"
          >
            <div className="px-1 pb-4 sm:px-2">
              <h2
                id="download-options-title"
                className="text-[18px] font-medium tracking-[-0.025em] text-[var(--foreground)]"
              >
                Download now
              </h2>
              <p className="mt-1 text-[12px] leading-5 text-[var(--muted-foreground)]">
                Your device is detected automatically. The macOS direct build is
                available now; Windows remains in progress.
              </p>
            </div>

            <DownloadSection />

            <section
              id="desktop-downloads"
              aria-labelledby="desktop-downloads-title"
              className="mt-4 scroll-mt-28 rounded-[12px] border-[0.5px] border-[var(--x-line)] bg-[var(--x-ground)] p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3
                    id="desktop-downloads-title"
                    className="text-[14px] font-medium tracking-[-0.02em] text-[var(--foreground)]"
                  >
                    All desktop installers
                  </h3>
                  <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                    macOS direct build available
                  </p>
                </div>
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  Windows release pending
                </p>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <DownloadCard
                  title="macOS"
                  subtitle="Apple Silicon"
                  format="DMG"
                  href={downloadLinks.macos}
                  status={desktopReleaseStatus.macos}
                  icon={<AppleIcon className="size-5" />}
                />
                <DownloadCard
                  title="Windows"
                  subtitle="Windows 64-bit"
                  format="EXE"
                  href={downloadLinks.windows}
                  status={desktopReleaseStatus.windows}
                  icon={<WindowsIcon className="size-5" />}
                />
              </div>
            </section>
          </div>
        </section>

        <section
          aria-label="RIFT connected across the world"
          className="pb-12 sm:pb-16"
        >
          <div className="relative aspect-[4/3] overflow-hidden rounded-[20px] bg-black shadow-[0_50px_110px_-60px_rgba(0,0,0,0.45)] sm:aspect-[16/10] lg:aspect-[16/8.6]">
            <Image
              src="/landing/download/orbit-earth-4k.webp"
              alt="Earth at night seen from orbit beneath a space station, representing RIFT workspaces available wherever you build"
              fill
              loading="lazy"
              sizes="(min-width: 1280px) 1176px, (min-width: 768px) calc(100vw - 48px), calc(100vw - 32px)"
              className="object-cover object-[62%_center] sm:object-center"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(5,15,27,0.05),transparent_55%,rgba(5,15,27,0.18))]"
            />
          </div>
        </section>

        <section
          aria-labelledby="install-flow-title"
          className="grid gap-8 border-t-[0.5px] border-t-[var(--x-line)] py-12 sm:py-16 lg:grid-cols-[0.82fr_1.18fr] lg:gap-16"
        >
          <div>
            <h2
              id="install-flow-title"
              className={`${X_SECTION} max-w-[20ch] text-balance text-[var(--x-ink)]`}
            >
              One account. The same working context.
            </h2>
          </div>

          <div>
            <p className={`${X_CAPTION} max-w-[62ch]`}>
              The macOS direct build uses the same RIFT account and project
              context as the browser app. It is not yet notarized, so macOS may
              ask you to approve the first launch in Privacy &amp; Security.
            </p>

            <dl className="mt-7 grid gap-5 sm:grid-cols-2">
              <ReleaseDetail title="macOS" value="Apple Silicon direct DMG" />
              <ReleaseDetail title="Windows" value="64-bit executable" />
            </dl>

            <p className="mt-7 flex max-w-[620px] items-start gap-2.5 text-[12px] leading-5 text-[var(--muted-foreground)]">
              <Check
                className="mt-0.5 size-4 shrink-0 text-[var(--signal-bright)]"
                strokeWidth={1.8}
                aria-hidden
              />
              Linux and unrecognized platforms can keep using RIFT in the
              browser without an installer.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

export function DownloadPageContent() {
  return (
    <MarketingPage
      eyebrow="Download"
      title="RIFT on your machine."
      lede="A direct build for macOS on Apple Silicon. Windows is in progress, and every other platform keeps working in the browser with nothing to install."
    >
      <MarketingBody>
        <DownloadContent />
      </MarketingBody>
    </MarketingPage>
  );
}

function DownloadCard({
  title,
  subtitle,
  format,
  href,
  status,
  icon,
}: {
  title: string;
  subtitle: string;
  format: string;
  href: string | null;
  status: string;
  icon: ReactNode;
}) {
  const statusId = title === "macOS" ? "macos-release-card-status" : undefined;
  const content = (
    <>
      <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-border bg-[var(--surface)] text-[var(--cursor-text-secondary)] transition-colors group-hover:text-[var(--foreground)]">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-[var(--foreground)]">{title}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-[var(--muted-foreground)]">
          {subtitle}
        </p>
        <p className="mt-1.5 font-mono text-[10px] text-[var(--muted-foreground)]">{format}</p>
        <p id={statusId} className="mt-1 text-[10px] leading-4 text-[var(--muted-foreground)]">
          {status}
        </p>
      </div>
      {href ? (
        <DownloadIcon className="size-4 shrink-0 text-[var(--muted-foreground)] transition-colors group-hover:text-[var(--cursor-text-secondary)]" />
      ) : (
        <span className="shrink-0 rounded-full border border-border bg-[var(--surface)] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
          Pending
        </span>
      )}
    </>
  );

  const className =
    "group flex min-h-[92px] items-center gap-3 rounded-[12px] border border-border bg-[var(--surface)] p-3.5";

  return href ? (
    <a
      href={href}
      download={title === "macOS" ? "RIFT-0.1.0-macOS-arm64.dmg" : undefined}
      aria-label={`Download RIFT for ${title}, ${subtitle}, ${format}`}
      aria-describedby={statusId}
      className={`${className} cursor-pointer transition-[background-color,border-color,transform] duration-200 hover:border-[rgba(0,0,0,0.28)] hover:bg-[var(--x-raise)] active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--x-ink)]`}
    >
      {content}
    </a>
  ) : (
    <div
      aria-label={`RIFT for ${title}, ${subtitle}, ${format}: ${status}`}
      aria-disabled="true"
      className={`${className} opacity-80`}
    >
      {content}
    </div>
  );
}

function ReleaseDetail({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-[12px] border-[0.5px] border-[var(--x-line)] px-4 py-3.5">
      <dt className="text-[12px] font-medium text-[var(--foreground)]">{title}</dt>
      <dd className="mt-1 text-[12px] leading-5 text-[var(--muted-foreground)]">{value}</dd>
    </div>
  );
}
