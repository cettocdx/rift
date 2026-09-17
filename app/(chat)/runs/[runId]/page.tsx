import { RunDetail } from "@/app/components/runs/RunDetail";
import { ProtectedPageBoundary } from "@/app/components/page-shell/ProtectedPageBoundary";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return (
    <ProtectedPageBoundary resource="runs">
      <RunDetail runId={decodeURIComponent(runId)} />
    </ProtectedPageBoundary>
  );
}
