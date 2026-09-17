import { createRoot } from "react-dom/client";
import { HackerMode } from "../../app/components/HackerMode";
import { TooltipProvider } from "../../components/ui/tooltip";

createRoot(document.getElementById("root")!).render(
  <TooltipProvider>
    <HackerMode chatId="isolated-mobile-hack" />
  </TooltipProvider>,
);
