import {
  BuildIcon,
  StudioIcon,
  HackIcon,
  PluginsIcon,
  AgentsIcon,
  RunsIcon,
  TasksIcon,
  ArtifactsIcon,
} from "@/lib/ui/workspace-icons";

/** The same destinations and icons in the sidebar, palette and window title. */
export const WORKSPACE_ITEMS = [
  { id: "app", label: "Build", href: "/", Icon: BuildIcon, primary: true },
  {
    id: "image",
    label: "Studio",
    href: "/studio",
    Icon: StudioIcon,
    primary: true,
  },
  {
    id: "hack",
    label: "Hack Workbench",
    href: "/hack",
    Icon: HackIcon,
    primary: true,
  },
  {
    id: "plugins",
    label: "Plugins",
    href: "/plugins",
    Icon: PluginsIcon,
    primary: false,
  },
  {
    id: "agents",
    label: "Agents",
    href: "/agents",
    Icon: AgentsIcon,
    primary: false,
  },
  { id: "runs", label: "Runs", href: "/runs", Icon: RunsIcon, primary: false },
  {
    id: "tasks",
    label: "Tasks",
    href: "/tasks",
    Icon: TasksIcon,
    primary: false,
  },
  {
    id: "artifacts",
    label: "Artifacts",
    href: "/artifacts",
    Icon: ArtifactsIcon,
    primary: false,
  },
] as const;

export function workspaceTitle(pathname: string) {
  if (/^\/settings(?:\/|$)/.test(pathname)) return "Settings";
  return (
    WORKSPACE_ITEMS.find(
      (item) =>
        item.href !== "/" &&
        (pathname === item.href || pathname.startsWith(`${item.href}/`)),
    )?.label ?? "Build"
  );
}
