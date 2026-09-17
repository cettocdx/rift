import { NewProjectDialog } from "../../app/components/projects/NewProjectDialog";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { AgentProfileDialog } from "../../app/components/agents/AgentProfileDialog";
import { ThemeProvider } from "next-themes";
import { RunsWorkbench } from "../../app/components/runs/RunsWorkbench";
import { ArtifactsGallery } from "../../app/components/ArtifactsGallery";
import { TaskCenter } from "../../app/components/tasks/TaskCenter";
import { ProjectBotsWorkbench } from "../../app/components/agents/ProjectBotsWorkbench";
import { AppearanceSettingsTab } from "../../app/components/AppearanceSettingsTab";
import { SettingsShell } from "../../app/components/settings/SettingsShell";
import { ProShellProvider } from "../../app/components/pro/ProShellContext";
const params = new URLSearchParams(location.search);
const section = params.get("section");
const theme = params.get("theme") === "dark" ? "dark" : "light";
function NewProjectFixture() {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState("");
  return (
    <>
      <button onClick={() => setOpen(true)}>New project fixture</button>
      <output>{saved}</output>
      <NewProjectDialog
        open={open}
        onClose={() => setOpen(false)}
        onCreate={async (name, type) => {
          setSaved(`${name}:${type}`);
          return true;
        }}
      />
    </>
  );
}
function AgentProfileFixture() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Configure fixture agent</button>
      <AgentProfileDialog
        open={open}
        onClose={() => setOpen(false)}
        installedSkills={[]}
        mcpServers={[]}
        minSkills={0}
        saving={false}
        onSave={async () => {
          throw new Error("Fixture must not save an agent");
        }}
      />
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" forcedTheme={theme} enableSystem={false}>
    <ProShellProvider basePath="/">
      <div className="pro-shell" style={{ height: "100dvh" }}>
        <main
          className="pro-main"
          style={{ height: "100%", overflowY: "auto" }}
        >
          {section === "new-project" ? (
            <NewProjectFixture />
          ) : section === "agent-profile" ? (
            <AgentProfileFixture />
          ) : section === "runs" ? (
            <RunsWorkbench />
          ) : section === "artifacts" ? (
            <ArtifactsGallery />
          ) : section === "tasks" ? (
            <TaskCenter />
          ) : section === "agents" ? (
            <ProjectBotsWorkbench />
          ) : (
            <SettingsShell nav={null}>
              <AppearanceSettingsTab />
            </SettingsShell>
          )}
        </main>
      </div>
    </ProShellProvider>
  </ThemeProvider>,
);
