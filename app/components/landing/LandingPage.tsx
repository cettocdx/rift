"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown, Download } from "lucide-react";

import { navigateToAuth } from "@/app/hooks/useTauri";
import { buildAuthLink } from "@/lib/routing/auth-link";
import { RiftBrandLockup } from "@/components/icons/rift-brand-lockup";
import { BUILD_MODELS, IMAGE_MODELS, VIDEO_MODELS } from "@/types/chat";
import { getFreeRequestLimit } from "@/lib/rate-limit/free-config";

import { LandingHeader } from "./LandingHeader";
import {
  LandingCountUp,
  LandingReveal,
  LandingSequenceText,
} from "./LandingMotion";

const LANDING_THEME: CSSProperties = {
  // Same face as the workspace, so signing up does not change the typeface.
  ["--font-rift-ui" as string]:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", ui-sans-serif, sans-serif',
  ["--font-sans" as string]: "var(--font-rift-ui)",
  ["--cursor-font-weight-normal" as string]: "418",
  ["--cursor-font-weight-medium" as string]: "500",
  ["--cursor-font-weight-semibold" as string]: "600",
  ["--background" as string]: "#070a10",
  ["--foreground" as string]: "#f6f7fb",
  ["--muted-foreground" as string]: "#a8afbc",
  ["--card" as string]: "#0d111a",
  ["--popover" as string]: "#0d111a",
  ["--border" as string]: "#252b38",
  ["--surface-1" as string]: "#111724",
  ["--surface-2" as string]: "#171d2b",
  ["--signal" as string]: "#3159e8",
  ["--primary" as string]: "#3159e8",
  colorScheme: "dark",
};

const FOCUS = "focus-visible:outline-none";
const DARK_FOCUS = "focus-visible:outline-none";

const CAPTURES = {
  build: "/landing/product/build-product-design-4k.webp",
  studio: "/landing/product/studio-4k.webp",
  agents: "/landing/product/agents-4k.webp",
  appearance: "/landing/product/appearance-4k.webp",
  workbench: "/landing/product/workbench-4k.webp",
  workspace: "/landing/product/workspace-4k.webp",
} as const;

type BuildModelFamily = (typeof BUILD_MODELS)[number]["family"];

type BuildProviderMeta = {
  provider: string;
  familyLabel: string;
  logo: string;
  accent: string;
  surface: string;
  logoWidth: number;
  logoHeight: number;
};

const BUILD_PROVIDER_META = {
  OpenAI: {
    provider: "OpenAI",
    familyLabel: "GPT & Codex",
    logo: "/brands/providers/openai.svg",
    accent: "#111111",
    surface: "#f4f5f4",
    logoWidth: 30,
    logoHeight: 30,
  },
  Gemini: {
    provider: "Google",
    familyLabel: "Gemini",
    logo: "/brands/providers/gemini.svg",
    accent: "#4285f4",
    surface: "#eef4ff",
    logoWidth: 30,
    logoHeight: 30,
  },
  Claude: {
    provider: "Anthropic",
    familyLabel: "Claude",
    logo: "/brands/providers/anthropic.svg",
    accent: "#d97757",
    surface: "#fbf0ea",
    logoWidth: 32,
    logoHeight: 22,
  },
  Grok: {
    provider: "xAI",
    familyLabel: "Grok",
    logo: "/brands/providers/xai.svg",
    accent: "#0a0a0a",
    surface: "#f1f2f3",
    logoWidth: 32,
    logoHeight: 32,
  },
  Kimi: {
    provider: "Moonshot AI",
    familyLabel: "Kimi",
    logo: "/brands/providers/kimi.svg",
    accent: "#1783ff",
    surface: "#edf5ff",
    logoWidth: 28,
    logoHeight: 28,
  },
  Qwen: {
    provider: "Alibaba",
    familyLabel: "Qwen",
    logo: "/brands/providers/qwen.svg",
    accent: "#6950ef",
    surface: "#f1efff",
    logoWidth: 29,
    logoHeight: 29,
  },
  GLM: {
    provider: "Z.ai",
    familyLabel: "GLM",
    logo: "/brands/providers/zai.svg",
    accent: "#3859ff",
    surface: "#eef1ff",
    logoWidth: 29,
    logoHeight: 29,
  },
  Hunyuan: {
    provider: "Tencent",
    familyLabel: "Hunyuan",
    // No mark shipped for this provider yet; the family label carries it until
    // one is. An invented path would 404 in production.
    logo: "/brands/providers/zai.svg",
    accent: "#1478ff",
    surface: "#e9f2ff",
    logoWidth: 29,
    logoHeight: 29,
  },
} satisfies Record<BuildModelFamily, BuildProviderMeta>;

const STUDIO_SHOWCASE = [
  {
    src: "/studio/showcase-v3/image-gemini-pro-4k.webp",
    alt: "A cinematic desert architecture study generated in RIFT Studio",
    label: "Gemini image",
  },
  {
    src: "/studio/showcase-v3/image-grok-4k.webp",
    alt: "An orange camera robot in a rain-lit city generated in RIFT Studio",
    label: "Grok image",
  },
  {
    src: "/studio/showcase-v3/video-kling-4k.webp",
    alt: "A cinematic action sequence generated in RIFT Studio",
    label: "Kling video",
  },
] as const;

const BUILD_MODEL_GROUPS = Array.from(
  new Set(BUILD_MODELS.map((model) => model.family)),
).map((family) => ({
  family,
  models: BUILD_MODELS.filter((model) => model.family === family),
  provider: BUILD_PROVIDER_META[family],
}));

const IMAGE_MODEL_NAMES = IMAGE_MODELS.map((model) => model.name);
const VIDEO_MODEL_NAMES = VIDEO_MODELS.map((model) => model.name);

const BREADTH = [
  [BUILD_MODELS.length, "Build models"],
  [IMAGE_MODELS.length, "image models"],
  [VIDEO_MODELS.length, "video models"],
  [50, "security workflows"],
] as const;

const BUILD_WORKFLOW = [
  {
    title: "Understand the brief",
    body: "RIFT reads the goal, the existing repository and the constraints before changing the project.",
  },
  {
    title: "Prepare the right stack",
    body: "It finds relevant skills, selects tools and coordinates focused agents when the work benefits from parallel execution.",
  },
  {
    title: "Work in the open",
    body: "File edits, commands, public progress and the live application preview stay attached to one run.",
  },
  {
    title: "Prove the result",
    body: "Tests, type checks and production builds run before the finished files and evidence are handed back.",
  },
] as const;

const BUILD_CAPABILITIES = [
  "Full-stack applications and browser experiences",
  "Repository-aware edits and terminal execution",
  "Live preview while the application is built",
  "Skill discovery, tools and specialist agents",
  "Tests, type checks, builds and downloadable output",
] as const;

const WORKSPACE_SURFACES = [
  {
    name: "Agents",
    body: "Create focused teammates, share the project context and inspect every handoff.",
    tone: "bg-[#e5ebff]",
  },
  {
    name: "CLI Workspace",
    body: "Move between the conversation, repository and terminal without losing the active task.",
    tone: "bg-[#f8f8fa]",
  },
  {
    name: "Plugins",
    body: "Connect supported services from a dedicated catalog and keep credentials scoped to the integration.",
    tone: "bg-[#ede9ff]",
  },
  {
    name: "Tasks",
    body: "Follow long-running and resumable work from a clear task surface.",
    tone: "bg-[#f7e9df]",
  },
  {
    name: "Artifacts",
    body: "Keep generated files, previews and finished outputs connected to the run that created them.",
    tone: "bg-[#f8f8fa]",
  },
] as const;

const HACK_METRICS = [
  [50, "guided workflows"],
  [6, "assessment phases"],
  [100, "steps per run"],
  ["Live", "terminal evidence"],
] as const;

const HACK_CAPABILITIES = [
  {
    title: "Map the attack surface",
    body: "OSINT, DNS, subdomains, HTTP behavior, ports and services are organized before deeper validation begins.",
  },
  {
    title: "Orchestrate Kali tooling",
    body: "The RIFT security agent chooses a controlled tool chain for the authorized scope and keeps every command visible.",
  },
  {
    title: "Validate meaningful risk",
    body: "Web, API, identity, cloud, container, dependency and network checks produce bounded, reviewable evidence.",
  },
  {
    title: "Report and retest",
    body: "Findings, attack paths, remediation guidance, scan files and retest results stay in one assessment trail.",
  },
] as const;

type Plan = {
  name: string;
  price: string;
  cadence: string;
  blurb: string;
  features: readonly string[];
  recommended?: boolean;
};

const PLANS: readonly Plan[] = [
  {
    name: "Free",
    price: "$0",
    cadence: "forever",
    blurb: "Explore the workspace and complete your first agent run.",
    features: [
      `${getFreeRequestLimit()} questions a day`,
      "1 full agent run each month",
      "Build and Studio access",
      "Isolated cloud sandbox",
    ],
  },
  {
    name: "Pro",
    price: "$39",
    cadence: "per month",
    blurb: "For makers who build and create every week.",
    features: [
      "Everything in Free",
      "500,000 monthly credits",
      "All Build and Studio models",
      "Unlimited chats and projects",
      "Priority sandboxes",
    ],
    recommended: true,
  },
  {
    name: "Max",
    price: "$129",
    cadence: "per month",
    blurb: "For demanding technical work and authorized security teams.",
    features: [
      "Everything in Pro",
      "Exclusive Hack Workbench access",
      "1,800,000 monthly credits",
      "Personal API keys",
      "Highest limits and priority",
      "Early access to new tools",
    ],
  },
] as const;

const FAQ = [
  {
    question: "What is RIFT?",
    answer:
      "RIFT is one AI workspace for building software, generating media and running authorized security assessments.",
  },
  {
    question: "What does Build do?",
    answer:
      "Build can inspect a repository, write files, run commands, use project skills, coordinate agents, open a live preview and verify the result.",
  },
  {
    question: "Which models can I use?",
    answer:
      "The model catalog is shown directly from RIFT's active Build and Studio configuration, so the public list stays aligned with the product.",
  },
  {
    question: "Does Studio keep finished generations?",
    answer:
      "Yes. Finished image and video results remain visible in Studio and can be downloaded from their generation record.",
  },
  {
    question: "Who can use Hack Workbench?",
    answer:
      "Hack Workbench is exclusive to Max and is intended only for systems you own or are explicitly authorized to assess.",
  },
  {
    question: "Is my work private?",
    answer:
      "Sessions are scoped to your account and agent runs use isolated cloud sandboxes. See the Privacy Policy for current data-handling details.",
  },
  {
    question: "Do I need to install anything?",
    answer:
      "No. RIFT runs in your browser, with an optional desktop app for macOS and Windows.",
  },
] as const;

function PrimaryButton({
  children,
  onClick,
  dark = false,
}: {
  children: ReactNode;
  onClick: () => void;
  dark?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 py-2.5 text-[14px] font-semibold transition-[background-color,transform] duration-200 active:translate-y-px motion-reduce:transition-none ${
        dark
          ? `bg-[#f6f7fb] text-[#070a10] hover:bg-white ${DARK_FOCUS}`
          : `bg-[#3159e8] text-white hover:bg-[#284cc9] ${FOCUS}`
      }`}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center whitespace-nowrap rounded-full border border-white/20 bg-white/[0.08] px-5 py-2.5 text-[14px] font-semibold text-[#f6f7fb] transition-[border-color,background-color,transform] duration-200 hover:border-white/35 hover:bg-white/[0.13] active:translate-y-px motion-reduce:transition-none ${DARK_FOCUS}`}
    >
      {children}
    </button>
  );
}

function ProductCapture({
  src,
  alt,
  sizes,
  priority = false,
  className = "",
}: {
  src: string;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`relative aspect-video overflow-hidden rounded-[18px] border border-[#d8deea] bg-[#11151d] shadow-[0_24px_70px_rgba(18,28,52,0.16)] ${className}`}
    >
      <Image
        src={src}
        alt={alt}
        fill
        priority={priority}
        sizes={sizes}
        quality={86}
        className="object-cover"
      />
    </div>
  );
}

function PlanFeatures({ features }: { features: readonly string[] }) {
  return (
    <ul className="grid gap-2.5">
      {features.map((feature) => (
        <li
          key={feature}
          className="flex items-start gap-2.5 text-[14px] leading-5 text-[#565f70]"
        >
          <Check
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-[#3159e8]"
            strokeWidth={1.8}
          />
          <span>{feature}</span>
        </li>
      ))}
    </ul>
  );
}

function ModelNameList({ names }: { names: readonly string[] }) {
  return (
    <ul className="mt-4 flex flex-wrap gap-2" aria-label="Available models">
      {names.map((name) => (
        <li
          key={name}
          className="rounded-full border border-white/[0.13] bg-white/[0.06] px-3 py-2 text-[12px] font-medium leading-4 text-[#d8deea]"
        >
          {name}
        </li>
      ))}
    </ul>
  );
}

export function LandingPage({
  authReturnPath,
}: { authReturnPath?: string } = {}) {
  const launch = () =>
    navigateToAuth(buildAuthLink("/signup", authReturnPath), {
      preferSignInForReturningUser: true,
    });

  const scrollTo = (id: string) => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    document.getElementById(id)?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
  };

  useEffect(() => {
    const checkHash = () => {
      if (window.location.hash === "#team-pricing-seat-selection") {
        void navigateToAuth(
          buildAuthLink("/signup", authReturnPath, { intent: "pricing" }),
          { preferSignInForReturningUser: true },
        );
      }
    };

    checkHash();
    window.addEventListener("hashchange", checkHash);
    return () => window.removeEventListener("hashchange", checkHash);
  }, [authReturnPath]);

  return (
    <div
      style={LANDING_THEME}
      className="min-h-full overflow-x-hidden bg-[#070a10] font-sans text-[#f6f7fb] selection:bg-[#7658ff] selection:text-white"
    >
      <LandingHeader authReturnPath={authReturnPath} />

      <main id="landing-main" tabIndex={-1} className="scroll-mt-6">
        <section className="bg-[#070a10] px-3 pb-2 sm:px-5 sm:pb-4 lg:px-7">
          <div className="relative mx-auto aspect-[4/5] max-w-[1500px] overflow-hidden rounded-[22px] border border-white/[0.1] bg-[#0b0f18] sm:aspect-[16/10] lg:aspect-[16/8.6]">
            <picture className="absolute inset-0 block size-full">
              <source
                media="(max-width: 767px)"
                srcSet="/landing/brand/rift-flight-mobile.webp"
              />
              <Image
                src="/landing/brand/rift-flight-4k.webp"
                alt="A crystalline bird crossing a luminous rift in deep space"
                width={3840}
                height={2160}
                priority
                fetchPriority="high"
                sizes="(max-width: 767px) calc(100vw - 1.5rem), (max-width: 1536px) calc(100vw - 2.5rem), 1500px"
                quality={86}
                className="size-full object-cover object-[60%_center] sm:object-center"
              />
            </picture>

            <div
              aria-hidden="true"
              className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,10,16,0.94)_0%,rgba(7,10,16,0.72)_36%,rgba(7,10,16,0.12)_72%),linear-gradient(0deg,rgba(7,10,16,0.82)_0%,transparent_56%)] sm:bg-[linear-gradient(90deg,rgba(7,10,16,0.94)_0%,rgba(7,10,16,0.7)_35%,rgba(7,10,16,0.06)_72%),linear-gradient(0deg,rgba(7,10,16,0.7)_0%,transparent_50%)]"
            />

            <div className="relative z-10 flex size-full items-end px-5 pb-7 pt-16 sm:px-9 sm:pb-10 lg:px-14 lg:pb-14">
              <div className="max-w-[42rem]">
                <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8bd7ff] sm:text-[12px]">
                  Software, media and security
                </p>
                <h1 className="max-w-[12ch] text-[clamp(3rem,6.4vw,6.7rem)] font-semibold leading-[0.9] tracking-[-0.065em] text-[#f6f7fb] text-balance">
                  <LandingSequenceText text="Build what comes next." />
                </h1>
                <p className="mt-5 max-w-[35rem] text-[15px] leading-6 text-[#cbd2de] sm:mt-6 sm:text-[18px] sm:leading-7">
                  Create software, direct frontier media models, and run
                  authorized security work from one exacting AI workspace.
                </p>
                <div className="mt-7 flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-center sm:mt-8">
                  <PrimaryButton dark onClick={launch}>
                    Start building
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4"
                      strokeWidth={1.8}
                    />
                  </PrimaryButton>
                  <SecondaryButton onClick={() => scrollTo("how")}>
                    See the workflow
                  </SecondaryButton>
                </div>
              </div>
            </div>
          </div>

          <dl className="mx-auto grid max-w-[1500px] grid-cols-2 border-x border-b border-white/[0.09] bg-[#0b0f18] px-5 sm:px-8 lg:grid-cols-4 lg:px-10">
            {BREADTH.map(([value, label], index) => (
              <div
                key={label}
                className={`py-5 sm:py-6 ${
                  index % 2 === 1
                    ? "border-l border-white/[0.09] pl-5 sm:pl-7"
                    : "pr-5 sm:pr-7"
                } ${
                  index > 1 ? "border-t border-white/[0.09] lg:border-t-0" : ""
                } ${
                  index > 1 && index % 2 === 0
                    ? "lg:border-l lg:border-white/[0.09] lg:pl-7"
                    : ""
                }`}
              >
                <dt className="text-3xl font-semibold tracking-[-0.04em] text-[#f6f7fb]">
                  <LandingCountUp value={value} />
                </dt>
                <dd className="mt-1 text-[13px] leading-5 text-[#8e98a8]">
                  {label}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          id="how"
          className="scroll-mt-6 bg-[#f6f7fb] py-20 text-[#161a23] sm:py-28"
        >
          <div className="mx-auto max-w-[1280px] px-5 sm:px-7 lg:px-10">
            <LandingReveal className="max-w-[49rem]">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#3159e8]">
                Build
              </p>
              <h2 className="text-4xl font-semibold tracking-[-0.05em] text-balance sm:text-6xl sm:leading-[1.02]">
                A request becomes a tested, working product.
              </h2>
              <p className="mt-5 max-w-[42rem] text-[16px] leading-7 text-[#525c6d]">
                Build plans against your repository, edits real files, runs the
                stack, opens a live preview and proves the result before
                handoff.
              </p>
            </LandingReveal>

            <LandingReveal delay={80}>
              <ol className="mt-12 grid border-y border-[#d5dbe5] md:grid-cols-2 lg:grid-cols-4">
                {BUILD_WORKFLOW.map(({ title, body }, index) => (
                  <li
                    key={title}
                    className={`py-6 md:px-6 lg:py-8 ${
                      index % 2 === 1 ? "md:border-l md:border-[#d5dbe5]" : ""
                    } ${
                      index > 1 ? "border-t border-[#d5dbe5] lg:border-t-0" : ""
                    } ${
                      index > 1 && index % 2 === 0
                        ? "lg:border-l lg:border-[#d5dbe5]"
                        : ""
                    }`}
                  >
                    <p className="mb-4 text-[11px] font-semibold tabular-nums text-[#7d8798]">
                      0{index + 1}
                    </p>
                    <h3 className="text-[16px] font-semibold text-[#202633]">
                      {title}
                    </h3>
                    <p className="mt-2 text-[14px] leading-6 text-[#596477]">
                      {body}
                    </p>
                  </li>
                ))}
              </ol>
            </LandingReveal>

            <div className="mt-12 grid gap-8 lg:grid-cols-[1.22fr_0.78fr] lg:items-center lg:gap-14">
              <LandingReveal>
                <ProductCapture
                  src={CAPTURES.build}
                  alt="RIFT Build creating a polished product-design application with live progress and a verified preview"
                  sizes="(max-width: 1023px) calc(100vw - 2.5rem), 62vw"
                />
              </LandingReveal>
              <LandingReveal delay={100}>
                <h3 className="text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
                  See the work, not just the answer.
                </h3>
                <p className="mt-4 text-[15px] leading-7 text-[#596477]">
                  Reasoning progress, skills, tool calls, commands, specialist
                  handoffs and preview state remain attached to the run.
                </p>
                <ul className="mt-6 grid gap-3">
                  {BUILD_CAPABILITIES.map((capability) => (
                    <li
                      key={capability}
                      className="flex items-start gap-3 text-[14px] leading-6 text-[#394456]"
                    >
                      <Check
                        aria-hidden="true"
                        className="mt-1 size-4 shrink-0 text-[#3159e8]"
                        strokeWidth={1.8}
                      />
                      <span>{capability}</span>
                    </li>
                  ))}
                </ul>
              </LandingReveal>
            </div>
          </div>
        </section>

        <section
          id="models"
          className="scroll-mt-6 bg-[#e9edf5] py-20 text-[#161a23] sm:py-28"
        >
          <div className="mx-auto max-w-[1280px] px-5 sm:px-7 lg:px-10">
            <LandingReveal className="max-w-[47rem]">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7658ff]">
                Model control
              </p>
              <h2 className="text-4xl font-semibold tracking-[-0.05em] text-balance sm:text-6xl sm:leading-[1.02]">
                Choose the model for the job.
              </h2>
              <p className="mt-5 max-w-[42rem] text-[16px] leading-7 text-[#566071]">
                Switch across the active Build catalog, then tune the reasoning
                effort each model supports without leaving the composer.
              </p>
            </LandingReveal>

            <LandingReveal className="mt-12" delay={80}>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
                {BUILD_MODEL_GROUPS.map(
                  ({ family, models, provider }, index) => (
                    <article
                      key={family}
                      aria-label={`${provider.provider} ${provider.familyLabel} models`}
                      data-provider={provider.provider}
                      style={
                        {
                          "--provider-accent": provider.accent,
                          "--provider-surface": provider.surface,
                        } as CSSProperties
                      }
                      className={`relative overflow-hidden rounded-[18px] border border-[#d4dae5] bg-[var(--provider-surface)] p-5 shadow-[0_14px_38px_-30px_rgba(28,35,48,0.42)] sm:p-6 ${
                        index < 3
                          ? "lg:col-span-2"
                          : index === 3
                            ? "lg:col-span-3"
                            : "sm:col-span-2 lg:col-span-3"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 top-0 h-[3px] bg-[var(--provider-accent)]"
                      />
                      <div className="flex items-center gap-3.5">
                        <span className="flex size-12 shrink-0 items-center justify-center rounded-[12px] border border-black/[0.08] bg-white">
                          <Image
                            src={provider.logo}
                            alt={`${provider.provider} logo`}
                            width={provider.logoWidth}
                            height={provider.logoHeight}
                            className="h-auto max-h-8 w-auto max-w-8 object-contain"
                          />
                        </span>
                        <span>
                          <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6d7582]">
                            {provider.provider}
                          </span>
                          <h3 className="mt-0.5 text-[17px] font-semibold tracking-[-0.015em] text-[#20242d]">
                            {provider.familyLabel}
                          </h3>
                        </span>
                      </div>
                      <ul className="mt-5">
                        {models.map((model, modelIndex) => (
                          <li
                            key={model.id}
                            className={`py-3 first:pt-0 last:pb-0 ${
                              modelIndex > 0
                                ? "border-t border-black/[0.08]"
                                : ""
                            }`}
                          >
                            <p className="text-[14px] font-semibold tracking-[-0.01em] text-[#2b313d]">
                              {model.model}
                            </p>
                            <p className="mt-1 text-[12px] leading-5 text-[#5b6473]">
                              {model.desc}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </article>
                  ),
                )}
              </div>
            </LandingReveal>
          </div>
        </section>

        <section
          id="studio"
          className="scroll-mt-6 bg-[#090d15] py-20 text-[#f6f7fb] sm:py-28"
        >
          <div className="mx-auto max-w-[1400px] px-5 sm:px-7 lg:px-10">
            <LandingReveal className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-end lg:gap-16">
              <div className="max-w-[38rem]">
                <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8bd7ff]">
                  Studio
                </p>
                <h2 className="max-w-[12ch] text-4xl font-semibold tracking-[-0.05em] text-balance sm:text-6xl sm:leading-[1.02]">
                  A visual studio with range.
                </h2>
              </div>
              <div className="max-w-[42rem] lg:justify-self-end">
                <p className="text-[16px] leading-7 text-[#b3bdcb]">
                  Direct {IMAGE_MODELS.length} image models and{" "}
                  {VIDEO_MODELS.length} video models from one workspace. Every
                  finished generation remains visible, addressable and ready to
                  download.
                </p>
                <div className="mt-5 flex items-center gap-3 text-[13px] font-semibold text-[#dce2ec]">
                  <Download
                    aria-hidden="true"
                    className="size-4 text-[#8bd7ff]"
                    strokeWidth={1.8}
                  />
                  Persistent history and direct downloads
                </div>
              </div>
            </LandingReveal>

            <LandingReveal className="mt-12" delay={80}>
              <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:aspect-[16/8.5] lg:grid-cols-12 lg:grid-rows-2">
                {STUDIO_SHOWCASE.map(({ src, alt, label }, index) => (
                  <figure
                    key={src}
                    className={`group relative overflow-hidden rounded-[16px] border border-white/[0.12] bg-[#111722] ${
                      index === 0
                        ? "col-span-2 aspect-[16/11] lg:col-span-7 lg:row-span-2 lg:aspect-auto"
                        : "aspect-[4/5] lg:col-span-5 lg:aspect-auto"
                    }`}
                  >
                    <Image
                      src={src}
                      alt={alt}
                      fill
                      sizes={
                        index === 0
                          ? "(max-width: 1023px) calc(100vw - 2.5rem), 58vw"
                          : "(max-width: 1023px) 48vw, 38vw"
                      }
                      quality={86}
                      className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.015] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                    />
                    <div
                      aria-hidden="true"
                      className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#070a10]/80 to-transparent"
                    />
                    <figcaption className="absolute bottom-0 left-0 p-3 text-[11px] font-semibold tracking-[0.04em] text-white sm:p-4 sm:text-[12px]">
                      {label}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </LandingReveal>

            <div className="mt-12 grid gap-5 lg:grid-cols-[1.16fr_0.84fr]">
              <LandingReveal>
                <article className="h-full rounded-[18px] border border-white/[0.12] bg-white/[0.055] p-6 sm:p-8">
                  <h3 className="text-2xl font-semibold tracking-[-0.025em]">
                    <LandingCountUp value={IMAGE_MODELS.length} /> image models
                  </h3>
                  <p className="mt-2 text-[14px] leading-6 text-[#aeb8c7]">
                    Fast iteration, typography, editing consistency,
                    photorealism and high-fidelity production.
                  </p>
                  <ModelNameList names={IMAGE_MODEL_NAMES} />
                </article>
              </LandingReveal>
              <LandingReveal delay={80}>
                <article className="h-full rounded-[18px] border border-[#7658ff]/30 bg-[#7658ff]/[0.09] p-6 sm:p-8">
                  <h3 className="text-2xl font-semibold tracking-[-0.025em]">
                    <LandingCountUp value={VIDEO_MODELS.length} /> video models
                  </h3>
                  <p className="mt-2 text-[14px] leading-6 text-[#b8b5cc]">
                    Cinematic output, controlled motion, character work, social
                    cuts and rapid visual experiments.
                  </p>
                  <ModelNameList names={VIDEO_MODEL_NAMES} />
                </article>
              </LandingReveal>
            </div>

            <div className="mt-12 grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-center lg:gap-14">
              <LandingReveal>
                <div>
                  <h3 className="text-3xl font-semibold tracking-[-0.04em] text-balance sm:text-4xl">
                    Creation stays connected to the prompt.
                  </h3>
                  <p className="mt-4 text-[15px] leading-7 text-[#aeb8c7]">
                    Compare models, revisit results and download the exact image
                    or video you approved without losing the generation record.
                  </p>
                </div>
              </LandingReveal>
              <LandingReveal delay={80}>
                <ProductCapture
                  src={CAPTURES.studio}
                  alt="RIFT Studio showing its image and video model library with a professional generated product visual"
                  sizes="(max-width: 1023px) calc(100vw - 2.5rem), 58vw"
                  className="border-white/[0.13] shadow-[0_26px_80px_rgba(0,0,0,0.32)]"
                />
              </LandingReveal>
            </div>
          </div>
        </section>

        <section
          id="capabilities"
          className="scroll-mt-6 bg-[#f2eee8] py-20 text-[#171a20] sm:py-28"
        >
          <div className="mx-auto max-w-[1400px] px-5 sm:px-7 lg:px-10">
            <LandingReveal className="max-w-[46rem]">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b45042]">
                One workspace
              </p>
              <h2 className="text-4xl font-semibold tracking-[-0.05em] text-balance sm:text-6xl sm:leading-[1.02]">
                Everything around the run stays connected.
              </h2>
              <p className="mt-5 max-w-[42rem] text-[16px] leading-7 text-[#605b55]">
                Projects, collaborators, terminal work, plugins and finished
                output share one workspace instead of becoming separate tools.
              </p>
            </LandingReveal>

            <LandingReveal className="mt-12" delay={80}>
              <div className="grid gap-5 md:grid-cols-2">
                <ProductCapture
                  src={CAPTURES.workspace}
                  alt="RIFT workspace showing CLI Workspace, Tasks, Plugins and Artifacts navigation beside active project work"
                  sizes="(max-width: 767px) calc(100vw - 2.5rem), 50vw"
                  className="md:col-span-2"
                />
                <ProductCapture
                  src={CAPTURES.agents}
                  alt="RIFT Agents showing specialist roles, capability packs and project handoffs"
                  sizes="(max-width: 767px) calc(100vw - 2.5rem), 50vw"
                />
                <ProductCapture
                  src={CAPTURES.appearance}
                  alt="RIFT Appearance controls for theme, typography and interface density"
                  sizes="(max-width: 767px) calc(100vw - 2.5rem), 50vw"
                />
              </div>
            </LandingReveal>

            <LandingReveal className="mt-8">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
                {WORKSPACE_SURFACES.map(({ name, body, tone }, index) => (
                  <article
                    key={name}
                    className={`rounded-[18px] border border-[#d9d3cc] p-6 ${tone} ${
                      index < 3 ? "lg:col-span-2" : "lg:col-span-3"
                    }`}
                  >
                    <h3 className="text-[16px] font-semibold text-[#272a30]">
                      {name}
                    </h3>
                    <p className="mt-2 text-[14px] leading-6 text-[#5e605f]">
                      {body}
                    </p>
                  </article>
                ))}
              </div>
            </LandingReveal>
          </div>
        </section>

        <section
          id="hack-workbench"
          className="scroll-mt-6 bg-[#070a10] py-20 text-[#f6f7fb] sm:py-28"
        >
          <div className="mx-auto max-w-[1400px] px-5 sm:px-7 lg:px-10">
            <LandingReveal className="max-w-[58rem]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8bd7ff]">
                Hack Workbench, exclusive to Max
              </p>
              <h2 className="mt-5 max-w-[16ch] text-4xl font-semibold tracking-[-0.055em] text-balance sm:text-6xl sm:leading-[1.01] lg:text-[4.4rem]">
                Authorized pentesting, from scope to proof.
              </h2>
              <p className="mt-6 max-w-[51rem] text-[17px] leading-8 text-[#b5bfce]">
                The RIFT security agent plans the engagement, orchestrates a
                controlled Kali toolchain and keeps commands, findings and
                evidence attached to one reviewable assessment.
              </p>
              <p className="mt-4 max-w-[48rem] text-[13px] leading-6 text-[#8994a6]">
                For systems you own or are explicitly authorized to test.
              </p>
            </LandingReveal>

            <LandingReveal delay={80}>
              <dl className="mt-12 grid grid-cols-2 border-y border-white/[0.13] lg:grid-cols-4">
                {HACK_METRICS.map(([value, label], index) => (
                  <div
                    key={label}
                    className={`py-5 sm:py-6 ${
                      index % 2 === 1
                        ? "border-l border-white/[0.13] pl-5 sm:pl-7"
                        : "pr-5 sm:pr-7"
                    } ${
                      index > 1
                        ? "border-t border-white/[0.13] lg:border-t-0"
                        : ""
                    } ${
                      index > 1 && index % 2 === 0
                        ? "lg:border-l lg:border-white/[0.13] lg:pl-7"
                        : ""
                    }`}
                  >
                    <dt className="text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
                      {typeof value === "number" ? (
                        <LandingCountUp value={value} />
                      ) : (
                        value
                      )}
                    </dt>
                    <dd className="mt-2 text-[12px] leading-5 text-[#909bad]">
                      {label}
                    </dd>
                  </div>
                ))}
              </dl>
            </LandingReveal>

            <LandingReveal className="mt-10 sm:mt-12">
              <figure>
                <ProductCapture
                  src={CAPTURES.workbench}
                  alt="RIFT Hack Workbench showing an authorized security assessment with live terminal evidence and findings"
                  sizes="(max-width: 1439px) calc(100vw - 2.5rem), 1400px"
                  className="border-white/[0.14] shadow-[0_30px_90px_rgba(0,0,0,0.38)]"
                />
                <figcaption className="mt-3 text-[12px] leading-5 text-[#8994a6]">
                  Live execution, attack-surface evidence and final reporting
                  remain part of the same assessment record.
                </figcaption>
              </figure>
            </LandingReveal>

            <LandingReveal className="mt-12">
              <div className="grid gap-5 md:grid-cols-2">
                {HACK_CAPABILITIES.map(({ title, body }, index) => (
                  <article
                    key={title}
                    className={`rounded-[18px] border p-6 sm:p-7 ${
                      index === 0
                        ? "border-[#3159e8]/40 bg-[#3159e8]/[0.09]"
                        : index === 1
                          ? "border-[#7658ff]/40 bg-[#7658ff]/[0.09]"
                          : "border-white/[0.12] bg-white/[0.045]"
                    }`}
                  >
                    <h3 className="text-[17px] font-semibold text-white">
                      {title}
                    </h3>
                    <p className="mt-3 text-[14px] leading-6 text-[#aeb8c7]">
                      {body}
                    </p>
                  </article>
                ))}
              </div>
            </LandingReveal>

            <div className="mt-10">
              <PrimaryButton dark onClick={() => scrollTo("pricing")}>
                Compare Max
                <ArrowRight
                  aria-hidden="true"
                  className="size-4"
                  strokeWidth={1.8}
                />
              </PrimaryButton>
            </div>
          </div>
        </section>

        <section
          id="pricing"
          className="scroll-mt-6 bg-[#f6f7fb] py-20 text-[#171a22] sm:py-28"
        >
          <div className="mx-auto max-w-[1240px] px-5 sm:px-7 lg:px-10">
            <LandingReveal className="max-w-[46rem]">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#3159e8]">
                Pricing
              </p>
              <h2 className="text-4xl font-semibold tracking-[-0.05em] text-balance sm:text-6xl sm:leading-[1.02]">
                Start free. Add power when the work demands it.
              </h2>
              <p className="mt-5 max-w-[40rem] text-[16px] leading-7 text-[#566071]">
                Every plan includes Build and Studio. Max exclusively adds Hack
                Workbench and the largest monthly credit pool.
              </p>
            </LandingReveal>

            <LandingReveal className="mt-12" delay={80}>
              <div className="grid gap-4">
                <article className="grid gap-8 rounded-[18px] border border-[#dce1e9] bg-white p-6 sm:p-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
                  <div>
                    <h3 className="text-xl font-semibold">{PLANS[0].name}</h3>
                    <div className="mt-3 flex items-end gap-2">
                      <span className="text-5xl font-semibold tracking-[-0.05em]">
                        {PLANS[0].price}
                      </span>
                      <span className="pb-1 text-[13px] text-[#687181]">
                        {PLANS[0].cadence}
                      </span>
                    </div>
                    <p className="mt-3 text-[14px] leading-6 text-[#566071]">
                      {PLANS[0].blurb}
                    </p>
                  </div>
                  <div className="grid gap-7 sm:grid-cols-[1fr_auto] sm:items-end">
                    <PlanFeatures features={PLANS[0].features} />
                    <PrimaryButton onClick={launch}>
                      Start building
                    </PrimaryButton>
                  </div>
                </article>

                <div className="grid gap-4 lg:grid-cols-[1.16fr_0.84fr]">
                  {PLANS.slice(1).map((plan) => (
                    <article
                      key={plan.name}
                      className={`flex h-full flex-col rounded-[18px] border p-6 sm:p-8 ${
                        plan.recommended
                          ? "border-[#9baded] bg-[#e4eaff]"
                          : "border-[#bdb1ee] bg-[#efecff]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <h3 className="text-xl font-semibold">{plan.name}</h3>
                        {plan.recommended ? (
                          <span className="text-[12px] font-semibold text-[#3850a0]">
                            Recommended
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-5 flex items-end gap-2">
                        <span className="text-5xl font-semibold tracking-[-0.05em]">
                          {plan.price}
                        </span>
                        <span className="pb-1 text-[13px] text-[#687181]">
                          {plan.cadence}
                        </span>
                      </div>
                      <p className="mt-3 text-[14px] leading-6 text-[#566071]">
                        {plan.blurb}
                      </p>
                      <div className="mt-7 flex-1 border-t border-[#cdd5e4] pt-6">
                        <PlanFeatures features={plan.features} />
                      </div>
                      <div className="mt-8">
                        <PrimaryButton onClick={launch}>
                          Start building
                        </PrimaryButton>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </LandingReveal>

            <p className="mt-8 max-w-2xl text-[13px] leading-6 text-[#606978]">
              Add one-time credits from $10 when you need more. They do not
              expire. View the full breakdown on the{" "}
              <Link
                href="/pricing"
                className={`rounded-sm font-semibold text-[#3159e8] underline decoration-[#3159e8]/35 underline-offset-4 transition-colors hover:text-[#2345b2] ${FOCUS}`}
              >
                pricing page
              </Link>
              .
            </p>
          </div>
        </section>

        <section className="bg-[#eef1f6] py-20 text-[#171a22] sm:py-28">
          <div className="mx-auto grid max-w-[1240px] gap-10 px-5 sm:px-7 lg:grid-cols-[0.68fr_1.32fr] lg:gap-20 lg:px-10">
            <LandingReveal>
              <h2 className="text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
                Questions, answered.
              </h2>
              <p className="mt-5 max-w-sm text-[15px] leading-7 text-[#596272]">
                The practical details before your first run.
              </p>
            </LandingReveal>

            <LandingReveal delay={80}>
              <div className="border-t border-[#d7dce5]">
                {FAQ.map(({ question, answer }) => (
                  <details
                    key={question}
                    className="group border-b border-[#d7dce5]"
                  >
                    <summary
                      className={`flex min-h-14 cursor-pointer list-none items-center justify-between gap-5 rounded-md py-5 text-left text-[16px] font-semibold text-[#262b35] marker:content-none ${FOCUS}`}
                    >
                      <span>{question}</span>
                      <ChevronDown
                        aria-hidden="true"
                        className="size-4 shrink-0 text-[#687181] transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                        strokeWidth={1.8}
                      />
                    </summary>
                    <p className="max-w-[42rem] pb-6 pr-8 text-[14px] leading-6 text-[#596272]">
                      {answer}
                    </p>
                  </details>
                ))}
              </div>
            </LandingReveal>
          </div>
        </section>

        <section className="bg-[#3159e8] text-white">
          <div className="mx-auto grid max-w-[1400px] items-end gap-8 px-5 py-16 sm:px-7 sm:py-20 lg:grid-cols-[1fr_auto] lg:px-10">
            <LandingReveal>
              <h2 className="max-w-[13ch] text-4xl font-semibold leading-[1] tracking-[-0.05em] text-balance sm:text-6xl">
                Bring the brief. Leave with the result.
              </h2>
              <p className="mt-5 max-w-[35rem] text-[16px] leading-7 text-[#dbe3ff]">
                Start in the browser, then keep working on web or desktop.
              </p>
            </LandingReveal>
            <PrimaryButton dark onClick={launch}>
              Start building
              <ArrowRight
                aria-hidden="true"
                className="size-4"
                strokeWidth={1.8}
              />
            </PrimaryButton>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.08] bg-[#070a10] text-[#f6f7fb]">
        <div className="mx-auto grid max-w-[1400px] gap-10 px-5 py-12 sm:px-7 md:grid-cols-[1fr_auto] md:items-end lg:px-10">
          <div>
            <RiftBrandLockup
              markSize={30}
              textSize={15}
              gap={10}
              className="text-[#f6f7fb]"
            />
            <p className="mt-4 max-w-sm text-[13px] leading-6 text-[#8f99a9]">
              A professional AI workspace for software, media and authorized
              security work.
            </p>
          </div>

          <div className="grid gap-5 text-[13px] text-[#9aa4b4] sm:grid-cols-2 sm:gap-x-10">
            <nav aria-label="Product links" className="flex flex-wrap gap-5">
              <Link
                className={`hover:text-white ${DARK_FOCUS}`}
                href="/pricing"
              >
                Pricing
              </Link>
              <Link
                className={`hover:text-white ${DARK_FOCUS}`}
                href="/download"
              >
                Download
              </Link>
              <a
                className={`hover:text-white ${DARK_FOCUS}`}
                href="https://x.com/rift_sys"
                target="_blank"
                rel="noreferrer noopener"
              >
                X
              </a>
              <a
                className={`hover:text-white ${DARK_FOCUS}`}
                href="https://github.com/cettocdx/rift"
                target="_blank"
                rel="noreferrer noopener"
              >
                GitHub
              </a>
            </nav>
            <nav aria-label="Legal links" className="flex flex-wrap gap-5">
              <Link
                className={`hover:text-white ${DARK_FOCUS}`}
                href="/refund-policy"
              >
                Refund
              </Link>
              <Link
                className={`hover:text-white ${DARK_FOCUS}`}
                href="/terms-of-service"
              >
                Terms
              </Link>
              <Link
                className={`hover:text-white ${DARK_FOCUS}`}
                href="/privacy-policy"
              >
                Privacy
              </Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
