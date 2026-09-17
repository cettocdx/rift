/**
 * Canonicalize an email address so that trivial variants of the SAME inbox
 * collapse to one identity. This is what stops "one real Gmail inbox → unlimited
 * verified free accounts" abuse (dots / +aliases / case), which the OTP gate
 * alone does NOT prevent.
 *
 *  - lowercase + trim (email is treated case-insensitively in practice)
 *  - strip "+tag" sub-addressing (user+anything@ → user@) for all providers
 *  - strip dots in the local part for Gmail only (Gmail ignores them)
 *
 * Deterministic: the same inbox always maps to the same string, so it is safe to
 * use as the account identifier on both the password and OAuth paths.
 */
export function canonicalizeEmail(raw: string): string {
  const email = (raw ?? "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  let local = email.slice(0, at);
  const domain = email.slice(at + 1);

  // Sub-addressing: everything after the first "+" is a user-chosen tag.
  const plus = local.indexOf("+");
  if (plus !== -1) local = local.slice(0, plus);

  // Gmail (and its googlemail.com alias) ignore dots in the local part.
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
  }

  return domain ? `${local}@${domain}` : local;
}
