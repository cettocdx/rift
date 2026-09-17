export type ProductSurfaceId = "build" | "studio" | "hack";

export type ProductSurface = {
  id: ProductSurfaceId;
  label: string;
  outcome: string;
  detail: string;
  imageSrc: string;
  imageAlt: string;
};

export const PRODUCT_SURFACES: readonly ProductSurface[] = [
  {
    id: "build",
    label: "Build",
    outcome: "A task becomes a verified change.",
    detail:
      "Plan, file edits, terminal output and verification stay in one run.",
    imageSrc: "/landing/product/build-product-design-4k.webp",
    imageAlt: "RIFT Build showing an agent task and its execution workspace.",
  },
  {
    id: "studio",
    label: "Studio",
    outcome: "A prompt becomes production media.",
    detail: "Image and video models share one composer and one output history.",
    imageSrc: "/landing/product/studio-4k.webp",
    imageAlt:
      "RIFT Studio showing available generation models and output controls.",
  },
  {
    id: "hack",
    label: "Hack",
    outcome: "A scoped assessment becomes evidence.",
    detail:
      "Authorized targets, tool output and verified findings stay connected.",
    imageSrc: "/landing/product/workbench-4k.webp",
    imageAlt: "RIFT Hack showing a scoped security assessment workspace.",
  },
] as const;

export const BUILD_STEPS = [
  {
    label: "Plan",
    title: "Turn intent into a concrete run.",
    body: "RIFT reads the workspace, defines the change and makes the execution path visible before the handoff.",
  },
  {
    label: "Execute",
    title: "Work inside the real environment.",
    body: "Files, packages and terminal commands stay attached to the environment the agent is using.",
  },
  {
    label: "Verify",
    title: "Return evidence, not confidence.",
    body: "Tests, type checks and the resulting diff remain attached to the run that produced them.",
  },
] as const;

export type StudioOutput = {
  id: string;
  label: string;
  model: string;
  modality: "Image" | "Video";
  imageSrc: string;
  imageAlt: string;
  videoSrc?: string;
};

export const STUDIO_OUTPUTS: readonly StudioOutput[] = [
  {
    id: "material",
    label: "Industrial object",
    model: "Image model",
    modality: "Image",
    imageSrc: "/studio/showcase-v3/image-flux-4k.webp",
    imageAlt:
      "Reference media showing a reflective chrome and translucent product form on dark stone.",
  },
  {
    id: "product",
    label: "Desert architecture",
    model: "Image model",
    modality: "Image",
    imageSrc: "/studio/showcase-v3/image-gemini-pro-4k.webp",
    imageAlt:
      "Reference media showing a modern sandstone building set against red desert cliffs.",
  },
  {
    id: "landscape",
    label: "Color study",
    model: "Image model",
    modality: "Image",
    imageSrc: "/studio/showcase-v3/image-lite-4k.webp",
    imageAlt:
      "Reference media showing a blank product surface surrounded by colorful translucent materials.",
  },
  {
    id: "motion",
    label: "Character continuity",
    model: "Video model",
    modality: "Video",
    imageSrc: "/studio/showcase-v3/video-kling-4k.webp",
    imageAlt:
      "Reference media showing a woman running across wet stone platforms in a cinematic environment.",
    videoSrc: "/studio/showcase-v3/video-kling-4k.mp4",
  },
] as const;

export const CONTINUITY_STEPS = [
  {
    id: "build",
    label: "01 / Build",
    title: "Start with the system.",
    body: "The repository, files and execution history establish the working context.",
  },
  {
    id: "studio",
    label: "02 / Studio",
    title: "Create inside that context.",
    body: "Media generation becomes part of the same project instead of a separate tab and export loop.",
  },
  {
    id: "hack",
    label: "03 / Hack",
    title: "Investigate without losing the thread.",
    body: "Authorized assessment evidence returns to the same body of work.",
  },
] as const;

export const ENTERPRISE_CONTROLS = [
  {
    title: "Controlled execution",
    body: "Cloud runs can use isolated sandboxes, while local mode stays explicit to the selected workspace.",
  },
  {
    title: "Authorized operation launcher",
    body: "Guided Hack operations collect the target, scope and authorization before launch.",
  },
  {
    title: "Credential boundaries",
    body: "Connected MCP OAuth credentials are stored and retrieved outside prompt copy.",
  },
] as const;

export const F1_NAV_LINKS = [
  { label: "Product", href: "#product" },
  { label: "Studio", href: "#studio" },
  { label: "Hack", href: "#system" },
  { label: "Enterprise", href: "#enterprise" },
  { label: "Pricing", href: "#pricing" },
] as const;
