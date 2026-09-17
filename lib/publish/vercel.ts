import { createHash } from "node:crypto";

/**
 * Deploying a built app to Vercel.
 *
 * Files go up individually to `/v2/files`, keyed by their SHA1, and the
 * deployment then references them by digest. That is the flow Vercel documents
 * for non-git deployments, and unlike inlining base64 in the request body it
 * does not put a ceiling on how large an app can be.
 */

const API = "https://api.vercel.com";

export interface VercelConfig {
  token: string;
  teamId?: string;
}

export interface VercelFile {
  /** Path relative to the deployment root, e.g. `assets/index-a1b2.js`. */
  file: string;
  sha: string;
  size: number;
}

export interface VercelDeployment {
  id: string;
  url: string;
  aliases: string[];
  readyState: string;
}

export class VercelError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "VercelError";
  }
}

/** Vercel checks integrity with SHA1, not SHA256. */
export function sha1Hex(bytes: Uint8Array): string {
  return createHash("sha1")
    .update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .digest("hex");
}

const teamQuery = (config: VercelConfig, extra: string = ""): string => {
  const params = new URLSearchParams();
  if (config.teamId) params.set("teamId", config.teamId);
  const query = params.toString();
  const joined = [query, extra].filter(Boolean).join("&");
  return joined ? `?${joined}` : "";
};

async function readError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as {
      error?: { message?: string; code?: string };
    };
    return body.error?.message || fallback;
  } catch {
    return fallback;
  }
}

/** Upload one file's bytes. Returns the digest the deployment references. */
export async function uploadFile(
  config: VercelConfig,
  bytes: Uint8Array,
): Promise<string> {
  const sha = sha1Hex(bytes);
  const response = await fetch(`${API}/v2/files${teamQuery(config)}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "x-vercel-digest": sha,
    },
    body: Buffer.from(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ) as unknown as BodyInit,
  });

  if (!response.ok) {
    throw new VercelError(
      await readError(response, "Uploading a file to Vercel failed."),
      response.status,
    );
  }
  return sha;
}

/**
 * Create a production deployment of already-built static output.
 *
 * `projectSettings` is all-null on purpose: the files being sent are the build
 * output, so Vercel must serve them as-is rather than detect a framework and
 * try to build them a second time.
 */
export async function createDeployment(
  config: VercelConfig,
  input: { name: string; files: VercelFile[] },
): Promise<VercelDeployment> {
  const response = await fetch(
    // Auto-detection would otherwise 400 asking for confirmation when it
    // decides the output "looks like" a framework it recognises.
    `${API}/v13/deployments${teamQuery(config, "skipAutoDetectionConfirmation=1")}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: input.name,
        files: input.files,
        target: "production",
        projectSettings: {
          framework: null,
          buildCommand: null,
          installCommand: null,
          devCommand: null,
          outputDirectory: null,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new VercelError(
      await readError(response, "Vercel rejected the deployment."),
      response.status,
    );
  }

  const body = (await response.json()) as {
    id: string;
    url?: string;
    alias?: string[];
    readyState?: string;
  };

  return {
    id: body.id,
    url: body.url ?? "",
    aliases: body.alias ?? [],
    readyState: body.readyState ?? "QUEUED",
  };
}

/**
 * The address to hand the user.
 *
 * A production deployment gets both a unique per-deployment hostname and the
 * project's stable alias. The alias is the one worth showing: it is what the
 * next publish will also point at, so a link shared today keeps working.
 */
export function preferredUrl(deployment: VercelDeployment): string {
  const stable = deployment.aliases.find((alias) =>
    alias.endsWith(".vercel.app"),
  );
  return `https://${stable ?? deployment.url}`;
}

/** Poll until the deployment is serving, or give up and return the last state. */
export async function waitForReady(
  config: VercelConfig,
  deploymentId: string,
  { timeoutMs = 90_000, intervalMs = 2_000 } = {},
): Promise<{ readyState: string; aliases: string[]; url: string }> {
  const deadline = Date.now() + timeoutMs;
  let last = { readyState: "QUEUED", aliases: [] as string[], url: "" };

  while (Date.now() < deadline) {
    const response = await fetch(
      `${API}/v13/deployments/${deploymentId}${teamQuery(config)}`,
      { headers: { authorization: `Bearer ${config.token}` } },
    );
    if (!response.ok) break;

    const body = (await response.json()) as {
      readyState?: string;
      alias?: string[];
      url?: string;
    };
    last = {
      readyState: body.readyState ?? "QUEUED",
      aliases: body.alias ?? [],
      url: body.url ?? "",
    };
    if (last.readyState === "READY" || last.readyState === "ERROR") break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return last;
}

/**
 * Vercel project name for a user's app.
 *
 * The suffix is not decoration. One RIFT team holds every published project, so
 * without it two users who both name their app "kor" would collide — and the
 * second publish would deploy over the first user's site.
 */
export function vercelProjectName(slug: string, userId: string): string {
  const owner = createHash("sha256").update(userId).digest("hex").slice(0, 6);
  const base = slug.slice(0, 90).replace(/-+$/, "") || "app";
  return `${base}-${owner}`;
}
