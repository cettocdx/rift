import "server-only";
import { createHash } from "node:crypto";

const digest = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

/** Logical request identity, distinct from the random worker fencing claim.
 * This remains stable across retries; it is never a bearer credential.
 */
export function createAgentDispatchIdentity(input: {
  userId: string;
  chatId: string;
  dispatchId: string;
}): string {
  const tuple = [input.userId, input.chatId, input.dispatchId];
  if (
    tuple.some(
      (value) =>
        typeof value !== "string" ||
        !value ||
        value.trim() !== value ||
        value.length > 200,
    )
  )
    throw new Error("Invalid agent dispatch identity");
  return `agent-dispatch:v1:${digest(JSON.stringify(tuple))}`;
}

/** Hash normalized semantic payload, after defaults and safe attachment
 * references are resolved. Callers must omit timing/tokens/transient local paths
 * and include all execution settings. Never hash raw request JSON as a substitute
 * for authorization or normalization. Only this digest belongs in the ledger.
 */
export function hashAgentDispatchPayload(
  payload: Record<string, unknown>,
): string {
  const ancestors = new Set<object>();
  function canonical(value: unknown, depth: number): string {
    if (depth > 64) throw new Error("Dispatch payload is too deeply nested");
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    )
      return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value))
      return JSON.stringify(value);
    if (typeof value !== "object" || value === null || ancestors.has(value))
      throw new Error("Dispatch payload must contain finite JSON values");
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw new Error("Dispatch payload must contain plain objects");
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        const parts: string[] = [];
        for (let i = 0; i < value.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
          if (!descriptor || !("value" in descriptor))
            throw new Error(
              "Dispatch array contains a missing or dynamic value",
            );
          parts.push(canonical(descriptor.value, depth + 1));
        }
        return `[${parts.join(",")}]`;
      }
      const parts: string[] = [];
      for (const key of Object.keys(value).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!("value" in descriptor))
          throw new Error("Dispatch payload contains a dynamic value");
        if (descriptor.value === undefined) continue;
        parts.push(
          `${JSON.stringify(key)}:${canonical(descriptor.value, depth + 1)}`,
        );
      }
      return `{${parts.join(",")}}`;
    } finally {
      ancestors.delete(value);
    }
  }
  if (!payload || Array.isArray(payload) || typeof payload !== "object")
    throw new Error("Dispatch payload must be an object");
  return digest(`agent-dispatch-payload:v1:${canonical(payload, 0)}`);
}
