/** @jest-environment node */
import { NextRequest } from "next/server";
import { POST } from "../route";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction } from "convex/nextjs";
jest.mock("@convex-dev/auth/nextjs/server", () => ({
  convexAuthNextjsToken: jest.fn(),
}));
jest.mock("convex/nextjs", () => ({ fetchAction: jest.fn() }));
const request = (body: unknown) =>
  new NextRequest("https://riftsys.app/api/mobile/upload", {
    method: "POST",
    body: JSON.stringify(body),
  });
const input = {
  operation: "prepare",
  name: "evidence.txt",
  mediaType: "text/plain",
  size: 12,
  mode: "agent",
};
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(convexAuthNextjsToken).mockResolvedValue("session");
});
it("rejects uploads before calling storage when signed out", async () => {
  jest.mocked(convexAuthNextjsToken).mockResolvedValue(undefined);
  expect((await POST(request(input))).status).toBe(401);
  expect(fetchAction).not.toHaveBeenCalled();
});
it("rejects invalid metadata", async () => {
  expect((await POST(request({ ...input, size: -1 }))).status).toBe(400);
  expect(fetchAction).not.toHaveBeenCalled();
});
it("does not forward client supplied privilege overrides", async () => {
  jest.mocked(fetchAction).mockResolvedValue({ fileId: "id" });
  const response = await POST(
    request({
      ...input,
      operation: "complete",
      s3Key: "key",
      serviceKey: "injected",
      userId: "other",
      skipTokenValidation: true,
    }),
  );
  expect(response.status).toBe(200);
  expect(jest.mocked(fetchAction).mock.calls[0][1]).toEqual({
    name: input.name,
    mediaType: input.mediaType,
    size: 12,
    mode: "agent",
    s3Key: "key",
  });
  expect(jest.mocked(fetchAction).mock.calls[0][2]).toEqual({
    token: "session",
  });
});
it("preserves backend rejection rather than claiming upload succeeded", async () => {
  jest.mocked(fetchAction).mockRejectedValue(new Error("denied"));
  expect((await POST(request(input))).status).toBe(400);
});

it.each([{}, { storageId: "id", s3Key: "key" }])(
  "rejects ambiguous or missing completed storage references",
  async (references) => {
    expect(
      (await POST(request({ ...input, operation: "complete", ...references })))
        .status,
    ).toBe(400);
    expect(fetchAction).not.toHaveBeenCalled();
  },
);
