import { ArtifactsGallery } from "@/app/components/ArtifactsGallery";
import { ProtectedPageBoundary } from "@/app/components/page-shell/ProtectedPageBoundary";

/**
 * Full-page Artifacts gallery — every image and video the user has sent or
 * received. Renders inside the shared (chat) layout so the sidebar stays
 * mounted.
 */
export default function ArtifactsPage() {
  return (
    <ProtectedPageBoundary resource="artifacts">
      <ArtifactsGallery />
    </ProtectedPageBoundary>
  );
}
