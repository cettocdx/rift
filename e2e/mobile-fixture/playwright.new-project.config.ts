import { defineConfig } from "@playwright/test";
import workspace from "./playwright.workspace-targets.config";
export default defineConfig({
  ...workspace,
  testMatch: "new-project.fixture.ts",
  outputDir: "./results/new-project",
  reporter: "list",
  projects: workspace.projects!.filter((p) =>
    /-360-coarse$|-desktop$/.test(p.name!),
  ),
});
