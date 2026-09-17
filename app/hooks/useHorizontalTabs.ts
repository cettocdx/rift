import { useId, useRef, type KeyboardEvent } from "react";

/** Automatic activation for horizontal tabs whose content is available locally. */
export function useHorizontalTabs<T extends string>(
  values: readonly T[],
  selected: T,
  onSelect: (value: T) => void,
) {
  const baseId = useId();
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const tabId = (value: T) => `${baseId}-tab-${value}`;
  const panelId = (value: T) => `${baseId}-panel-${value}`;

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, value: T) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const index = values.indexOf(value);
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (index + 1) % values.length;
        break;
      case "ArrowLeft":
        nextIndex = (index - 1 + values.length) % values.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = values.length - 1;
        break;
      default:
        return;
    }
    const next = values[nextIndex];
    if (next === undefined) return;
    event.preventDefault();
    onSelect(next);
    buttons.current.get(next)?.focus();
  };

  return {
    getTabProps: (value: T) => ({
      id: tabId(value),
      role: "tab" as const,
      "aria-controls": panelId(value),
      "aria-selected": value === selected,
      tabIndex: value === selected ? 0 : -1,
      ref: (node: HTMLButtonElement | null) => {
        if (node) buttons.current.set(value, node);
        else buttons.current.delete(value);
      },
      onClick: () => onSelect(value),
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) =>
        handleKeyDown(event, value),
    }),
    getPanelProps: (value: T) => ({
      id: panelId(value),
      role: "tabpanel" as const,
      "aria-labelledby": tabId(value),
      tabIndex: 0,
    }),
  };
}
