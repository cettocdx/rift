import { RIFT_SYMBOL_PATH, RIFT_WORDMARK_PATHS } from "@/lib/brand/logo";

/** Trusted static artwork for standalone HTML/PDF reports; no user input. */
export const HACK_REPORT_BRAND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="152" height="54" viewBox="0 0 428 152" role="img" aria-label="RIFT" focusable="false" fill="currentColor"><g transform="translate(16 17) scale(1.2)"><path d="${RIFT_SYMBOL_PATH}"/><path d="${RIFT_SYMBOL_PATH}" transform="rotate(180 50 50)"/></g><g transform="translate(165 27) scale(1)" fill-rule="evenodd">${RIFT_WORDMARK_PATHS.map((d) => `<path d="${d}"/>`).join("")}</g></svg>`;
