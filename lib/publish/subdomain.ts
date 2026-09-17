/**
 * Naming a published app.
 *
 * A published app becomes a Vercel project, and its address is
 * `<project>.vercel.app` — so the name has to survive as a DNS label. Turning a
 * product's own title (often Turkish, often punctuated) into one is the job
 * here, kept pure so the route and the tests share exactly one implementation.
 */

/** Longest legal DNS label is 63; a shorter cap keeps URLs readable. */
export const MAX_SUBDOMAIN_LENGTH = 40;
export const MIN_SUBDOMAIN_LENGTH = 3;

/**
 * Labels the product needs for itself, or that a visitor would read as the
 * product speaking rather than someone's published app. Handing out `api` or
 * `login` would let a published page impersonate RIFT's own surfaces.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  "admin",
  "account",
  "api",
  "app",
  "assets",
  "auth",
  "billing",
  "blog",
  "cdn",
  "chat",
  "dashboard",
  "dev",
  "docs",
  "download",
  "email",
  "ftp",
  "help",
  "hack",
  "img",
  "internal",
  "lab",
  "login",
  "mail",
  "media",
  "mx",
  "ns",
  "ns1",
  "ns2",
  "pay",
  "preview",
  "pro",
  "rift",
  "root",
  "secure",
  "settings",
  "signup",
  "smtp",
  "staging",
  "static",
  "status",
  "studio",
  "support",
  "test",
  "upgrade",
  "vault",
  "webmail",
  "workbench",
  "www",
]);

const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Turn any title into a candidate label: lowercase, ASCII, hyphen-joined. */
export function slugifySubdomain(value: string): string {
  const ascii = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    // Turkish letters do not decompose, so map them before the ASCII filter or
    // "Dönen Küre" would slug down to "dnen-kre".
    .replace(/[ıİ]/g, "i")
    .replace(/[ğĞ]/g, "g")
    .replace(/[şŞ]/g, "s")
    .replace(/[çÇ]/g, "c")
    .replace(/[öÖ]/g, "o")
    .replace(/[üÜ]/g, "u")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return ascii.slice(0, MAX_SUBDOMAIN_LENGTH).replace(/-+$/, "");
}
