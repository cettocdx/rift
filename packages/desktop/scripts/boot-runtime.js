/** The offline launch document owns connectivity until its navigation commits. */
function startLaunch(scope, appUrl) {
  const root = scope.document.querySelector(".rift-launch");
  const status = scope.document.getElementById("status-text");
  const message = scope.document.getElementById("error-message");
  const button = scope.document.getElementById("retry-btn");
  let phase = "idle";
  let disposed = false;
  let controller = null;
  let probeTimeout = null;
  let navigationTimeout = null;

  function clearTimers() {
    if (probeTimeout !== null) scope.clearTimeout(probeTimeout);
    if (navigationTimeout !== null) scope.clearTimeout(navigationTimeout);
    probeTimeout = null;
    navigationTimeout = null;
  }

  function showError(text) {
    if (disposed) return;
    clearTimers();
    phase = "error";
    root.dataset.state = "error";
    status.textContent = "Unable to open RIFT";
    message.textContent = text;
    message.hidden = false;
    button.hidden = false;
    button.disabled = false;
  }

  async function retry() {
    if (disposed || phase === "connecting" || phase === "navigating") return;
    phase = "connecting";
    clearTimers();
    root.dataset.state = "loading";
    status.textContent = "Opening RIFT";
    message.hidden = true;
    button.hidden = true;
    button.disabled = true;
    const attempt = new scope.AbortController();
    controller = attempt;
    let timedOut = false;
    probeTimeout = scope.setTimeout(() => {
      timedOut = true;
      attempt.abort();
    }, 5000);

    try {
      // Probe exactly the destination. An opaque no-CORS response proves only
      // that it is reachable; the app's own auth and loading flow follows.
      const response = await scope.fetch(appUrl, {
        method: "HEAD",
        mode: "no-cors",
        cache: "no-store",
        signal: attempt.signal,
      });
      if (disposed || attempt.signal.aborted) return;
      if (response.type !== "opaque" && !response.ok) {
        showError("RIFT is unavailable right now. Please try again shortly.");
        return;
      }
      phase = "navigating";
      // If the old document remains mounted after a failed/stalled navigation,
      // bring its retry control back. A committed navigation disposes this page.
      navigationTimeout = scope.setTimeout(() => {
        showError(
          "RIFT is taking longer than expected to open. Please try again.",
        );
      }, 15000);
      scope.location.replace(appUrl);
    } catch {
      if (disposed) return;
      showError(
        timedOut
          ? "The connection to RIFT timed out. Please try again."
          : "Couldn’t reach RIFT. Check your connection and try again.",
      );
    } finally {
      if (probeTimeout !== null) scope.clearTimeout(probeTimeout);
      probeTimeout = null;
      if (controller === attempt) controller = null;
    }
  }

  function onOnline() {
    // Reconnection may retry a failed launch, but never overlap a current one.
    if (phase === "error") void retry();
  }
  function dispose() {
    disposed = true;
    clearTimers();
    controller?.abort();
    controller = null;
    scope.removeEventListener("online", onOnline);
    scope.removeEventListener("pagehide", dispose);
    button.removeEventListener("click", retry);
  }

  button.addEventListener("click", retry);
  scope.addEventListener("online", onOnline);
  scope.addEventListener("pagehide", dispose);
  void retry();
  return dispose;
}

module.exports = { startLaunch };
