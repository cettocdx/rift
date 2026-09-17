import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import SidebarHistory from "../../app/components/SidebarHistory";
import { ProShellProvider } from "../../app/components/pro/ProShellContext";
import { TooltipProvider } from "../../components/ui/tooltip";
import { usePathname } from "./sidebar-services";
const chats = Array.from({ length: 10 }, (_, i) => ({
  _id: `record-${i}`,
  id: `chat-${i}`,
  title: `Conversation ${i + 1}`,
}));
function App() {
  const path = usePathname();
  const [open, setOpen] = useState(true);
  return (
    <div className="pro-shell flex h-screen bg-background text-foreground">
      {open && (
        <aside
          className="pro-sidebar h-full w-[280px] shrink-0 overflow-auto bg-sidebar pt-20"
          data-rift-sidebar-panel
        >
          <SidebarHistory chats={chats} paginationStatus="Exhausted" />
        </aside>
      )}
      <main className="flex-1 p-8">
        <button onClick={() => setOpen(!open)}>Toggle sidebar</button>
        <p data-testid="current-route">{path}</p>
      </main>
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
        <App />
      </ProShellProvider>
    </TooltipProvider>
  </ThemeProvider>,
);
