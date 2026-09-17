import React, { useState } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { createRoot } from "react-dom/client";
import { ComputerCodeBlock } from "../../app/components/ComputerCodeBlock";
import { TooltipProvider } from "../../components/ui/tooltip";
import { DiffView } from "../../app/components/DiffView";

function CodeFixture() {
  const [wrap, setWrap] = useState(true);
  return (
    <TooltipProvider>
      <div
        style={{ height: "100vh", display: "flex", flexDirection: "column" }}
      >
        <button onClick={() => setWrap((value) => !value)}>Parent wrap</button>
        <ComputerCodeBlock language="text" wrap={wrap}>
          {"  first\n" + "long ".repeat(80) + "\nlast\n"}
        </ComputerCodeBlock>
      </div>
    </TooltipProvider>
  );
}
function Fixture() {
  const [visible, setVisible] = useState(true);
  const { setTheme } = useTheme();
  return (
    <div style={{ height: "100vh" }}>
      <button onClick={() => setTheme("light")}>Light theme</button>
      <button onClick={() => setTheme("dark")}>Dark theme</button>
      <button onClick={() => setVisible(false)}>Close diff</button>
      {visible && (
        <DiffView
          originalContent="export const before = 1;"
          modifiedContent="export const after = 2;"
          language="typescript"
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
    {location.search.includes("code") ? <CodeFixture /> : <Fixture />}
  </ThemeProvider>,
);
