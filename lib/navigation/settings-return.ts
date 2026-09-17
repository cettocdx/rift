const KEY = "rift:settings-return";
export const SETTINGS_RETURN_CHANGED = "rift:settings-return-changed";

/** Only return within this app; never to an auth or settings detour. */
export function validSettingsReturn(
  href: string | null,
  basePath = "/",
): string {
  if (!href?.startsWith("/") || href.startsWith("//") || /[\\\r\n]/.test(href))
    return basePath;
  const path = href.split(/[?#]/)[0];
  if (
    /(?:^|\/)(?:settings|login|signup|logout|desktop-login|desktop-callback)(?:\/|$)/.test(
      path,
    )
  )
    return basePath;
  if (basePath !== "/" && path !== basePath && !path.startsWith(`${basePath}/`))
    return basePath;
  return href;
}

export function rememberSettingsReturn(href: string) {
  if (validSettingsReturn(href) !== href) return;
  try {
    if (sessionStorage.getItem(KEY) === href) return;
    sessionStorage.setItem(KEY, href);
    window.dispatchEvent(new Event(SETTINGS_RETURN_CHANGED));
  } catch {
    /* A blocked session store should not block navigation. */
  }
}

export function readSettingsReturn(basePath: string) {
  try {
    return validSettingsReturn(sessionStorage.getItem(KEY), basePath);
  } catch {
    return basePath;
  }
}

export function subscribeSettingsReturn(listener: () => void) {
  window.addEventListener(SETTINGS_RETURN_CHANGED, listener);
  return () => window.removeEventListener(SETTINGS_RETURN_CHANGED, listener);
}
