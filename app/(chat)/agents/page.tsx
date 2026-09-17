import { Suspense } from "react";
import { ProjectBotsWorkbench } from "@/app/components/agents/ProjectBotsWorkbench";
import { ProtectedPageBoundary } from "@/app/components/page-shell/ProtectedPageBoundary";

export default function AgentsPage() {
  return (
    <ProtectedPageBoundary resource="agents and teams">
      <Suspense
        fallback={
          <div role="status" className="p-6 text-sm text-muted-foreground">
            Loading bots…
          </div>
        }
      >
        <ProjectBotsWorkbench />
      </Suspense>
    </ProtectedPageBoundary>
  );
}
