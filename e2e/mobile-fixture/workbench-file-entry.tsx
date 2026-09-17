import React from "react";
import { createRoot } from "react-dom/client";
import { Workbench } from "../../app/components/workbench/Workbench";
import { WorkbenchExplorer } from "../../app/components/workbench/WorkbenchExplorer";
import { WorkbenchProvider } from "../../app/components/workbench/WorkbenchProvider";

import {
  WorkbenchActiveEditor,
  WorkbenchEditorTabs,
} from "../../app/components/workbench/WorkbenchEditor";

import type { WorkbenchAdapter } from "../../app/components/workbench/types";

const initialContent = "export const greeting = 'hello';";
const evidence = {
  reads: 0,
  writes: [] as Array<{
    path: string;
    content: string;
    expectedRevision: string;
  }>,
};
const controls = { failNextWrite: false, newNestedFile: false };
Object.assign(window, {
  workbenchFileEvidence: evidence,
  workbenchFileControls: controls,
});
const adapter: WorkbenchAdapter = {
  async listDirectory(path) {
    return {
      path,
      entries:
        path === "src"
          ? [
              {
                name: controls.newNestedFile ? "new.ts" : "nested.ts",
                path: controls.newNestedFile ? "src/new.ts" : "src/nested.ts",
                type: "file",
                size: 0,
                modifiedAt: null,
              },
            ]
          : [
              {
                name: "src",
                path: "src",
                type: "directory",
                size: 0,
                modifiedAt: null,
              },
              {
                name: "hello.ts",
                path: "hello.ts",
                type: "file",
                size: initialContent.length,
                modifiedAt: null,
              },
            ],
      truncated: false,
    };
  },
  async readFile(path) {
    evidence.reads++;
    return {
      path,
      content: initialContent,
      revision: "revision-1",
      size: initialContent.length,
      modifiedAt: null,
    };
  },
  async writeFile(args) {
    evidence.writes.push({ ...args });
    if (controls.failNextWrite) {
      controls.failNextWrite = false;
      throw new Error("Fixture save failed");
    }
    return {
      path: args.path,
      revision: "revision-2",
      size: args.content.length,
      modifiedAt: null,
    };
  },
  async readGit() {
    return { repositoryPath: null, status: null, truncated: false };
  },
  async readGitDiff() {
    throw new Error("Unexpected git diff");
  },
  async mutateGit() {
    throw new Error("Unexpected git mutation");
  },
};

function App() {
  return (
    <div style={{ height: "100dvh", display: "flex" }}>
      <WorkbenchProvider adapter={adapter}>
        <Workbench.Root>
          <Workbench.Titlebar />
          <Workbench.Body>
            <Workbench.Sidebar>
              <WorkbenchExplorer />
            </Workbench.Sidebar>
            <Workbench.EditorGroup>
              <Workbench.EditorPane>
                <WorkbenchEditorTabs />
                <WorkbenchActiveEditor />
              </Workbench.EditorPane>
              <Workbench.BottomPanel>
                <div>Terminal session</div>
              </Workbench.BottomPanel>
            </Workbench.EditorGroup>
            <Workbench.AgentPane>
              <div>Agent conversation</div>
            </Workbench.AgentPane>
          </Workbench.Body>
          <Workbench.MobileNavigation />
        </Workbench.Root>
      </WorkbenchProvider>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
