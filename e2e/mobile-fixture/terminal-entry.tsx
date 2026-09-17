import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkbenchInteractiveTerminal } from "../../app/components/workbench/WorkbenchInteractiveTerminal";

function Fixture() {
  const [hidden, setHidden] = useState(false);
  const [narrow, setNarrow] = useState(false);
  return (
    <main>
      <nav>
        <button onClick={() => setHidden((v) => !v)}>Toggle panel</button>
        <button onClick={() => setNarrow((v) => !v)}>Resize panel</button>
        <label>
          Draft <input aria-label="Chat draft" />
        </label>
      </nav>
      <section
        style={{
          height: 520,
          width: narrow ? "72%" : "100%",
          display: hidden ? "none" : "block",
        }}
      >
        <WorkbenchInteractiveTerminal
          clientTerminalId="fixture-terminal"
          label="Shell"
          profile="shell"
        />
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
