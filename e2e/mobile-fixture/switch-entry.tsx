import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { PersonalizationTab } from "../../app/components/PersonalizationTab";
import { Switch } from "../../components/ui/switch";
import { useFixtureCount } from "./switch-services";

function Fixture() {
  const count = useFixtureCount();
  const [checked, setChecked] = useState(false);
  const [labelCount, setLabelCount] = useState(0);
  const [neighborCount, setNeighborCount] = useState(0);
  const [compactCount, setCompactCount] = useState(0);
  return (
    <div className="pro-shell">
      <main
        className="pro-main"
        style={{ padding: 24, height: "100dvh", overflowY: "auto" }}
      >
        <PersonalizationTab
          subscription="pro"
          onCustomInstructions={() => {
            throw Error("Navigation disabled");
          }}
          onManageNotes={() => {
            throw Error("Navigation disabled");
          }}
        />
        <output aria-label="Notes changes">{count}</output>
        <div style={{ marginTop: 48 }}>
          <label className="flex min-h-10 items-center justify-between gap-4 border-b border-border py-2">
            <span>
              <span className="block text-ui-caption">Labelled setting</span>
              <span className="block text-[9.5px]">
                A second line like Appearance settings.
              </span>
            </span>
            <Switch
              checked={checked}
              onCheckedChange={(next) => {
                setChecked(next);
                setLabelCount((value) => value + 1);
              }}
              aria-label="Labelled setting"
            />
          </label>
          <div className="flex min-h-[58px] items-center justify-end gap-3 px-3.5 py-2.5">
            <Switch
              disabled
              checked
              aria-label="Disabled setting"
              onCheckedChange={() => {
                throw Error("Disabled switch changed");
              }}
            />
            <button
              type="button"
              aria-label="Neighbor action"
              className="size-7"
              onClick={() => setNeighborCount((value) => value + 1)}
            >
              More
            </button>
          </div>
        </div>
        <article style={{ marginTop: 32 }}>
          <button
            type="button"
            aria-label="Card details"
            className="flex h-11 w-full items-center"
            onClick={() => setNeighborCount((value) => value + 1)}
          >
            Card details
          </button>
          <div
            data-fixture="compact-footer"
            className="flex items-center justify-between border-t border-border/60 px-3 py-2"
          >
            <label htmlFor="compact-switch">Join matching work</label>
            <Switch
              id="compact-switch"
              aria-label="Compact setting"
              checked={compactCount % 2 === 1}
              onCheckedChange={() => setCompactCount((value) => value + 1)}
            />
          </div>
        </article>
        <output aria-label="Compact changes">{compactCount}</output>
        <output aria-label="Label changes">{labelCount}</output>
        <output aria-label="Neighbor changes">{neighborCount}</output>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
    <Fixture />
  </ThemeProvider>,
);
