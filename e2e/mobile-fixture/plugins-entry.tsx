import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { McpMarketplace } from "../../app/components/McpMarketplace";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
    <div className="pro-shell" style={{ height: "100dvh" }}>
      <main className="pro-main" style={{ height: "100%" }}>
        <McpMarketplace
          navigateToAuthorization={() => {
            throw Error("Authorization disabled in fixture");
          }}
        />
      </main>
    </div>
  </ThemeProvider>,
);
