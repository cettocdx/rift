import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import ScrollPreview from "../../app/lab/scroll/page";
import FocusPreview from "../../app/lab/focus/page";
import BrowserFixture from "../../app/lab/browser/page";

// These are isolated component fixtures, not authenticated application routes.
const pages: Record<string, React.ComponentType> = {
  "/lab/scroll": ScrollPreview,
  "/lab/focus": FocusPreview,
  "/lab/browser": BrowserFixture,
};
const Page = pages[window.location.pathname];
createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
    <div data-mobile-fixture={window.location.pathname}>
      {Page ? <Page /> : <p>Unknown mobile fixture</p>}
    </div>
  </ThemeProvider>,
);
