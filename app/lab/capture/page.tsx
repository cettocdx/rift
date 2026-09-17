import {
  ProductCaptureLab,
  type ProductCaptureView,
} from "@/app/components/landing/ProductCaptureLab";

const CAPTURE_VIEWS = new Set<ProductCaptureView>([
  "build",
  "studio",
  "agents",
  "appearance",
  "workbench",
  "workspace",
]);

export default async function ProductCapturePage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string | string[];
    scale?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const requested = Array.isArray(query.view) ? query.view[0] : query.view;
  const view = CAPTURE_VIEWS.has(requested as ProductCaptureView)
    ? (requested as ProductCaptureView)
    : "build";
  const requestedScale = Array.isArray(query.scale)
    ? query.scale[0]
    : query.scale;

  if (view === "build" && requestedScale === "3") {
    return (
      <div className="h-[2160px] w-[3840px] overflow-hidden bg-[#141414]">
        <div className="h-[720px] w-[1280px] origin-top-left scale-[3]">
          <ProductCaptureLab view={view} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden">
      <ProductCaptureLab view={view} />
    </div>
  );
}
