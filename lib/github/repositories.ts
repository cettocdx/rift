import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";

export const githubFullName = z
  .string()
  .max(140)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}(?![\s\S])/,
  );
const githubRepository = z.object({
  id: z.number().int().positive().safe(),
  full_name: githubFullName,
  default_branch: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[^\x00-\x1f\x7f]+$/),
  private: z.boolean(),
});
export function repositoryDto(value: unknown) {
  const repo = githubRepository.parse(value);
  return {
    id: repo.id,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
    private: repo.private,
  };
}
export class GithubRepositoryError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const githubJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export function githubErrorResponse(error: unknown) {
  if (error instanceof GithubRepositoryError)
    return githubJson({ error: error.message, code: error.code }, error.status);
  return githubJson(
    {
      error:
        "GitHub repositories are temporarily unavailable. Please try again.",
      code: "unavailable",
    },
    503,
  );
}
/** Fixed GitHub origin, no credential-bearing redirects or raw upstream errors. */
export async function fetchGithubRepositoryApi(path: string, token: string) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401)
    throw new GithubRepositoryError(
      409,
      "reconnect_required",
      "Reconnect GitHub to access your repositories.",
    );
  if (response.status === 403 || response.status === 429)
    throw new GithubRepositoryError(
      403,
      "github_access_limited",
      "GitHub access is restricted or rate limited. Check repository permissions and try again.",
    );
  if (response.status === 404)
    throw new GithubRepositoryError(
      404,
      "repository_unavailable",
      "This repository is not available to your connected GitHub account.",
    );
  if (!response.ok)
    throw new GithubRepositoryError(
      503,
      "unavailable",
      "GitHub repositories are temporarily unavailable. Please try again.",
    );
  return response;
}
