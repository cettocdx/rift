/** Allowlisted provider configuration. Shared imports must remain Node-free. */
export type ProviderContext = Readonly<{
  openaiApiKey: string | undefined;
  openaiBaseUrl: string | undefined;
  openaiOrganization: string | undefined;
  openaiProject: string | undefined;
  openrouterApiKey: string | undefined;
  perplexityApiKey: string | undefined;
  jinaApiKey: string | undefined;
  previewRagApiKey: string | undefined;
  previewRagBaseUrl: string;
}>;
let readContext: (() => ProviderContext | undefined) | undefined;

export function installProviderContextReader(
  reader: () => ProviderContext | undefined,
) {
  readContext = reader;
}

export function captureProviderContext(): ProviderContext {
  return Object.freeze({
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
    openaiOrganization: process.env.OPENAI_ORG_ID,
    openaiProject: process.env.OPENAI_PROJECT_ID,
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    perplexityApiKey: process.env.PERPLEXITY_API_KEY,
    jinaApiKey: process.env.JINA_API_KEY,
    previewRagApiKey: process.env.PREVIEW_RAG_API_KEY,
    previewRagBaseUrl: process.env.PREVIEW_RAG_URL || "https://api.preview.is",
  });
}

/** An existing scope, including missing keys, never borrows current environment. */
export function getProviderContext(): ProviderContext {
  return readContext?.() ?? captureProviderContext();
}
