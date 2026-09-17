import "server-only";
import {
  makeFunctionReference,
  type ApiFromModules,
  type FunctionArgs,
  type FunctionReturnType,
} from "convex/server";
import type * as executionModule from "@/convex/hackHttpExecutions";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";

type Api = ApiFromModules<{
  hackHttpExecutions: typeof executionModule;
}>["hackHttpExecutions"];
export type HackHttpExecutionBinding = {
  userId: string;
  chatId: string;
  executionId: string;
};
export type HackHttpExecutionStatus = NonNullable<
  FunctionReturnType<Api["getForBackend"]>
>;
export const isHackHttpExecutionId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9._~-]{1,200}$/.test(value);
function authority(binding: HackHttpExecutionBinding) {
  const serviceKey = getConvexServiceKey();
  if (!serviceKey) throw new Error("Missing Convex service key");
  return { ...binding, serviceKey };
}
function mutation<Name extends "admit" | "markRunning" | "finish" | "stop">(
  name: Name,
) {
  return makeFunctionReference<
    "mutation",
    FunctionArgs<Api[Name]>,
    FunctionReturnType<Api[Name]>
  >(`hackHttpExecutions:${name}`);
}
const read = makeFunctionReference<
  "query",
  FunctionArgs<Api["getForBackend"]>,
  FunctionReturnType<Api["getForBackend"]>
>("hackHttpExecutions:getForBackend");
/** Only admitted:true grants this caller producer ownership. A duplicate cannot
 * execute or acknowledge another request's finalization. */
export function admitHackHttpExecution(binding: HackHttpExecutionBinding) {
  return getConvexClient().mutation(mutation("admit"), authority(binding));
}
export function markHackHttpExecutionRunning(
  binding: HackHttpExecutionBinding,
) {
  return getConvexClient().mutation(mutation("markRunning"), {
    ...authority(binding),
    streamId: binding.executionId,
  });
}
export function readHackHttpExecution(binding: HackHttpExecutionBinding) {
  return getConvexClient().query(read, authority(binding));
}
/** Call only from the admitted producer, after all persistence and cleanup have
 * settled. Failure must remain visible as unconfirmed Stop, never guessed away. */
export async function finishHackHttpExecution(
  binding: HackHttpExecutionBinding,
) {
  // Pin the deployment and authority for every attempt. Only this idempotent
  // acknowledgment is retried, never admission, tools, messages or billing.
  const client = getConvexClient();
  const args = authority(binding);
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.mutation(mutation("finish"), args);
    } catch (error) {
      if (!isTransientAcknowledgmentError(error)) throw error;
      // A successful commit may have lost its response. Observe the exact
      // generation before retrying; a missing/read-failed record proves nothing.
      try {
        const observed = await client.query(read, args);
        if (
          observed?.executionId === args.executionId &&
          observed.phase === "terminal"
        )
          return true;
      } catch {
        // Keep the original mutation error if confirmation stays unavailable.
      }
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
}

function isTransientAcknowledgmentError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    name?: string;
    message?: string;
    status?: number;
    code?: string;
    cause?: { code?: string };
  };
  // Convex application/ownership failures must not be treated as connectivity.
  if (
    value.name === "ConvexError" ||
    /unauthorized|forbidden|invalid service key/i.test(value.message ?? "")
  )
    return false;
  if ([408, 429, 502, 503, 504].includes(value.status ?? 0)) return true;
  if (
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "ENOTFOUND",
      "UND_ERR_SOCKET",
      "UND_ERR_CONNECT_TIMEOUT",
    ].includes(value.code ?? value.cause?.code ?? "")
  )
    return true;
  return /^(fetch failed|failed to fetch|network request failed|load failed|socket hang up|(?:502 )?bad gateway|(?:503 )?service unavailable|(?:504 )?gateway timeout)$/i.test(
    value.message ?? "",
  );
}
export async function cancelHackHttpExecution(
  binding: HackHttpExecutionBinding,
  discard = false,
) {
  const result = await getConvexClient().mutation(mutation("stop"), {
    ...authority(binding),
    discard,
  });
  return { executionId: result.executionId, canceled: result.canceled };
}
