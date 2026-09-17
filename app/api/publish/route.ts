import { NextRequest, NextResponse } from "next/server";

import { api } from "@/convex/_generated/api";
import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import { ensureSandboxConnection } from "@/lib/ai/tools/utils/sandbox";
import { getChatById } from "@/lib/db/actions";
import {
  resolveProjectRuntimeContext,
  resolveChatSandboxNamespace,
} from "@/lib/projects/project-runtime";
import { getConvexClient } from "@/lib/db/convex-client";
import {
  BUILD_OUTPUT_DIRS,
  isPublishablePath,
  listBuildOutputCommand,
  shellQuote,
} from "@/lib/publish/build-output";
import { slugifySubdomain } from "@/lib/publish/subdomain";
import {
  createDeployment,
  preferredUrl,
  uploadFile,
  vercelProjectName,
  VercelError,
  waitForReady,
  type VercelFile,
} from "@/lib/publish/vercel";

/**
 * Publish a Build app to its own hostname.
 *
 * The sandbox that produced the app is disposable — its preview URL dies with
 * the sandbox — so publishing takes a snapshot: reconnect to the user's
 * sandbox, produce (or reuse) a production build, and deploy the built output
 * to Vercel. After this the app is served by Vercel's edge, with no sandbox in
 * the request path.
 */

export const maxDuration = 300;

const MAX_FILES = 400;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const BUILD_TIMEOUT_MS = 240_000;

const fail = (error: string, status: number) =>
  NextResponse.json({ ok: false, error }, { status });

/** Locate the project directory the agent has been building in. */
async function findProjectDir(
  run: (command: string) => Promise<{ stdout: string; exitCode: number }>,
  requested: string | undefined,
): Promise<string | null> {
  if (requested) {
    const probe = await run(
      `test -f ${shellQuote(`${requested}/package.json`)} && echo ok`,
    );
    return probe.stdout.trim() === "ok" ? requested : null;
  }

  // Most recently modified package.json that is not inside node_modules — the
  // project the run has actually been working in.
  const found = await run(
    `find /home -maxdepth 5 -name package.json -not -path '*/node_modules/*' -printf '%T@ %h\\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-`,
  );
  const dir = found.stdout.trim();
  return dir || null;
}

/** Find the build output directory, running the project's build if needed. */
async function resolveOutputDir(
  run: (command: string) => Promise<{ stdout: string; exitCode: number }>,
  projectDir: string,
): Promise<{ outputDir: string } | { error: string }> {
  const existing = await run(
    BUILD_OUTPUT_DIRS.map(
      (dir) =>
        `test -f ${shellQuote(`${projectDir}/${dir}/index.html`)} && echo ${dir}`,
    ).join(" || "),
  );
  const already = existing.stdout.trim().split("\n")[0]?.trim();
  if (already) return { outputDir: `${projectDir}/${already}` };

  // No built output yet. Build it — publishing the dev tree would ship
  // unbundled sources that only a dev server can serve.
  const build = await run(
    `cd ${shellQuote(projectDir)} && (npm run build 2>&1 | tail -40)`,
  );
  if (build.exitCode !== 0) {
    return {
      error: `The production build failed, so there is nothing to publish:\n${build.stdout.slice(-1200)}`,
    };
  }

  const after = await run(
    BUILD_OUTPUT_DIRS.map(
      (dir) =>
        `test -f ${shellQuote(`${projectDir}/${dir}/index.html`)} && echo ${dir}`,
    ).join(" || "),
  );
  const built = after.stdout.trim().split("\n")[0]?.trim();
  if (!built) {
    return {
      error:
        "The build finished but produced no index.html in dist, build, or out.",
    };
  }
  return { outputDir: `${projectDir}/${built}` };
}

export async function POST(request: NextRequest) {
  // An anonymous or expired session must read as 401, not as a server fault:
  // the auth helper throws rather than returning null when there is no session.
  let userId: string | null = null;
  try {
    ({ userId } = await getUserIDAndPro(request));
  } catch {
    userId = null;
  }
  if (!userId) return fail("Unauthorized", 401);

  const vercelToken = process.env.VERCEL_TOKEN;
  if (!vercelToken) {
    return fail(
      "Publishing is not configured on this deployment: VERCEL_TOKEN is unset.",
      503,
    );
  }
  const vercel = {
    token: vercelToken,
    teamId: process.env.VERCEL_TEAM_ID || undefined,
  };

  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return fail("Publishing is not configured on this deployment.", 503);
  }

  let body: {
    chatId?: string;
    title?: string;
    subdomain?: string;
    projectDir?: string;
  };
  try {
    body = await request.json();
  } catch {
    return fail("Invalid request body", 400);
  }

  const chatId = body.chatId?.trim();
  if (!chatId) return fail("chatId is required", 400);

  const title = (body.title?.trim() || "Untitled app").slice(0, 120);
  const slug = slugifySubdomain(body.subdomain?.trim() || title);
  if (!slug) {
    return fail(
      "This app needs a name with letters or numbers in it to publish.",
      400,
    );
  }
  const projectName = vercelProjectName(slug, userId);

  const convex = getConvexClient();

  try {
    const chat = await getChatById({ id: chatId });
    if (!chat || chat.user_id !== userId) return fail("Chat not found", 404);
    const runtime = await resolveProjectRuntimeContext({ userId, chat });
    const sandboxNamespace =
      resolveChatSandboxNamespace({
        userId,
        chatId,
        chat,
        projectNamespace: runtime.sandboxNamespace,
      }) ?? userId;
    const { sandbox } = await ensureSandboxConnection({
      userID: userId,
      sandboxNamespace,
      setSandbox: () => {},
    });

    // E2B throws on a non-zero exit. Most of the commands below are probes —
    // "is there a dist/index.html?" answering "no" is information, not a
    // failure — so the exit code is read rather than propagated.
    const run = async (command: string) => {
      try {
        const result = await sandbox.commands.run(command, {
          timeoutMs: BUILD_TIMEOUT_MS,
        });
        return {
          stdout: `${result.stdout ?? ""}${result.stderr ?? ""}`,
          exitCode: result.exitCode ?? 0,
        };
      } catch (error) {
        const failed = (
          error as {
            result?: { stdout?: string; stderr?: string; exitCode?: number };
          }
        ).result;
        if (!failed) throw error;
        return {
          stdout: `${failed.stdout ?? ""}${failed.stderr ?? ""}`,
          exitCode: failed.exitCode ?? 1,
        };
      }
    };

    const projectDir = await findProjectDir(run, body.projectDir);
    if (!projectDir) {
      return fail(
        "No app was found in this workspace to publish. Build something first.",
        404,
      );
    }

    const resolved = await resolveOutputDir(run, projectDir);
    if ("error" in resolved) return fail(resolved.error, 422);
    const { outputDir } = resolved;

    const listing = await run(listBuildOutputCommand(outputDir));
    const paths = listing.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter(isPublishablePath);

    if (paths.length === 0) return fail("The build output is empty.", 422);
    if (paths.length > MAX_FILES) {
      return fail(
        `This app has ${paths.length} files; publishing supports up to ${MAX_FILES}.`,
        413,
      );
    }
    if (!paths.includes("index.html")) {
      return fail("The build output has no index.html at its root.", 422);
    }

    const files: VercelFile[] = [];
    let totalBytes = 0;

    for (const path of paths) {
      const bytes = (await sandbox.files.read(`${outputDir}/${path}`, {
        format: "bytes",
      })) as Uint8Array;

      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) {
        return fail(
          "This app is over the 50MB publish limit. Trim large assets and try again.",
          413,
        );
      }

      const sha = await uploadFile(vercel, bytes);
      files.push({ file: path, sha, size: bytes.byteLength });
    }

    const deployment = await createDeployment(vercel, {
      name: projectName,
      files,
    });

    // A deployment answers before it is serving. Wait for it, so the link the
    // user is handed works the moment they click it rather than 404ing for the
    // first few seconds.
    const ready = await waitForReady(vercel, deployment.id);
    if (ready.readyState === "ERROR") {
      return fail(
        "Vercel could not finish the deployment. Check the build output and try again.",
        502,
      );
    }

    const url = preferredUrl({
      id: deployment.id,
      url: ready.url || deployment.url,
      aliases: ready.aliases.length ? ready.aliases : deployment.aliases,
      readyState: ready.readyState,
    });

    const result = await convex.mutation(api.publishedSites.recordDeployment, {
      serviceKey,
      user_id: userId,
      chat_id: chatId,
      title,
      project_name: projectName,
      deployment_id: deployment.id,
      url,
      file_count: files.length,
      total_bytes: totalBytes,
    });

    return NextResponse.json({
      ok: true,
      url,
      projectName,
      republished: result.republished,
      fileCount: files.length,
      totalBytes,
      readyState: ready.readyState,
    });
  } catch (error) {
    // Vercel's own refusals carry an explanation the user can act on — an
    // invalid token, a plan limit, a name already used by another project.
    // Passing that through beats replacing it with a generic apology.
    if (error instanceof VercelError) {
      console.error("[publish] vercel rejected", error.status, error.message);
      return fail(error.message, error.status === 403 ? 403 : 502);
    }
    const message = error instanceof Error ? error.message : "Publish failed";
    if (message.includes("belongs to another account"))
      return fail(message, 409);
    console.error("[publish] failed", error);
    return fail("Publishing failed. Try again in a moment.", 500);
  }
}
