import { NextRequest } from "next/server";
import { getUserID } from "@/lib/auth/get-user-id";
import { loadUserGithubToken } from "@/lib/github/load-user-github-token";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import {
  fetchGithubRepositoryApi,
  githubErrorResponse,
  githubFullName,
  githubJson,
  repositoryDto,
} from "@/lib/github/repositories";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const origin = req.headers.get("Origin");
  if (
    (origin && origin !== req.nextUrl.origin) ||
    req.headers.get("Sec-Fetch-Site") === "cross-site"
  )
    return githubJson(
      { error: "Cross-origin requests are not allowed.", code: "forbidden" },
      403,
    );
  let userId: string;
  try {
    userId = await getUserID(req);
  } catch {
    return githubJson(
      { error: "Sign in to open a repository.", code: "auth_required" },
      401,
    );
  }
  let fullName: string;
  try {
    const text = await req.text();
    if (text.length > 1024) throw new Error("Request too large");
    fullName = githubFullName.parse(JSON.parse(text)?.fullName);
  } catch {
    return githubJson(
      {
        error: "Choose a valid GitHub repository.",
        code: "invalid_repository",
      },
      400,
    );
  }
  try {
    const connection = await loadUserGithubToken(userId);
    if (!connection)
      return githubJson(
        {
          error: "Connect GitHub to open a repository.",
          code: "not_connected",
        },
        409,
      );
    const response = await fetchGithubRepositoryApi(
      `/repos/${fullName}`,
      connection.token,
    );
    const repository = repositoryDto(await response.json());
    const serviceKey = getConvexServiceKey();
    if (!serviceKey) throw new Error("Missing service configuration");
    const project = await getConvexClient().mutation(
      api.projects.openGithubRepositoryForBackend,
      { serviceKey, userId, repository },
    );
    if (!project)
      return githubJson(
        {
          error:
            "Project limit reached. Archive an unused project and try again.",
          code: "project_limit",
        },
        409,
      );
    return githubJson({ project });
  } catch (error) {
    return githubErrorResponse(error);
  }
}
