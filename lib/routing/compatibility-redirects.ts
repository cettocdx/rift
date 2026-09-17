import { getSettingsAliasRedirects } from "../settings/registry";

/**
 * Legacy entry points that should be resolved before React renders a route.
 *
 * Keeping these redirects in Next's routing layer avoids mounting a temporary
 * compatibility page while preserving the destination route as the only
 * owner of its authorization and server-side behavior.
 */
export const COMPATIBILITY_REDIRECTS = [
  {
    source: "/notebook",
    destination: "/hack",
    permanent: false,
  },
  {
    // Appearance had its own page AND a copy inside the settings dialog, both
    // rendering the same panel. Settings owns it now; the standalone page is
    // gone and its address still resolves.
    source: "/appearance",
    destination: "/settings/appearance",
    permanent: false,
  },
] as const;

export function getCompatibilityRedirects() {
  return [
    ...COMPATIBILITY_REDIRECTS.map((redirect) => ({ ...redirect })),
    // Settings owns its own alias list; this is where that list becomes real
    // routing rather than a client-side correction after the page has drawn.
    ...getSettingsAliasRedirects(),
  ];
}
