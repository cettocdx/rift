import { RunsWorkbench } from "@/app/components/runs/RunsWorkbench";
import { ProtectedPageBoundary } from "@/app/components/page-shell/ProtectedPageBoundary";

/**
 * Runs as a first-class destination. Renders inside the shared (chat) layout so
 * the sidebar stays mounted and a run is one click from the conversation that
 * produced it.
 */
export default function RunsPage() {
  return (
    <ProtectedPageBoundary resource="runs">
      <RunsWorkbench />
    </ProtectedPageBoundary>
  );
}
