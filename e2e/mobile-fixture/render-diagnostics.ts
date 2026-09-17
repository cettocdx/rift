/** Read-only, allowlisted fixture nodes; never capture message text/user data. */
export function readRenderDiagnostics() {
  const selectors = {
    pane: "[data-rift-tool-pane]",
    dock: '[data-ui="workbench-dock"]',
    body: '[data-ui="workbench-dock"] [role="tabpanel"]:not([hidden])',
    tab: '[data-ui="workbench-dock"] [role="tab"][aria-selected="true"]',
    row: '[data-testid^="chat-item-"][data-active="true"]',
  };
  const entries: [string, Element | null][] = Object.entries(selectors).map(
    ([key, selector]) => [key, document.querySelector(selector)],
  );
  const row = entries.find(([key]) => key === "row")?.[1];
  let wrapper = row?.parentElement ?? null;
  for (let depth = 0; wrapper && depth < 8; depth++) {
    if (wrapper.style.contentVisibility === "auto") break;
    wrapper = wrapper.parentElement;
  }
  entries.push(["rowWrapper", wrapper]);
  // Both the active row and the old row matter when DOM and painted selection disagree.
  document
    .querySelectorAll('[data-testid^="chat-item-"]')
    .forEach((node, i) => {
      if (i < 10) entries.push([`sidebarRow${i}`, node]);
    });
  return {
    capturedAt: performance.now(),
    path: location.pathname,
    visibilityState: document.visibilityState,
    viewport: {
      width: innerWidth,
      height: innerHeight,
      scale: visualViewport?.scale ?? null,
    },
    nodes: Object.fromEntries(
      entries.map(([key, node]) => {
        if (!node) return [key, null];
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return [
          key,
          {
            tag: node.tagName,
            id: node.id,
            attributes: Object.fromEntries(
              [
                "hidden",
                "inert",
                "data-active",
                "aria-current",
                "aria-hidden",
                "aria-selected",
                "data-visible",
                "data-testid",
              ].map((name) => [name, node.getAttribute(name)]),
            ),
            style: {
              backgroundColor: style.backgroundColor,
              color: style.color,
              opacity: style.opacity,
              display: style.display,
              visibility: style.visibility,
              contentVisibility: style.contentVisibility,
              transform: style.transform,
              animationName: style.animationName,
              animationPlayState: style.animationPlayState,
            },
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            animations: node
              .getAnimations({ subtree: false })
              .map((animation) => ({
                name:
                  "animationName" in animation ? animation.animationName : null,
                currentTime:
                  animation.currentTime === null
                    ? null
                    : String(animation.currentTime),
                startTime:
                  animation.startTime === null
                    ? null
                    : String(animation.startTime),
                playState: animation.playState,
                pending: animation.pending,
                playbackRate: animation.playbackRate,
                timing: animation.effect?.getComputedTiming() ?? null,
              })),
          },
        ];
      }),
    ),
  };
}
