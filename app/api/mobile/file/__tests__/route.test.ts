/** @jest-environment node */
import { NextRequest } from "next/server";
import { GET } from "../route";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction } from "convex/nextjs";
jest.mock("@convex-dev/auth/nextjs/server", () => ({
  convexAuthNextjsToken: jest.fn(),
}));
jest.mock("convex/nextjs", () => ({ fetchAction: jest.fn() }));
const request = (query = "id=file123") =>
  new NextRequest("https://riftsys.app/api/mobile/file?" + query);
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(convexAuthNextjsToken).mockResolvedValue("session");
});
it("requires a session before resolving a signed URL", async () => {
  jest.mocked(convexAuthNextjsToken).mockResolvedValue(undefined);
  expect((await GET(request())).status).toBe(401);
  expect(fetchAction).not.toHaveBeenCalled();
});
it.each(["", "id=", "id=../secret", "id=" + "x".repeat(129)])(
  "rejects invalid file identifiers: %s",
  async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(fetchAction).not.toHaveBeenCalled();
  },
);
it("forwards only the selected file and server session, ignoring privilege overrides", async () => {
  jest
    .mocked(fetchAction)
    .mockResolvedValue({ file123: "https://storage.test/file?signature=one" });
  const result = await GET(
    request(
      "id=file123&userId=other&serviceKey=injected&skipTokenValidation=true",
    ),
  );
  expect(result.status).toBe(200);
  expect(jest.mocked(fetchAction).mock.calls[0].slice(1)).toEqual([
    { fileIds: ["file123"] },
    { token: "session" },
  ]);
  expect(result.headers.get("Cache-Control")).toBe("private, no-store");
});
it("returns unavailable for files absent from the owner-authorized result", async () => {
  jest
    .mocked(fetchAction)
    .mockResolvedValue({ anotherFile: "https://storage.test/other" });
  const result = await GET(request());
  expect(result.status).toBe(404);
  expect(await result.json()).toEqual({ url: null });
});
it("resolves a fresh signed URL on each explicit attempt", async () => {
  jest
    .mocked(fetchAction)
    .mockResolvedValueOnce({
      file123: "https://storage.test/file?signature=old",
    })
    .mockResolvedValueOnce({
      file123: "https://storage.test/file?signature=new",
    });
  const first = await GET(request());
  const second = await GET(request());
  expect(await first.json()).toEqual({
    url: "https://storage.test/file?signature=old",
  });
  expect(await second.json()).toEqual({
    url: "https://storage.test/file?signature=new",
  });
  expect(fetchAction).toHaveBeenCalledTimes(2);
});
it("does not expose backend failure details and allows a later successful retry", async () => {
  jest
    .mocked(fetchAction)
    .mockRejectedValueOnce(new Error("private storage credentials"))
    .mockResolvedValueOnce({ file123: "https://storage.test/file" });
  const failed = await GET(request());
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain("private");
  expect((await GET(request())).status).toBe(200);
});
