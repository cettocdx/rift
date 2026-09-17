"use client";

import { ProShortcutsDialog } from "@/app/components/pro/ProShortcutsDialog";
import { Workbench } from "./Workbench";
import {
  WorkbenchActivityAutoOpen,
  WorkbenchActivityProvider,
} from "./WorkbenchActivity";
import { WorkbenchActiveEditor, WorkbenchEditorTabs } from "./WorkbenchEditor";
import { SandboxWorkbenchProvider } from "./WorkbenchProvider";
import { WorkbenchCommandPalette } from "./WorkbenchCommandPalette";
import { useWorkbenchKeyboardShortcuts } from "./useWorkbenchKeyboardShortcuts";

function CursorIdeSurface({ children }: { children: React.ReactNode }) {
  useWorkbenchKeyboardShortcuts();

  return (
    <>
      <WorkbenchActivityAutoOpen />
      <Workbench.Root>
        <Workbench.Titlebar />
        <Workbench.Body>
          <Workbench.ActivityRail />
          <Workbench.Sidebar>
            <Workbench.SidebarContent />
          </Workbench.Sidebar>
          <Workbench.EditorGroup>
            <Workbench.EditorPane>
              <WorkbenchEditorTabs />
              <WorkbenchActiveEditor />
            </Workbench.EditorPane>
            <Workbench.BottomPanel>
              <Workbench.AgentTerminal />
            </Workbench.BottomPanel>
          </Workbench.EditorGroup>
          <Workbench.AgentPane>{children}</Workbench.AgentPane>
        </Workbench.Body>
        <Workbench.MobileNavigation />
        <Workbench.StatusBar />
      </Workbench.Root>

      <WorkbenchCommandPalette />
      <ProShortcutsDialog />
    </>
  );
}

export function CursorIdeLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkbenchActivityProvider>
      <SandboxWorkbenchProvider>
        <CursorIdeSurface>{children}</CursorIdeSurface>
      </SandboxWorkbenchProvider>
    </WorkbenchActivityProvider>
  );
}
