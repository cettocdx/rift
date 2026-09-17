/** WebKit's unsupported viewport token notice is not an application failure. */
export function isKnownBrowserDiagnostic(browserName: string, message: string) {
  return (
    browserName === "webkit" &&
    message ===
      'Viewport argument key "interactive-widget" not recognized and ignored.'
  );
}
