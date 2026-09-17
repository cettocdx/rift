import { NextRequest } from "next/server";
import { getUserID } from "@/lib/auth/get-user-id";
import { loadUserGithubToken } from "@/lib/github/load-user-github-token";
import {
  fetchGithubRepositoryApi,
  githubErrorResponse,
  githubJson,
  repositoryDto,
} from "@/lib/github/repositories";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = await getUserID(req);
  } catch {
    return githubJson(
      {
        error: "Sign in to browse GitHub repositories.",
        code: "auth_required",
      },
      401,
    );
  }
  const pageText = req.nextUrl.searchParams.get("page") ?? "1";
  if (!/^[1-9][0-9]{0,4}$/.test(pageText) || Number(pageText) > 10_000)
    return githubJson(
      { error: "Invalid repository page.", code: "invalid_page" },
      400,
    );
  try {
    const connection = await loadUserGithubToken(userId);
    if (!connection)
      return githubJson(
        {
          error: "Connect GitHub to browse your repositories.",
          code: "not_connected",
        },
        409,
      );
    const response = await fetchGithubRepositoryApi(
      `/user/repos?sort=updated&direction=desc&per_page=30&page=${pageText}`,
      connection.token,
    );
    const data: unknown = await response.json();
    if (!Array.isArray(data) || data.length > 30)
      throw new Error("Invalid GitHub repository list");
    return githubJson({
      repositories: data.map(repositoryDto),
      hasMore:
        Number(pageText) < 10_000 &&
        /rel="next"/.test(response.headers.get("Link") ?? ""),
    });
  } catch (error) {
    return githubErrorResponse(error);
  }
}
