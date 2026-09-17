export const OAUTH_RESULT_MESSAGES: Record<
  string,
  { kind: "success" | "error"; message: string }
> = {
  connected: {
    kind: "success",
    message: "GitHub connected. Choose repositories to add to your projects.",
  },
  denied: {
    kind: "error",
    message:
      "GitHub authorization was cancelled. Your existing projects are unchanged.",
  },
  auth_required: {
    kind: "error",
    message: "Sign in to RIFT, then connect GitHub.",
  },
  not_configured: {
    kind: "error",
    message:
      "GitHub connection is not configured on this RIFT server. The administrator needs to set up the GitHub app.",
  },
  configuration_error: {
    kind: "error",
    message:
      "GitHub rejected RIFT’s app configuration. The administrator needs to check the client credentials and callback address.",
  },
  provider_unavailable: {
    kind: "error",
    message:
      "GitHub could not be reached. Your projects are saved; try connecting again.",
  },
  bad_state: {
    kind: "error",
    message: "GitHub connection expired. Start a new connection from RIFT.",
  },
  no_code: {
    kind: "error",
    message:
      "GitHub did not return an authorization code. Try connecting again.",
  },
  exchange_failed: {
    kind: "error",
    message:
      "GitHub authorization expired or was already used. Start a new connection from RIFT.",
  },
  mcp_failed: {
    kind: "error",
    message:
      "GitHub is connected, but its plugin could not be enabled. You can still add repositories; retry the plugin from Plugins.",
  },
  error: {
    kind: "error",
    message: "GitHub connection could not be saved. Try connecting again.",
  },
};
