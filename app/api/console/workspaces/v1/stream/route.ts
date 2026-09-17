import { recoverWorkspaceOutcome } from "@/lib/console/workspace-recovery";
import type { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { makeFunctionReference } from "convex/server";
import { createChatHandler } from "@/lib/api/chat-handler";
import { POST as startDurableHack } from "@/app/api/hack-long/route";
import { assertDurableHackEnabled } from "@/lib/hack/durable-run";
import { POST as startHack } from "@/app/api/hack-chat/route";
import { GET as resumeChat } from "@/app/api/chat/[id]/stream/route";
import { GET as resumeHack } from "@/app/api/hack-long/resume/route";
import { buildSSEResponseFromRun } from "@/lib/chat/agent-long-transport";
import { getConvexClient } from "@/lib/db/convex-client";
import {
  startSchema,
  validateStudioSettings,
} from "@/lib/console/workspaces-contract";
import {
  access,
  artifacts,
  authority,
  body,
  ensureWorkspace,
  forward,
  hackExecutionTargets,
  identityQuery,
  json,
  owned,
  route,
  WorkspaceError,
} from "@/lib/console/workspaces-server";
import { observeWorkspaceStream } from "@/lib/console/workspaces-stream";
import { HACK_TASKS } from "@/lib/hack/task-catalog";
export const maxDuration = 800;
export async function POST(req: NextRequest) {
  return route(async () => {
    const parsed = startSchema.safeParse(await body(req));
    if (!parsed.success) throw new WorkspaceError("Invalid workspace request.");
    const input = parsed.data;
    const { userId } = await access(req, input.workspace);
    if (
      input.workspace === "hack" &&
      input.sandboxPreference &&
      input.sandboxPreference !== "e2b"
    ) {
      const targets = await hackExecutionTargets(userId);
      if (!targets.some((target) => target.value === input.sandboxPreference))
        throw new WorkspaceError(
          "The selected local runner is unavailable. Reconnect it or select Cloud.",
        );
    }
    if (input.workspace === "studio")
      validateStudioSettings(
        input.model ?? "image-gemini",
        input.settings,
        input.referenceFileIds.length,
      );
    else {
      if (input.model && input.model !== "build-grok")
        throw new WorkspaceError("Hack uses the RIFT security model.");
      if (input.settings && Object.keys(input.settings).length)
        throw new WorkspaceError("Media settings only apply to Studio.");
      if (input.taskId && !HACK_TASKS.some((task) => task.id === input.taskId))
        throw new WorkspaceError("Unknown Hack task.");
    }
    const files: Array<{
      fileId: string;
      name: string;
      mediaType: string;
      size?: number;
    } | null> = await artifacts(userId, input.referenceFileIds);
    if (files.some((file) => !file))
      throw new WorkspaceError("A reference file is unavailable.", 403);
    if (
      input.workspace === "studio" &&
      files.some((file) => !String(file?.mediaType).startsWith("image/"))
    )
      throw new WorkspaceError("Studio references must be images.");
    await getConvexClient().mutation(ensureWorkspace, {
      ...authority(userId),
      workspace: input.workspace,
      chatId: input.chatId,
      title: input.prompt,
    });
    const admission = await getConvexClient().mutation(
      makeFunctionReference<"mutation">("consoleWorkspaces:admit"),
      {
        ...authority(userId),
        workspace: input.workspace,
        chatId: input.chatId,
        operationId: input.operationId,
        requestHash: createHash("sha256")
          .update(JSON.stringify(input))
          .digest("hex"),
        permission: input.permission,
        ...(input.target ? { target: input.target } : {}),
        ...(input.taskId ? { taskId: input.taskId } : {}),
      },
    );
    if (!admission.admitted)
      return json(
        {
          error:
            "This operation has already been submitted or another operation is active. Reconnect to observe it.",
          status: admission.status,
          operationId: input.operationId,
        },
        409,
      );
    const prompt =
      input.workspace === "hack"
        ? [
            input.target ? `Authorized target: ${input.target}` : "",
            input.scope ? `Declared scope: ${input.scope}` : "",
            input.prompt,
          ]
            .filter(Boolean)
            .join("\n\n")
        : input.prompt;
    const payload = {
      chatId: input.chatId,
      executionId: input.operationId,
      mode: "agent",
      purpose: input.workspace === "studio" ? "image" : "security",
      selectedModel:
        input.workspace === "studio"
          ? (input.model ?? "image-gemini")
          : "build-grok",
      approvalMode: input.permission === "auto" ? "full" : "ask",
      sandboxPreference: input.sandboxPreference ?? "e2b",
      messages: [
        {
          id: input.operationId,
          role: "user",
          parts: [
            { type: "text", text: prompt },
            ...files.map((file) => ({
              type: "file",
              fileId: file!.fileId,
              name: file!.name,
              mediaType: file!.mediaType,
              size: file!.size,
            })),
          ],
        },
      ],
    };
    let durable = false;
    if (
      input.workspace === "hack" &&
      (!input.sandboxPreference || input.sandboxPreference === "e2b")
    ) {
      try {
        assertDurableHackEnabled();
        durable = true;
      } catch {}
    }
    const request = forward(
      req,
      input.workspace === "hack" ? "/api/hack-chat" : "/api/chat",
      payload,
    );
    let response: Response;
    try {
      response =
        input.workspace === "hack"
          ? durable
            ? await startDurableHack(request)
            : await startHack(request)
          : await createChatHandler({
              forcedPurpose: "image",
              studioSettings: input.settings,
              onProducerFinished: async (status) => {
                await getConvexClient().mutation(
                  makeFunctionReference<"mutation">("consoleWorkspaces:finish"),
                  {
                    ...authority(userId),
                    chatId: input.chatId,
                    operationId: input.operationId,
                    status,
                  },
                );
              },
            })(request);
    } catch (error) {
      await getConvexClient().mutation(
        makeFunctionReference<"mutation">("consoleWorkspaces:finish"),
        {
          ...authority(userId),
          chatId: input.chatId,
          operationId: input.operationId,
          status: "uncertain",
        },
      );
      throw error;
    }
    if (!response.ok) {
      await getConvexClient().mutation(
        makeFunctionReference<"mutation">("consoleWorkspaces:finish"),
        {
          ...authority(userId),
          chatId: input.chatId,
          operationId: input.operationId,
          status: response.status < 500 ? "failed" : "uncertain",
        },
      );
      return response;
    }
    if (durable)
      response = await buildSSEResponseFromRun(
        await response.json(),
        req.signal,
      );
    return observeWorkspaceStream(
      response,
      userId,
      input.chatId,
      input.operationId,
      durable ? "durable" : "http",
      input.workspace === "studio",
    );
  });
}
export async function GET(req: NextRequest) {
  return route(async () => {
    const { workspace, chatId } = identityQuery(req);
    const { userId } = await access(req, workspace);
    const chat = await owned(userId, workspace, chatId);
    const ops = await getConvexClient().query(
      makeFunctionReference<"query">("consoleWorkspaces:operations"),
      { ...authority(userId), chatId },
    );
    const operation = ops.find((item: { status: string }) =>
      ["running", "uncertain", "cancel_requested"].includes(item.status),
    );
    if (workspace === "hack" && operation) {
      const status = await recoverWorkspaceOutcome({
        userId,
        chatId,
        operationId: operation.operationId,
      });
      if (status) {
        await getConvexClient().mutation(
          makeFunctionReference<"mutation">("consoleWorkspaces:finish"),
          {
            ...authority(userId),
            chatId,
            operationId: operation.operationId,
            status,
          },
        );
        operation.status = status;
      }
    }
    const withStatus = (response: Response) => {
      const current = operation ?? ops[0];
      if (current) {
        response.headers.set("x-rift-workspace-status", current.status);
        response.headers.set("x-rift-operation-id", current.operationId);
      }
      return response;
    };
    if (workspace === "hack" && chat.active_trigger_run_id) {
      const resumed = await resumeHack(
        forward(
          req,
          `/api/hack-long/resume?chatId=${encodeURIComponent(chatId)}`,
        ),
      );
      if (!resumed.ok || resumed.status === 204) return withStatus(resumed);
      const response = await buildSSEResponseFromRun(
        await resumed.json(),
        req.signal,
      );
      return withStatus(
        operation
          ? observeWorkspaceStream(
              response,
              userId,
              chatId,
              operation.operationId,
              "durable",
            )
          : response,
      );
    }
    const response = await resumeChat(
      forward(req, `/api/chat/${encodeURIComponent(chatId)}/stream`),
      { params: Promise.resolve({ id: chatId }) },
    );
    return withStatus(
      response.ok && response.status !== 204 && operation
        ? observeWorkspaceStream(
            response,
            userId,
            chatId,
            operation.operationId,
            "http",
            workspace === "studio",
          )
        : response,
    );
  });
}
