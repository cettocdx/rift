const INTERACTIVE_TERMINAL_SELECTOR = "[data-workbench-interactive-terminal]";

/**
 * Browser PTYs own Ctrl chords for readline and terminal applications. macOS
 * Command shortcuts remain available because they do not emit terminal Ctrl
 * control bytes.
 */
export function shouldPreserveTerminalCtrlChord(event: KeyboardEvent) {
  if (!event.ctrlKey || event.metaKey) return false;
  const target = event.target;
  return (
    target instanceof Element &&
    target.closest(INTERACTIVE_TERMINAL_SELECTOR) !== null
  );
}
