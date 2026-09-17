import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";
import { resolveApiKeyAuth } from "@/lib/auth/api-key";
import {
  assertHackWorkbenchAccess,
  assertPremiumAccess,
} from "@/lib/auth/premium-access";
import { getChatById } from "@/lib/db/actions";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import {
  readLimitedTextBody,
  RequestBodyTooLargeError,
} from "@/lib/api/read-limited-body";
import { ChatSDKError } from "@/lib/errors";
import { identitySchema, StudioSettingsError } from "./workspaces-contract";
import type { Id } from "@/convex/_generated/dataModel";
import { availableLocalRunners } from "@/lib/chat/execution-target";

export class WorkspaceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function access(
  req: NextRequest,
  workspace?: "studio" | "hack",
  stop = false,
) {
  const identity = await resolveApiKeyAuth(req);
  if (!identity) throw new WorkspaceError("Sign in to RIFT.", 401);
  if (!stop) {
    if (workspace === "hack") assertHackWorkbenchAccess(identity.subscription);
    else assertPremiumAccess(identity.subscription);
  }
  return identity;
}
export async function body(req: NextRequest) {
  try {
    return JSON.parse(await readLimitedTextBody(req, 128 * 1024));
  } catch (error) {
    throw new WorkspaceError(
      "Invalid request.",
      error instanceof RequestBodyTooLargeError ? 413 : 400,
    );
  }
}
export function identityQuery(req: NextRequest) {
  const parsed = identitySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams),
  );
  if (!parsed.success)
    throw new WorkspaceError("A workspace and chat ID are required.");
  return parsed.data;
}
export function authority(userId: string) {
  const serviceKey = getConvexServiceKey();
  if (!serviceKey)
    throw new WorkspaceError("Workspace storage is unavailable.", 503);
  return { userId, serviceKey };
}
export async function hackExecutionTargets(userId: string) {
  const connections = await getConvexClient().query(
    api.localSandbox.listConnectionsForBackend,
    authority(userId),
  );
  return [
    { value: "e2b", label: "Cloud" },
    ...availableLocalRunners(connections).map((connection) => ({
      value: connection.connectionId,
      label: connection.name,
    })),
  ];
}
export async function owned(
  userId: string,
  workspace: "studio" | "hack",
  chatId: string,
) {
  const chat = await getChatById({ id: chatId });
  if (!chat) throw new WorkspaceError("Session not found.", 404);
  if (
    chat.user_id !== userId ||
    chat.purpose !== (workspace === "studio" ? "image" : "security")
  )
    throw new WorkspaceError("Session unavailable.", 403);
  return chat;
}
export async function messages(
  userId: string,
  chatId: string,
  cursor: string | null = null,
) {
  const result = await getConvexClient().query(
    api.messages.getMessagesPageForBackend,
    {
      ...authority(userId),
      chatId,
      paginationOpts: { numItems: 100, cursor },
    },
  );
  return {
    messages: [...result.page].reverse(),
    cursor: result.isDone ? null : result.continueCursor,
    done: result.isDone,
  };
}
export async function allMessages(userId: string, chatId: string) {
  const pages: Awaited<ReturnType<typeof messages>>["messages"][] = [];
  let cursor: string | null = null;
  // Never silently produce an incomplete report. Large sessions can page their
  // history; export fails explicitly if its bounded snapshot would truncate.
  for (let page = 0; page < 100; page++) {
    const result = await messages(userId, chatId, cursor);
    pages.unshift(result.messages);
    if (result.done) return pages.flat();
    cursor = result.cursor;
  }
  throw new WorkspaceError("Session exceeds the report export limit.", 413);
}
export const ensureWorkspace = makeFunctionReference<"mutation">(
  "consoleWorkspaces:ensure",
);
export const listWorkspaces = makeFunctionReference<"query">(
  "consoleWorkspaces:list",
);
export const readArtifacts = makeFunctionReference<"query">(
  "consoleWorkspaces:artifacts",
);
export async function artifacts(userId: string, fileIds: string[]) {
  const ids = [...new Set(fileIds)];
  if (ids.length > 50)
    throw new WorkspaceError("Read at most 50 artifacts at a time.");
  const [metadata, urls] = await Promise.all([
    getConvexClient().query(readArtifacts, {
      ...authority(userId),
      fileIds: ids,
    }),
    getConvexClient().action(api.s3Actions.getFileUrlsByFileIdsAction, {
      ...authority(userId),
      fileIds: ids as Id<"files">[],
    }),
  ]);
  return metadata.map((item: Record<string, unknown> | null, index: number) =>
    item && urls[index] ? { ...item, url: urls[index] } : null,
  );
}
export function fileIdsFromMessages(items: unknown[]): string[] {
  const found = new Set<string>();
  const walk = (value: unknown, depth = 0) => {
    if (depth > 12 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === "fileId" && typeof item === "string") found.add(item);
      else if (key !== "text") walk(item, depth + 1);
    }
  };
  walk(items);
  return [...found];
}
export async function route(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof WorkspaceError)
      return json({ error: error.message }, error.status);
    if (error instanceof StudioSettingsError)
      return json({ error: error.message }, 400);
    if (error instanceof ChatSDKError) return error.toResponse();
    console.error(
      "[rift-workspaces] request failed",
      error instanceof Error ? error.message : "unknown",
    );
    return json(
      { error: "Workspace service is temporarily unavailable." },
      503,
    );
  }
}
export function forward(req: NextRequest, path: string, value?: unknown) {
  const url = new URL(path, req.url);
  const headers = new Headers();
  headers.set("authorization", req.headers.get("authorization") ?? "");
  if (value !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, {
    method: value === undefined ? "GET" : "POST",
    headers,
    body: value === undefined ? undefined : JSON.stringify(value),
    signal: req.signal,
  });
}
