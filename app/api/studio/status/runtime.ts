type StudioRuntimeEnvironment = {
  OPENROUTER_API_KEY?: string;
  NEXT_PUBLIC_CONVEX_URL?: string;
  CONVEX_SERVICE_ROLE_KEY?: string;
};

export function getStudioRuntimeStatus(
  env: StudioRuntimeEnvironment = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
    CONVEX_SERVICE_ROLE_KEY: process.env.CONVEX_SERVICE_ROLE_KEY,
  },
) {
  const providerConfigured = Boolean(env.OPENROUTER_API_KEY?.trim());
  const storageConfigured = Boolean(
    env.NEXT_PUBLIC_CONVEX_URL?.trim() && env.CONVEX_SERVICE_ROLE_KEY?.trim(),
  );
  const missing = [
    ...(providerConfigured ? [] : ["OpenRouter generation"]),
    ...(storageConfigured ? [] : ["durable media storage"]),
  ];

  return {
    ready: providerConfigured && storageConfigured,
    missing,
  };
}
