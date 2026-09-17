import { readFileSync } from "node:fs";

export default function preflight() {
  for (const name of [
    "MOBILE_ACCEPTANCE_BASE_URL",
    "MOBILE_ACCEPTANCE_STORAGE_STATE",
    "MOBILE_ACCEPTANCE_EMAIL",
    "NEXT_PUBLIC_CONVEX_URL",
  ]) {
    if (!process.env[name]?.trim()) {
      throw new Error(
        `Mobile acceptance requires ${name}. Supply an existing authenticated session; this suite never logs in or creates data.`,
      );
    }
  }
  const base = new URL(process.env.MOBILE_ACCEPTANCE_BASE_URL!);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== "/"
  ) {
    throw new Error(
      "MOBILE_ACCEPTANCE_BASE_URL must be an HTTP(S) origin without credentials or a route.",
    );
  }
  let state;
  try {
    state = JSON.parse(
      readFileSync(process.env.MOBILE_ACCEPTANCE_STORAGE_STATE!, "utf8"),
    );
  } catch {
    throw new Error(
      "Cannot read the externally provided Playwright storageState JSON. No authentication fallback is allowed.",
    );
  }
  if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)) {
    throw new Error(
      "Provide a complete Playwright storageState export with cookies and origins, not a manually constructed cookie.",
    );
  }
}
