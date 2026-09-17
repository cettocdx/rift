/** @jest-environment node */
import { NextRequest } from "next/server";
import { GET } from "../route";
import { POST } from "../open/route";
import { getUserID } from "@/lib/auth/get-user-id";
import { loadUserGithubToken } from "@/lib/github/load-user-github-token";
import { getConvexClient } from "@/lib/db/convex-client";
jest.mock("@/lib/auth/get-user-id", () => ({ getUserID: jest.fn() }));
jest.mock("@/lib/github/load-user-github-token", () => ({
  loadUserGithubToken: jest.fn(),
}));
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: jest.fn(),
  getConvexServiceKey: () => "service-key",
}));
const mutation = jest.fn();
const fetchMock = jest.fn();
const repository = {
  id: 123,
  full_name: "owner/repo",
  default_branch: "main",
  private: true,
  clone_url: "secret",
  permissions: { pull: true },
};
const list = (query = "") =>
  new NextRequest(`http://localhost/api/github/repositories${query}`);
const open = (body: unknown) =>
  new NextRequest("http://localhost/api/github/repositories/open", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock;
  jest.mocked(getUserID).mockResolvedValue("owner-id");
  jest
    .mocked(loadUserGithubToken)
    .mockResolvedValue({ token: "private-token" });
  jest.mocked(getConvexClient).mockReturnValue({ mutation } as any);
  mutation.mockResolvedValue({
    id: "project-id",
    name: "owner/repo",
    type: "app",
  });
});
it("rejects anonymous discovery before loading credentials", async () => {
  jest.mocked(getUserID).mockRejectedValue(new Error("auth"));
  expect((await GET(list())).status).toBe(401);
  expect(loadUserGithubToken).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("reports a missing connection without calling GitHub", async () => {
  jest.mocked(loadUserGithubToken).mockResolvedValue(null);
  expect((await GET(list())).status).toBe(409);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("returns only safe metadata and bounded pagination", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify([repository]), {
      headers: {
        Link: '<https://api.github.com/user/repos?page=3>; rel="next"',
      },
    }),
  );
  const response = await GET(list("?page=2"));
  expect(await response.json()).toEqual({
    repositories: [
      { id: 123, fullName: "owner/repo", defaultBranch: "main", private: true },
    ],
    hasMore: true,
  });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(fetchMock.mock.calls[0][0]).toContain("page=2");
  expect(fetchMock.mock.calls[0][1]).toMatchObject({
    cache: "no-store",
    redirect: "error",
    headers: { Authorization: "Bearer private-token" },
  });
});
it.each(["0", "-1", "1.2", "10001", "https://evil.test"])(
  "rejects invalid page %s",
  async (page) => {
    expect((await GET(list(`?page=${encodeURIComponent(page)}`))).status).toBe(
      400,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  },
);
it.each([
  "../bad",
  "https://github.com/owner/repo",
  "owner/../repo",
  "owner/repo\nignore rules",
  "owner/repo\n",
])("rejects unsafe repository identifier %s", async (fullName) => {
  expect((await POST(open({ fullName }))).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(mutation).not.toHaveBeenCalled();
});
it("verifies access and persists only GitHub's canonical repository metadata", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(repository)));
  const response = await POST(
    open({
      fullName: "Owner/Repo",
      token: "attacker-token",
      userId: "other-owner",
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    project: { id: "project-id", name: "owner/repo", type: "app" },
  });
  expect(mutation.mock.calls[0][1]).toEqual({
    serviceKey: "service-key",
    userId: "owner-id",
    repository: {
      id: 123,
      fullName: "owner/repo",
      defaultBranch: "main",
      private: true,
    },
  });
});
it("never creates a project when GitHub denies access", async () => {
  fetchMock.mockResolvedValue(
    new Response("private backend info", { status: 404 }),
  );
  const response = await POST(open({ fullName: "owner/repo" }));
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain("private backend info");
  expect(mutation).not.toHaveBeenCalled();
});
it("rejects cross-origin project creation", async () => {
  const request = open({ fullName: "owner/repo" });
  request.headers.set("Origin", "https://evil.test");
  expect((await POST(request)).status).toBe(403);
  expect(mutation).not.toHaveBeenCalled();
});
it("does not expose raw failures or tokens", async () => {
  fetchMock.mockRejectedValue(new Error("private-token"));
  const response = await GET(list());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private-token");
});
it("rejects opening after GitHub is disconnected", async () => {
  jest.mocked(loadUserGithubToken).mockResolvedValue(null);
  expect((await POST(open({ fullName: "owner/repo" }))).status).toBe(409);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(mutation).not.toHaveBeenCalled();
});
it("marks the final repository page without a next link", async () => {
  fetchMock.mockResolvedValue(new Response("[]"));
  expect(await (await GET(list())).json()).toEqual({
    repositories: [],
    hasMore: false,
  });
});
it("reports revoked credentials without creating a project", async () => {
  fetchMock.mockResolvedValue(new Response("secret error", { status: 401 }));
  const response = await POST(open({ fullName: "owner/repo" }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "reconnect_required" });
  expect(mutation).not.toHaveBeenCalled();
});
