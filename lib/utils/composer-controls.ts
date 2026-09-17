const CONTROL_SELECTORS = {
  model: 'button[data-ui="model-selector-trigger"]',
  project: 'button[aria-label="Select project context"]',
  reasoning: 'button[data-ui="reasoning-effort-trigger"]',
} as const;

const PENDING_PROJECT_SELECTOR_KEY = "rift:pending-project-selector";
export const COMPOSER_PARAMETER_OPEN_EVENT = "rift:composer-parameter-open";
export const COMPOSER_PROJECT_OPEN_EVENT = "rift:composer-project-open";

/** A command selects a parameter view; it must not toggle an already-open menu. */
function openCombinedParameter(view: "model" | "effort"): boolean {
  if (typeof document === "undefined") return false;
  const trigger = document.querySelector<HTMLButtonElement>(
    "button[data-rift-parameter-control]",
  );
  if (!trigger || trigger.disabled) return false;
  trigger.focus({ preventScroll: true });
  return !trigger.dispatchEvent(
    new CustomEvent(COMPOSER_PARAMETER_OPEN_EVENT, {
      detail: view,
      cancelable: true,
    }),
  );
}

function activateControl(selector: string): boolean {
  if (typeof document === "undefined") return false;

  const trigger = document.querySelector<HTMLButtonElement>(selector);
  if (!trigger || trigger.disabled) return false;

  trigger.focus({ preventScroll: true });
  if (trigger.getAttribute("aria-haspopup") === "menu") {
    // Radix dropdown triggers toggle from keydown/pointerdown, not click.
    // HTMLElement.click() therefore reports success without opening the model
    // or reasoning menu. Dispatch the same Enter interaction a keyboard user
    // performs so the mounted picker actually opens.
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "Enter",
        key: "Enter",
      }),
    );
  } else {
    trigger.click();
  }
  return true;
}

/** Open the model picker rendered by the active Build or Studio composer. */
export function openModelSelector(): boolean {
  return (
    openCombinedParameter("model") || activateControl(CONTROL_SELECTORS.model)
  );
}

/** Open the model-aware reasoning control rendered by a Build composer. */
export function openReasoningSelector(): boolean {
  return (
    openCombinedParameter("effort") ||
    activateControl(CONTROL_SELECTORS.reasoning)
  );
}

/**
 * Open the current project picker or persist a one-shot request across the
 * navigation from an existing conversation to the new-task surface.
 */
export function requestProjectSelector(): boolean {
  if (activateControl(CONTROL_SELECTORS.project)) return true;
  if (typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(PENDING_PROJECT_SELECTOR_KEY, "true");
  } catch {
    // The runtime still provides explicit navigation/feedback when a host
    // disables session storage; never throw from a slash command.
  }
  // Mobile keeps the project selector in its settings sheet. Let that surface
  // reveal the picker before the caller navigates away from the current draft.
  return !window.dispatchEvent(
    new CustomEvent(COMPOSER_PROJECT_OPEN_EVENT, { cancelable: true }),
  );
}

/** Consume the one-shot project-picker request when the new-task UI mounts. */
export function consumeProjectSelectorRequest(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const pending =
      window.sessionStorage.getItem(PENDING_PROJECT_SELECTOR_KEY) === "true";
    if (pending) window.sessionStorage.removeItem(PENDING_PROJECT_SELECTOR_KEY);
    return pending;
  } catch {
    return false;
  }
}
