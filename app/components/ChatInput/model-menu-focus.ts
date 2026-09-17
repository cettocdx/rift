/** Focus the active model without moving the surrounding conversation. */
export function focusSelectedModelOption(menu: HTMLElement | null) {
  const selected = menu?.querySelector<HTMLElement>('[data-selected="true"]');
  if (!menu || !selected) return;

  selected.focus({ preventScroll: true });
  const viewport = menu.getBoundingClientRect();
  const option = selected.getBoundingClientRect();
  // scrollIntoView also scrolls ancestors. Only this popup owns the movement.
  if (option.top < viewport.top) {
    menu.scrollTop += option.top - viewport.top;
  } else if (option.bottom > viewport.bottom) {
    menu.scrollTop += option.bottom - viewport.bottom;
  }
}
