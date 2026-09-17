import { z } from "zod";

/**
 * Weaker models (notably Grok 4.5) sometimes emit tool-call arguments in the
 * wrong shape: a number sent as a string, an enum with odd casing/whitespace, or
 * an array serialized as a comma string. The strict Zod schema then rejects the
 * whole call and a valid operation is lost to a type-validation error.
 *
 * These helpers loosen the SCHEMA to accept the string forms (unions of
 * primitives only — no `.transform()`, so the JSON Schema the model sees stays
 * representable) and coerce the value back to the real type inside the tool's
 * `execute`. Well-behaved models are unaffected; malformed ones self-heal.
 */

/** Schema: accept a number or a numeric string. Coerce with `coerceInt`. */
export const looseInt = z.union([z.number(), z.string()]);

/** Schema: accept an int array, or a single comma/space-separated string. */
export const looseIntArray = z.union([
  z.array(z.union([z.number(), z.string()])),
  z.string(),
]);

/** Schema: accept one of `values`, or any string (coerce with `coerceEnum`). */
export const looseEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.union([z.enum(values), z.string()]);

/** Parse the first integer out of a number or string; else `fallback`. */
export const coerceInt = (
  v: unknown,
  fallback?: number,
): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const m = v.match(/-?\d+/);
    if (m) return parseInt(m[0], 10);
  }
  return fallback;
};

/** Parse an int array from an array or a comma/space-separated string. */
export const coerceIntArray = (v: unknown): number[] | undefined => {
  const raw = Array.isArray(v)
    ? v
    : typeof v === "string"
      ? v.split(/[,\s]+/).filter(Boolean)
      : undefined;
  if (!raw) return undefined;
  const out: number[] = [];
  for (const item of raw) {
    const n = coerceInt(item);
    if (n !== undefined) out.push(n);
  }
  return out.length ? out : undefined;
};

/**
 * Resolve a value to one of `values`: exact (case-insensitive) match first, then
 * a prefix match, then a substring match; else `fallback`. Handles the common
 * "Send", "send ", or "action=send" style malformations.
 */
export const coerceEnum = <T extends readonly string[]>(
  v: unknown,
  values: T,
  fallback?: T[number],
): T[number] | undefined => {
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    const exact = values.find((x) => x.toLowerCase() === s);
    if (exact) return exact as T[number];
    const starts = values.find((x) => s.startsWith(x.toLowerCase()));
    if (starts) return starts as T[number];
    const contains = values.find((x) => s.includes(x.toLowerCase()));
    if (contains) return contains as T[number];
  }
  return fallback;
};
