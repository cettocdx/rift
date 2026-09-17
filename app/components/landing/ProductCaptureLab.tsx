"use client";

import { RootShellPresence } from "@/app/components/RootShellPresence";

import Image from "next/image";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import {
  Blocks,
  Bot,
  Check,
  Circle,
  FileCode2,
  Hammer,
  Image as ImageIcon,
  Images,
  ListTodo,
  ChevronDown,
  LoaderCircle,
  PanelsTopLeft,
  Plus,
  Search,
  SquareTerminal,
  Terminal,
  UsersRound,
} from "lucide-react";

import { AppearanceSettingsTab } from "@/app/components/AppearanceSettingsTab";
import { RiftBrandLockup } from "@/components/icons/rift-brand-lockup";
import { AgentPetAvatar } from "@/app/components/agents/AgentPetAvatar";
import { StudioDiscovery } from "@/app/components/studio/StudioDiscovery";
import SkillDiscoveryToolHandler from "@/app/components/tools/SkillDiscoveryToolHandler";
import { Workbench } from "@/app/components/workbench/Workbench";
import { WorkbenchActivityProvider } from "@/app/components/workbench/WorkbenchActivity";
import { WorkbenchEditorTabs } from "@/app/components/workbench/WorkbenchEditor";
import {
  WorkbenchProvider,
  useWorkbench,
} from "@/app/components/workbench/WorkbenchProvider";
import type { WorkbenchAdapter } from "@/app/components/workbench/types";
import { ProShellProvider } from "@/app/components/pro/ProShellContext";
import { RiftPixelMark } from "@/components/icons/rift-pixel-mark";
import { CursorThinking } from "@/components/ui/cursor-thinking";
import { CursorToolBlock } from "@/components/ui/cursor-tool-block";
import { AGENT_PET_ROSTER } from "@/lib/ai/agents/pet-roster";

export type ProductCaptureView =
  | "build"
  | "studio"
  | "agents"
  | "appearance"
  | "workbench"
  | "workspace";

const VIEW_LABELS: Record<ProductCaptureView, string> = {
  build: "Build",
  studio: "Studio",
  agents: "Agents",
  appearance: "Appearance",
  workbench: "Hack Workbench",
  workspace: "CLI Workspace",
};

/**
 * The shipped nav, in the shipped order. This is a picture of the product, so
 * it folds where the product folds: five destinations open, the rest behind
 * More, and no brand row -- the window says which app this is.
 */
const NAV_ITEMS = [
  { label: "New chat", icon: Plus, primary: true },
  { label: "Search", icon: Search, primary: true },
  { label: "Build", icon: Hammer, primary: true },
  { label: "Studio", icon: ImageIcon, primary: true },
  { label: "Agents", icon: Bot, primary: true },
  { label: "Hack Workbench", icon: SquareTerminal, primary: false },
  { label: "Tasks", icon: ListTodo, primary: false },
  { label: "Plugins", icon: Blocks, primary: false },
  { label: "Artifacts", icon: Images, primary: false },
] as const;

function CaptureSidebar({ view }: { view: ProductCaptureView }) {
  const activeLabel = VIEW_LABELS[view];
  const isProductDesignBuild = view === "build";

  return (
    <aside className="flex h-full w-[272px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="px-2 pb-1.5 pt-1">
        <nav aria-label="Capture primary workspaces" className="space-y-px">
          {NAV_ITEMS.filter((item) => item.primary).map((item) => {
            const Icon = item.icon;
            const active = activeLabel === item.label;
            return (
              <div
                key={item.label}
                className={`flex h-[30px] items-center gap-2.5 rounded-lg px-2 text-[13px] font-normal leading-5 text-foreground ${
                  active ? "bg-sidebar-accent" : ""
                }`}
              >
                <Icon
                  className="size-[14px] text-[var(--cursor-icon-secondary)]"
                  strokeWidth={1.5}
                />
                {item.label}
              </div>
            );
          })}
        </nav>

        <nav aria-label="Capture more workspaces" className="space-y-px">
          <div className="flex h-[30px] items-center gap-2.5 rounded-lg px-2 text-[13px] font-normal leading-5 text-[var(--cursor-text-tertiary)]">
            <ChevronDown
              className="size-[14px] -rotate-90"
              strokeWidth={1.5}
              aria-hidden
            />
            More
          </div>
          {NAV_ITEMS.filter(
            (item) => !item.primary && activeLabel === item.label,
          ).map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className="flex h-[30px] items-center gap-2.5 rounded-lg bg-sidebar-accent px-2 text-[13px] font-normal leading-5 text-foreground"
              >
                <Icon
                  className="size-[14px] text-[var(--cursor-icon-secondary)]"
                  strokeWidth={1.5}
                />
                {item.label}
              </div>
            );
          })}
        </nav>
      </div>

      <div className="border-y border-sidebar-border px-2 py-1">
        <div className="flex h-[30px] items-center px-2 text-[13px] font-normal text-[var(--cursor-text-tertiary)]">
          Projects
        </div>
        <div className="flex h-[30px] items-center gap-2.5 rounded-lg px-2 text-[13px] text-foreground">
          <PanelsTopLeft
            className="size-[14px] text-[var(--cursor-icon-secondary)]"
            strokeWidth={1.5}
          />
          {isProductDesignBuild
            ? "Atelier form studio"
            : "Lumen product studio"}
        </div>
        <div className="flex h-[30px] items-center gap-2.5 rounded-lg px-2 text-[13px] text-foreground">
          <ImageIcon
            className="size-[14px] text-[var(--cursor-icon-secondary)]"
            strokeWidth={1.5}
          />
          {isProductDesignBuild ? "Material library" : "Brand library refresh"}
        </div>
      </div>

      <div className="min-h-0 flex-1 px-2 py-1">
        <div className="flex h-[30px] items-center px-2 text-[13px] font-normal text-[var(--cursor-text-tertiary)]">
          Recent
        </div>
        <div className="h-[30px] truncate rounded-lg px-2 text-[13px] leading-[30px] text-foreground">
          {isProductDesignBuild
            ? "Lounge chair configurator"
            : "Creative studio command center"}
        </div>
        <div className="h-[30px] truncate rounded-lg px-2 text-[13px] leading-[30px] text-foreground">
          {isProductDesignBuild
            ? "Render comparison queue"
            : "Project review workspace"}
        </div>
      </div>

      <div className="border-t border-sidebar-border px-2 py-2">
        <div className="flex h-[30px] items-center gap-2.5 rounded-lg px-2 text-[13px] text-foreground">
          <span className="flex size-5 items-center justify-center rounded-md bg-foreground text-[9px] font-medium text-background">
            U
          </span>
          <span>User</span>
          <span className="ml-auto text-[10px] text-[var(--cursor-text-secondary)]">
            Pro
          </span>
        </div>
      </div>
    </aside>
  );
}

function CaptureTitlebar({ view }: { view: ProductCaptureView }) {
  return (
    <header className="flex h-[35px] shrink-0 items-center border-b border-border bg-background px-3 text-[12px] text-muted-foreground">
      <span style={{ display: "inline-flex", marginRight: 20, flexShrink: 0 }}>
        <RiftBrandLockup
          markSize={24}
          textSize={13}
          className="text-foreground"
        />
      </span>
      <span>{VIEW_LABELS[view]}</span>
      <span className="mx-2 text-border-strong">/</span>
      <span className="font-mono text-[11px]">
        {view === "build" ? "Atelier form studio" : "RIFT workspace"}
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        <Circle className="size-2 fill-[var(--success)] text-[var(--success)]" />
        Staged product demo
      </span>
    </header>
  );
}

function CaptureShell({
  view,
  children,
}: {
  view: ProductCaptureView;
  children: ReactNode;
}) {
  return (
    <ProShellProvider basePath="/lab/capture">
      <div
        data-product-capture={view}
        style={
          {
            "--background": "#181818",
            "--sidebar": "#141414",
            "--cursor-text-primary": "#f0f0f0",
            "--cursor-text-secondary": "#b8b8b8",
            "--cursor-text-tertiary": "#999999",
            "--cursor-text-quaternary": "#666666",
            "--cursor-icon-secondary": "#a7a7a7",
            "--muted-foreground": "#b8b8b8",
            "--surface-1": "#181818",
            "--pro-shell-canvas": "#181818",
            "--pro-sidebar-bg": "#141414",
            "--pro-main-bg": "#181818",
          } as CSSProperties
        }
        className="pro-shell flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground"
      >
        <RootShellPresence kind="pro" />
        <CaptureTitlebar view={view} />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <CaptureSidebar view={view} />
          <main className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
            {children}
          </main>
        </div>
      </div>
    </ProShellProvider>
  );
}

const INSTALLED_FRONTEND_SKILLS = [
  {
    id: "ui-ux-pro-max",
    name: "UI Pro Max",
  },
  {
    id: "design-taste-frontend",
    name: "Design Taste Frontend",
  },
] as const;

function BuildCapture() {
  const progress = [
    ["Created the product workspace", "Complete"],
    ["Built materials and variant controls", "Complete"],
    ["Connecting render comparisons", "In progress"],
    ["Running final visual checks", "Queued"],
  ] as const;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-border px-4">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-foreground">
            Atelier form studio
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>Build</span>
            <span className="h-2.5 w-px bg-border-strong" aria-hidden />
            <span>Agent</span>
            <span className="h-2.5 w-px bg-border-strong" aria-hidden />
            <span>GPT-5.6 Sol</span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 text-[10.5px] text-muted-foreground">
          <Check className="size-3 text-[var(--success)]" />
          Application preview live
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[330px_minmax(0,1fr)]">
        <section className="min-h-0 overflow-hidden border-r border-border bg-background px-5 py-5">
          <div className="rounded-[12px] bg-foreground/[0.055] px-3.5 py-3 text-[12px] leading-[1.55] text-[var(--cursor-text-primary)]">
            Build a production-ready generative product design app with a
            photoreal viewport, material controls, variants and a render queue.
          </div>

          <div className="mt-5 flex items-start gap-2.5">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface-1">
              <RiftPixelMark size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <CursorThinking
                phase="reasoning"
                source="build_app"
                title="Building the application"
                ariaLabel="Building the application"
              />

              <ol className="mt-3 border-t border-border">
                {progress.map(([label, state], index) => (
                  <li
                    key={label}
                    className="flex min-h-[50px] items-start gap-2.5 border-b border-border/80 py-2.5"
                  >
                    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                      {index < 2 ? (
                        <Check className="size-3.5 text-[var(--success)]" />
                      ) : index === 2 ? (
                        <LoaderCircle className="size-3.5 animate-spin text-foreground motion-reduce:animate-none" />
                      ) : (
                        <Circle className="size-3 text-border-strong" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11.5px] leading-4 text-[var(--cursor-text-secondary)]">
                        {label}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">
                        {state}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-border bg-surface-1 px-3 py-2.5">
            <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
              <FileCode2 className="size-3.5" strokeWidth={1.5} />
              Files in progress
            </div>
            <div className="mt-2 space-y-1 font-mono text-[10px] leading-4 text-[var(--cursor-text-secondary)]">
              <div>app/studio/page.tsx</div>
              <div>components/material-inspector.tsx</div>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-col bg-surface-1 px-4 py-4">
          <header className="flex h-8 shrink-0 items-start justify-between gap-3">
            <div>
              <div className="text-[12px] font-medium text-foreground">
                Live application
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                Responsive preview
              </div>
            </div>
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Check className="size-3 text-[var(--success)]" /> Preview ready
            </span>
          </header>

          <div className="flex min-h-0 flex-1 items-center">
            <div className="relative aspect-video w-full overflow-hidden rounded-[10px] border border-border bg-[#090909] shadow-[0_16px_45px_rgba(0,0,0,0.24)]">
              <Image
                src="/landing/product/product-design-app-4k.webp"
                alt="Generative product design application with a photoreal chair viewport, material controls, variants and render queue"
                fill
                priority
                unoptimized
                sizes="660px"
                className="object-cover"
              />
            </div>
          </div>

          <div className="flex h-8 shrink-0 items-end gap-4 border-t border-border text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Check className="size-3 text-[var(--success)]" /> Preview
              refreshed
            </span>
            <span className="flex items-center gap-1.5">
              <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
              Layout checks running
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <Terminal className="size-3" /> Sandbox connected
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}

function StudioCapture() {
  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      <div className="mx-auto max-w-[1180px]">
        <StudioDiscovery />
      </div>
    </div>
  );
}

function AgentsCapture() {
  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <div className="mx-auto max-w-[980px]">
        <header className="flex items-end justify-between gap-5 border-b border-border pb-5">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.035em]">
              Agents
            </h1>
            <p className="mt-1.5 max-w-2xl text-[12px] leading-5 text-muted-foreground">
              Configure real Build participants, capability packs, permissions,
              and team handoffs from one runtime surface.
            </p>
          </div>
          <div className="flex gap-2">
            <button className="h-8 rounded-md border border-border px-3 text-[11px] text-[var(--cursor-text-secondary)]">
              New team
            </button>
            <button className="h-8 rounded-md bg-foreground px-3 text-[11px] font-medium text-background">
              New agent
            </button>
          </div>
        </header>

        <section className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold">Built-in crew</h2>
            <span className="text-[10px] text-muted-foreground">
              Forge leads · 6 available
            </span>
          </div>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-1">
            {AGENT_PET_ROSTER.map((agent, index) => (
              <article
                key={agent.id}
                className={`flex min-h-[58px] items-center gap-3 px-3.5 py-2.5 ${
                  index === 0 ? "bg-foreground/[0.045]" : ""
                }`}
              >
                <AgentPetAvatar
                  accent={agent.accent}
                  agentName={agent.petName}
                  participating
                  role={agent.id}
                  roleName={agent.roleName}
                  selected={index === 0}
                  size={34}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{agent.petName}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {agent.roleName} ·{" "}
                    {index === 0 ? "Default lead" : "Available"}
                  </div>
                </div>
                <div className="hidden max-w-[310px] truncate text-[10px] text-muted-foreground lg:block">
                  {agent.skillIds.slice(0, 3).join(" · ")}
                </div>
                <span className="min-w-16 text-right text-[10.5px] text-muted-foreground">
                  {index === 0 ? "Lead" : "Ready"}
                </span>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-5 grid grid-cols-[minmax(0,1fr)_260px] gap-4">
          <div className="rounded-lg border border-border bg-surface-1 p-4">
            <div className="flex items-center gap-2">
              <UsersRound className="size-4 text-muted-foreground" />
              <h2 className="text-[13px] font-semibold">
                Product delivery team
              </h2>
              <span className="ml-auto text-[10px] text-[var(--success)]">
                Runtime ready
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              Forge coordinates implementation, Pixel owns product detail, and
              Probe verifies the complete flow before handoff.
            </p>
            <div className="mt-4 flex items-center gap-2">
              {AGENT_PET_ROSTER.slice(0, 3).map((agent, index) => (
                <AgentPetAvatar
                  key={agent.id}
                  accent={agent.accent}
                  agentName={agent.petName}
                  participating
                  role={agent.id}
                  roleName={agent.roleName}
                  selected={index === 0}
                  size={32}
                />
              ))}
              <span className="ml-2 text-[10.5px] text-muted-foreground">
                Shared skills and project context
              </span>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-surface-1 p-4">
            <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              Handoff policy
            </div>
            <div className="mt-3 space-y-3 text-[11px] text-[var(--cursor-text-secondary)]">
              <div className="flex items-center gap-2">
                <Check className="size-3 text-[var(--success)]" /> Design review
              </div>
              <div className="flex items-center gap-2">
                <Check className="size-3 text-[var(--success)]" /> Runtime proof
              </div>
              <div className="flex items-center gap-2">
                <Circle className="size-3 text-muted-foreground" /> Final QA
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function AppearanceCapture() {
  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <div className="mx-auto max-w-[1040px]">
        <header className="mb-6 border-b border-border pb-5">
          <h1 className="text-[22px] font-semibold tracking-[-0.035em]">
            Appearance
          </h1>
          <p className="mt-1.5 max-w-2xl text-[12px] leading-5 text-muted-foreground">
            Tune light and dark workspaces, typography, density, and reusable
            interface colors.
          </p>
        </header>
        <AppearanceSettingsTab />
      </div>
    </div>
  );
}

const FIXTURE_FILE = `"use client";

import { AgentProgress } from "@/components/ui/agent-progress";

export default function BuildStatus() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <AgentProgress
        title="Verifying responsive states"
        source="verify_app"
      />
    </main>
  );
}
`;

const WORKBENCH_ADAPTER: WorkbenchAdapter = {
  async listDirectory(path) {
    if (path === "app") {
      return {
        path,
        truncated: false,
        entries: [
          {
            name: "page.tsx",
            path: "app/page.tsx",
            type: "file",
            size: FIXTURE_FILE.length,
            modifiedAt: "2026-07-19T14:00:00.000Z",
          },
          {
            name: "globals.css",
            path: "app/globals.css",
            type: "file",
            size: 2864,
            modifiedAt: "2026-07-19T13:58:00.000Z",
          },
        ],
      };
    }
    return {
      path,
      truncated: false,
      entries: [
        {
          name: "app",
          path: "app",
          type: "directory",
          size: 0,
          modifiedAt: "2026-07-19T14:00:00.000Z",
        },
        {
          name: "components",
          path: "components",
          type: "directory",
          size: 0,
          modifiedAt: "2026-07-19T13:57:00.000Z",
        },
        {
          name: "package.json",
          path: "package.json",
          type: "file",
          size: 3840,
          modifiedAt: "2026-07-19T13:55:00.000Z",
        },
      ],
    };
  },
  async readFile(path) {
    const content = path === "app/page.tsx" ? FIXTURE_FILE : "{}\n";
    return {
      path,
      content,
      revision: "capture-revision-1",
      size: content.length,
      modifiedAt: "2026-07-19T14:00:00.000Z",
    };
  },
  async writeFile({ path, content }) {
    return {
      path,
      revision: "capture-revision-2",
      size: content.length,
      modifiedAt: "2026-07-19T14:01:00.000Z",
    };
  },
  async readGit() {
    return {
      repositoryPath: "/workspace/rift",
      truncated: false,
      status: {
        currentBranch: "feature/agent-runtime",
        upstream: "origin/feature/agent-runtime",
        ahead: 2,
        behind: 0,
        detached: false,
        fileStatus: [
          {
            name: "app/page.tsx",
            status: "modified",
            indexStatus: " ",
            workingTreeStatus: "M",
            staged: false,
          },
          {
            name: "public/studio/references/manifest.json",
            status: "added",
            indexStatus: "A",
            workingTreeStatus: " ",
            staged: true,
          },
        ],
        isClean: false,
        hasChanges: true,
        hasStaged: true,
        hasUntracked: false,
        hasConflicts: false,
        totalCount: 2,
        stagedCount: 1,
        unstagedCount: 1,
        untrackedCount: 0,
        conflictCount: 0,
      },
    };
  },
  async readGitDiff({ file }) {
    return {
      repositoryPath: "/workspace/rift",
      diff: {
        path: file,
        staged: { content: "", truncated: false },
        unstaged: {
          content: "+ Verifying responsive states",
          truncated: false,
        },
      },
    };
  },
  async mutateGit(mutation) {
    return { ok: true, action: mutation.action };
  },
};

function WorkbenchCaptureBoot() {
  const { actions } = useWorkbench();

  useEffect(() => {
    void (async () => {
      await actions.loadDirectory("");
      await actions.toggleDirectory("app");
      await actions.openFile("app/page.tsx");
      await actions.refreshGit("/workspace/rift");
    })();
  }, [actions]);

  return null;
}

function CaptureTerminalPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col font-mono text-[11.5px]">
      <div className="flex h-[30px] shrink-0 items-center gap-4 border-b border-workbench-border px-3 text-workbench-muted">
        <span className="border-b border-workbench-text pb-1 text-workbench-text">
          Terminal
        </span>
        <span>Problems</span>
        <span>Output</span>
      </div>
      <pre className="min-h-0 flex-1 overflow-hidden px-3 py-2 leading-5 text-workbench-muted">
        <span className="text-workbench-text">rift@workspace</span>
        {" $ pnpm test && pnpm typecheck\n"}
        <span className="text-workbench-success">PASS</span>
        {" reasoning presentation  30 tests\n"}
        <span className="text-workbench-success">PASS</span>
        {" Studio discovery         21 tests\n"}
        <span className="text-workbench-success">PASS</span>
        {" TypeScript               0 errors\n\n"}
        <span className="text-workbench-text">rift@workspace</span>
        {" $ "}
      </pre>
    </div>
  );
}

function CaptureAgentPane() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[35px] shrink-0 items-center border-b border-workbench-border px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-workbench-muted">
        RIFT agent
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <CursorThinking
          phase="terminal"
          title="Verifying responsive states"
          source="verify_app"
        />
        <SkillDiscoveryToolHandler
          status="streaming"
          part={{
            state: "output-available",
            output: {
              matched: true,
              count: 2,
              activeSkills: [...INSTALLED_FRONTEND_SKILLS],
              installation: { status: "installed", failed: [] },
            },
          }}
        />
        <CursorToolBlock
          label="Updated app/page.tsx"
          status="done"
          command="apply_patch app/page.tsx"
          output="+ RIFT-native agent progress\n+ Reduced-motion support"
        />
        <CursorToolBlock
          label="Running verification"
          status="running"
          isShimmer
          command="pnpm test && pnpm typecheck"
        />
      </div>
    </div>
  );
}

function CaptureCodeEditor() {
  const lines = [
    ['"use client";', "text-[#ce9178]"],
    ["", ""],
    [
      'import { AgentProgress } from "@/components/ui/agent-progress";',
      "text-[#c586c0]",
    ],
    ["", ""],
    ["export default function BuildStatus() {", "text-[#569cd6]"],
    ["  return (", "text-workbench-text"],
    [
      '    <main className="min-h-screen bg-background text-foreground">',
      "text-[#4ec9b0]",
    ],
    ["      <AgentProgress", "text-[#4ec9b0]"],
    ['        title="Verifying responsive states"', "text-[#9cdcfe]"],
    ['        source="verify_app"', "text-[#9cdcfe]"],
    ["      />", "text-[#4ec9b0]"],
    ["    </main>", "text-[#4ec9b0]"],
    ["  );", "text-workbench-text"],
    ["}", "text-workbench-text"],
  ] as const;

  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-workbench-canvas py-2 font-mono text-[12px] leading-[20px]">
      {lines.map(([line, color], index) => (
        <div key={`${index}-${line}`} className="flex min-w-0">
          <span className="w-11 shrink-0 select-none pr-3 text-right text-workbench-faint/60">
            {index + 1}
          </span>
          <code className={`min-w-0 whitespace-pre ${color}`}>{line}</code>
        </div>
      ))}
    </div>
  );
}

function WorkspaceCapture() {
  return (
    <ProShellProvider basePath="/lab/capture">
      <WorkbenchActivityProvider>
        <WorkbenchProvider adapter={WORKBENCH_ADAPTER}>
          <div className="flex h-screen w-screen overflow-hidden">
            <Workbench.Root>
              <WorkbenchCaptureBoot />
              <Workbench.Titlebar />
              <Workbench.Body>
                <Workbench.ActivityRail />
                <Workbench.Sidebar>
                  <Workbench.SidebarContent />
                </Workbench.Sidebar>
                <Workbench.EditorGroup>
                  <Workbench.EditorPane>
                    <WorkbenchEditorTabs />
                    <CaptureCodeEditor />
                  </Workbench.EditorPane>
                  <Workbench.BottomPanel>
                    <CaptureTerminalPanel />
                  </Workbench.BottomPanel>
                </Workbench.EditorGroup>
                <Workbench.AgentPane>
                  <CaptureAgentPane />
                </Workbench.AgentPane>
              </Workbench.Body>
              <Workbench.StatusBar />
            </Workbench.Root>
          </div>
        </WorkbenchProvider>
      </WorkbenchActivityProvider>
    </ProShellProvider>
  );
}

function WorkbenchCapture() {
  return (
    <CaptureShell view="workbench">
      <div className="flex h-full flex-col gap-6 bg-[#080b10] p-6 text-foreground">
        <div className="flex items-center justify-between">
          <RiftBrandLockup markSize={30} textSize={16} />
          <span className="font-mono text-xs text-muted-foreground">
            Security workspace · Staged demo
          </span>
        </div>
        <h1 className="text-2xl font-medium">
          Plan a scoped security assessment
        </h1>
        <p className="text-muted-foreground">
          Define the authorized scope, review the plan, and keep findings
          connected to evidence.
        </p>
        <div className="grid grid-cols-3 gap-4">
          {[
            "Scope · example.test",
            "Assessment · Not started",
            "Evidence · No findings",
          ].map((label) => (
            <div
              key={label}
              className="rounded-lg border border-border p-4 text-sm"
            >
              {label}
            </div>
          ))}
        </div>
        <div className="flex-1 rounded-lg border border-border bg-background p-5">
          <h2 className="mb-4 text-lg">Assessment plan</h2>
          {[
            "Confirm authorization and scope",
            "Inventory the allowed attack surface",
            "Review evidence before reporting",
          ].map((label, index) => (
            <div
              className="flex items-center gap-3 border-b border-border py-4 text-sm"
              key={label}
            >
              <Circle className="size-4 text-muted-foreground" />
              {index + 1}. {label}
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
          Describe an authorized assessment…
        </div>
      </div>
    </CaptureShell>
  );
}

export function ProductCaptureLab({ view }: { view: ProductCaptureView }) {
  if (view === "workbench") return <WorkbenchCapture />;
  if (view === "workspace") return <WorkspaceCapture />;

  return (
    <CaptureShell view={view}>
      {view === "build" ? <BuildCapture /> : null}
      {view === "studio" ? <StudioCapture /> : null}
      {view === "agents" ? <AgentsCapture /> : null}
      {view === "appearance" ? <AppearanceCapture /> : null}
    </CaptureShell>
  );
}
