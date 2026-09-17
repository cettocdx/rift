import { PluginsWorkbench } from "@/app/components/PluginsWorkbench";
import { ProtectedPageBoundary } from "@/app/components/page-shell/ProtectedPageBoundary";

/**
 * Full-page Plugins + Skills workbench. Renders inside the shared (chat) layout,
 * so the sidebar stays mounted to the left and the marketplace fills the main
 * content area — the Codex / Cursor plugin-store experience.
 */
export default function PluginsPage() {
  return (
    <ProtectedPageBoundary resource="plugins and skills">
      <PluginsWorkbench />
    </ProtectedPageBoundary>
  );
}
