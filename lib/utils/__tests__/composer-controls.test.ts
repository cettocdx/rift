import {
  consumeProjectSelectorRequest,
  COMPOSER_PROJECT_OPEN_EVENT,
  openModelSelector,
  openReasoningSelector,
  requestProjectSelector,
} from "../composer-controls";

function button(attributes: Record<string, string>) {
  const trigger = document.createElement("button");
  for (const [name, value] of Object.entries(attributes)) {
    trigger.setAttribute(name, value);
  }
  document.body.append(trigger);
  return trigger;
}

describe("composer control commands", () => {
  afterEach(() => {
    document.body.replaceChildren();
    window.sessionStorage.clear();
  });

  it.each([
    ["model", openModelSelector, { "data-ui": "model-selector-trigger" }],
    [
      "reasoning",
      openReasoningSelector,
      { "data-ui": "reasoning-effort-trigger" },
    ],
  ])("focuses and activates the visible %s picker", (_name, open, attrs) => {
    const trigger = button(attrs);
    const onClick = jest.fn();
    trigger.addEventListener("click", onClick);

    expect(open()).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("opens a mounted Radix model menu with its real keyboard contract", () => {
    const trigger = button({
      "aria-haspopup": "menu",
      "data-ui": "model-selector-trigger",
    });
    const onKeyDown = jest.fn();
    const onClick = jest.fn();
    trigger.addEventListener("keydown", onKeyDown);
    trigger.addEventListener("click", onClick);

    expect(openModelSelector()).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(onKeyDown).toHaveBeenCalledWith(
      expect.objectContaining({ code: "Enter", key: "Enter" }),
    );
    expect(onClick).not.toHaveBeenCalled();
  });

  it.each([
    ["model", openModelSelector],
    ["effort", openReasoningSelector],
  ])(
    "opens the combined %s view without toggling its popover",
    (view, open) => {
      const trigger = button({
        "data-rift-parameter-control": "",
        "data-ui": "model-selector-trigger",
      });
      const onClick = jest.fn();
      const intents: unknown[] = [];
      trigger.addEventListener("click", onClick);
      trigger.addEventListener("rift:composer-parameter-open", (event) => {
        intents.push((event as CustomEvent).detail);
        event.preventDefault();
      });
      expect(open()).toBe(true);
      expect(document.activeElement).toBe(trigger);
      expect(intents).toEqual([view]);
      expect(onClick).not.toHaveBeenCalled();
    },
  );

  it("falls back to the mounted legacy picker when a combined intent is unhandled", () => {
    const trigger = button({
      "data-rift-parameter-control": "",
      "data-ui": "model-selector-trigger",
    });
    const onClick = jest.fn();
    trigger.addEventListener("click", onClick);
    expect(openModelSelector()).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
    trigger.disabled = true;
    expect(openModelSelector()).toBe(false);
    expect(openReasoningSelector()).toBe(false);
  });

  it("carries a project-picker request across a new-task navigation", () => {
    expect(requestProjectSelector()).toBe(false);
    expect(consumeProjectSelectorRequest()).toBe(true);
    expect(consumeProjectSelectorRequest()).toBe(false);

    const trigger = button({ "aria-label": "Select project context" });
    const onClick = jest.fn();
    trigger.addEventListener("click", onClick);
    expect(requestProjectSelector()).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(consumeProjectSelectorRequest()).toBe(false);
  });

  it("reports unsupported controls instead of silently succeeding", () => {
    expect(openModelSelector()).toBe(false);
    expect(openReasoningSelector()).toBe(false);

    const disabledTrigger = button({
      "data-ui": "model-selector-trigger",
    });
    disabledTrigger.disabled = true;
    expect(openModelSelector()).toBe(false);
  });

  it("reveals the mobile settings surface without requesting new-task navigation", () => {
    const reveal = jest.fn((event: Event) => event.preventDefault());
    window.addEventListener(COMPOSER_PROJECT_OPEN_EVENT, reveal);
    try {
      expect(requestProjectSelector()).toBe(true);
      expect(reveal).toHaveBeenCalledTimes(1);
      expect(consumeProjectSelectorRequest()).toBe(true);
    } finally {
      window.removeEventListener(COMPOSER_PROJECT_OPEN_EVENT, reveal);
    }
    expect(requestProjectSelector()).toBe(false);
  });
});
