import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import SidebarHistory from "../../app/components/SidebarHistory";
import { ProShellProvider } from "../../app/components/pro/ProShellContext";
import { TooltipProvider } from "../../components/ui/tooltip";
import { WorkbenchDock } from "../../app/components/workbench/WorkbenchDock";
import { useWorkbenchDock } from "../../app/hooks/useWorkbenchDock";
import { LiveSidebarContentProvider } from "../../app/contexts/LiveSidebarContent";
import dockStyles from "../../app/components/workbench/WorkbenchDock.module.css";
import { usePathname } from "./sidebar-services";
import { readRenderDiagnostics } from "./render-diagnostics";
const chats = Array.from({ length: 10 }, (_, i) => ({
  _id: `record-${i}`,
  id: `chat-${i}`,
  title: `Conversation ${i + 1}`,
}));
function Diagnostics() {
  const [snapshot, setSnapshot] = useState<ReturnType<
    typeof readRenderDiagnostics
  > | null>(null);
  return (
    <div className="fixed bottom-3 left-3 z-50 max-w-[520px] rounded border border-border bg-background p-2 text-xs">
      <button onClick={() => setSnapshot(readRenderDiagnostics())}>
        Read render diagnostics
      </button>
      {snapshot && (
        <div
          className="max-h-[380px] overflow-auto"
          data-testid="render-summary"
        >
          <p data-testid="render-selected">{`Path: ${snapshot.path}; selected: ${snapshot.nodes.row?.attributes["data-testid"] ?? "none"}; document: ${snapshot.visibilityState}`}</p>
          {["pane", "dock", "tab", "body", "row", "rowWrapper"].map((key) => {
            const node = snapshot.nodes[key];
            if (!node)
              return (
                <p key={key} data-testid={`render-node-${key}`}>
                  {key}: absent
                </p>
              );
            const short = (value: unknown) =>
              String(value ?? "none").slice(0, 60);
            const animation = node.animations[0];
            return (
              <div key={key}>
                <p
                  data-testid={`render-node-${key}`}
                >{`${key}: opacity=${node.style.opacity}; display=${node.style.display}; visibility=${node.style.visibility}; contentVisibility=${node.style.contentVisibility}`}</p>
                <p
                  data-testid={`render-animation-${key}`}
                >{`${key} animation: ${short(animation?.name ?? node.style.animationName)}; time=${short(animation?.currentTime)}; state=${short(animation?.playState ?? "no live animation")}; CSS state=${node.style.animationPlayState}; count=${node.animations.length}`}</p>
              </div>
            );
          })}
          <details>
            <summary>Full diagnostic JSON</summary>
            <pre
              data-testid="render-diagnostics"
              className="max-h-48 overflow-auto whitespace-pre-wrap"
            >
              {JSON.stringify(snapshot, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
function App() {
  const path = usePathname();
  const dock = useWorkbenchDock(path, true);
  const [sidebar, setSidebar] = useState(true);
  return (
    <div
      className="pro-shell flex h-screen bg-background text-foreground"
      data-rift-dock-visible={dock.state.visible}
      data-rift-dock-placement={dock.state.placement}
    >
      {sidebar && (
        <aside
          className="pro-sidebar h-full w-[280px] shrink-0 overflow-auto bg-sidebar pt-20"
          data-rift-sidebar-panel
        >
          <SidebarHistory chats={chats} paginationStatus="Exhausted" />
        </aside>
      )}
      <main className="min-w-0 flex-1 p-8">
        <p className="mb-4 text-sm">
          Local render diagnostic fixture — synthetic data, services disabled.
        </p>
        <div className="flex gap-4">
          <button onClick={() => setSidebar(!sidebar)}>Toggle sidebar</button>
          <button
            aria-controls="rift-build-tool-pane"
            onClick={() => dock.openKind("activity")}
          >
            Open Activity
          </button>
        </div>
        <p data-testid="current-route">{path}</p>
      </main>
      {/* Exact production pane contract from chat.tsx; this wrapper owns dockReveal. */}
      <div
        id="rift-build-tool-pane"
        data-rift-tool-pane
        className={dockStyles.container}
        data-visible={dock.state.visible}
        data-placement={dock.state.placement}
        inert={!dock.state.visible}
        aria-hidden={!dock.state.visible}
        style={
          dock.state.placement === "right"
            ? {
                width: dock.state.visible
                  ? dock.state.maximized
                    ? "100%"
                    : "45%"
                  : 0,
              }
            : { height: dock.state.visible ? 340 : 0, width: "100%" }
        }
      >
        {dock.state.tabs.length > 0 && (
          <WorkbenchDock
            controller={dock}
            messages={[]}
            executions={[]}
            allExecutions={[]}
            todos={[]}
            status="ready"
            chatId={path}
          />
        )}
      </div>
      <Diagnostics />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <ThemeProvider
    attribute="class"
    defaultTheme={new URLSearchParams(location.search).get("theme") || "dark"}
    enableSystem={false}
  >
    <TooltipProvider>
      <ProShellProvider basePath="/">
        <LiveSidebarContentProvider>
          <App />
        </LiveSidebarContentProvider>
      </ProShellProvider>
    </TooltipProvider>
  </ThemeProvider>,
);
