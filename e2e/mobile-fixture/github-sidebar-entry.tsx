import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { SidebarGithub } from "../../app/components/SidebarGithub";
import type { Id } from "../../convex/_generated/dataModel";
const chats = [
  {
    id: "existing-chat",
    _id: "fixture-chat-record" as Id<"chats">,
    _creationTime: 1,
    user_id: "fixture-user",
    update_time: 1,
    project_id: "project-existing" as Id<"projects">,
    title: "Existing repository session",
  },
];
createRoot(document.getElementById("root")!).render(
  <ThemeProvider
    attribute="class"
    defaultTheme={new URLSearchParams(location.search).get("theme") || "dark"}
    enableSystem={false}
  >
    <div className="pro-shell min-h-screen bg-background text-foreground">
      <aside
        className="pro-sidebar min-h-screen w-[280px] max-w-full bg-sidebar pt-6"
        data-rift-sidebar-panel
      >
        <SidebarGithub chats={chats} />
      </aside>
    </div>
  </ThemeProvider>,
);
