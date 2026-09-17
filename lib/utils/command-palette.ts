const EVENT = "rift:open-command-palette";

export type OpenCommandPaletteDetail = Readonly<{ query?: string }>;

export function openCommandPalette(detail: OpenCommandPaletteDetail = {}) {
  window.dispatchEvent(
    new CustomEvent<OpenCommandPaletteDetail>(EVENT, { detail }),
  );
}

export function onOpenCommandPalette(
  callback: (detail: OpenCommandPaletteDetail) => void,
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<OpenCommandPaletteDetail>).detail;
    callback(detail ?? {});
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
