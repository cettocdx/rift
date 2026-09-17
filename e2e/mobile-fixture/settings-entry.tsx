import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import {
  SettingsShell,
  SettingsPageHeader,
} from "../../app/components/settings/SettingsShell";
import { ProShellProvider } from "../../app/components/pro/ProShellContext";
import { ApiKeysTab } from "../../app/components/ApiKeysTab";
import { AccountTab } from "../../app/components/AccountTab";
import { ExtraUsageSection } from "../../app/components/ExtraUsageSection";
import { AppearanceSettingsTab } from "../../app/components/AppearanceSettingsTab";
import {
  installClipboardBoundary,
  useFixtureCounts,
} from "./settings-services";
installClipboardBoundary();
function Fixture() {
  const section = new URLSearchParams(location.search).get("section");
  const counts = useFixtureCounts();
  const content =
    section === "account" ? (
      <AccountTab />
    ) : section === "billing" ? (
      <ExtraUsageSection />
    ) : section === "appearance" ? (
      <AppearanceSettingsTab />
    ) : (
      <ApiKeysTab subscription="pro" />
    );
  return (
    <ProShellProvider basePath="/">
      <div className="pro-shell" style={{ height: "100dvh" }}>
        <main className="pro-main" style={{ height: "100%" }}>
          <SettingsShell nav={null}>
            <SettingsPageHeader title="Fixture settings" />
            {content}
            <output aria-label="Fixture calls">{counts}</output>
          </SettingsShell>
        </main>
      </div>
    </ProShellProvider>
  );
}
createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
    <Fixture />
  </ThemeProvider>,
);
