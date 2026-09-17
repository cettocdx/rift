import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import {
  ProductCaptureLab,
  type ProductCaptureView,
} from "../../app/components/landing/ProductCaptureLab";
const view =
  (new URLSearchParams(location.search).get("view") as ProductCaptureView) ||
  "build";
createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" forcedTheme="dark">
    <ProductCaptureLab view={view} />
    <div
      style={{
        position: "fixed",
        bottom: 8,
        right: 12,
        zIndex: 9999,
        fontSize: 10,
        color: "#aaa",
        background: "#141414",
        padding: "3px 7px",
        borderRadius: 4,
      }}
    >
      Staged product demo · No live execution
    </div>
  </ThemeProvider>,
);
