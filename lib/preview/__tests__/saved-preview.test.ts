/** @jest-environment node */
const mockQuery = jest.fn();
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ query: mockQuery }),
  getConvexServiceKey: () => "service",
}));
import { findSavedPreview, loadSavedPreview } from "../saved-preview";
const output = { ok: true, url: "https://3000-saved.e2b.app", port: 3000 };
const part = (value: unknown = output) => ({
  type: "tool-expose_preview",
  state: "output-available",
  output: value,
});
it.each([undefined, null, {}, "legacy text"])(
  "skips unavailable or malformed parts (%j) without hiding an older preview",
  (parts) => {
    const legacy = { role: "assistant", parts };
    expect(() => findSavedPreview([legacy as never])).not.toThrow();
    expect(findSavedPreview([legacy as never])).toBeNull();
    expect(
      findSavedPreview([
        legacy as never,
        { role: "assistant", parts: [part()] },
      ]),
    ).toEqual({ url: output.url, port: 3000 });
  },
);
it("uses latest successful assistant tool output, ignoring user text and failed calls", () => {
  expect(
    findSavedPreview([
      { role: "user", parts: [part()] },
      { role: "assistant", parts: [part(), part({ ...output, ok: false })] },
    ]),
  ).toEqual({ url: output.url, port: 3000 });
});
it.each([
  { ...output, ok: false },
  { ...output, port: "3000" },
  { ...output, port: 65536 },
  { url: output.url, port: 3000 },
])("rejects invalid successful identity %j", (value) => {
  expect(
    findSavedPreview([{ role: "assistant", parts: [part(value)] }]),
  ).toBeNull();
});
it("reads owner-filtered pages beyond the latest page", async () => {
  mockQuery
    .mockResolvedValueOnce({ page: [], isDone: false, continueCursor: "next" })
    .mockResolvedValueOnce({
      page: [{ role: "assistant", parts: [part()] }],
      isDone: true,
    });
  expect(await loadSavedPreview("chat", "owner")).toEqual({
    url: output.url,
    port: 3000,
  });
  expect(mockQuery).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({
      userId: "owner",
      chatId: "chat",
      paginationOpts: { numItems: 50, cursor: "next" },
    }),
  );
});
it("reports incomplete history as uncertainty rather than no preview", async () => {
  mockQuery
    .mockReset()
    .mockResolvedValue({ page: [], isDone: false, continueCursor: "same" });
  await expect(loadSavedPreview("chat", "owner")).rejects.toThrow(
    "Preview history unavailable",
  );
});
