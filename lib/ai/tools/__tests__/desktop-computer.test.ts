/** @jest-environment node */
const mockRelay = jest.fn();
jest.mock("@/lib/desktop/local-access-relay", () => ({
  requestDesktopLocalAccess: (...args: unknown[]) => mockRelay(...args),
  DesktopLocalAccessError: class extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
import {
  computerInputSchema,
  createDesktopComputerTools,
} from "../desktop-computer";
import { requiresToolApproval } from "@/lib/ai/approval/policy";
import { DesktopLocalAccessError } from "@/lib/desktop/local-access-relay";
const opts = { toolCallId: "observe", messages: [] };
const click = {
  brief: "Click observed button",
  request: { action: "click", x: 0.3, y: 0.5 },
};
const build = (vision = true) =>
  createDesktopComputerTools({
    userId: "owner",
    serviceKey: "service",
    canViewScreenshots: () => vision,
  });
async function observe(tools: ReturnType<typeof build>["all"]) {
  const output = await tools.desktop_screenshot.execute!(
    { brief: "Observe main display" },
    opts,
  );
  return tools.desktop_screenshot.toModelOutput!({
    output: output as never,
    toolCallId: opts.toolCallId,
    input: { brief: "Observe" },
  });
}
beforeEach(() => {
  mockRelay.mockReset();
  mockRelay.mockResolvedValue({
    image: "private-base64",
    mediaType: "image/jpeg",
  });
});
it("delivers the screen once to the model without persisting pixels", async () => {
  const { all } = build();
  const output = await all.desktop_screenshot.execute!(
    { brief: "Observe" },
    opts,
  );
  expect(JSON.stringify(output)).not.toContain("private-base64");
  const args = {
    output: output as never,
    toolCallId: "observe",
    input: { brief: "Observe" },
  };
  expect(all.desktop_screenshot.toModelOutput!(args)).toMatchObject({
    type: "content",
  });
  expect(all.desktop_screenshot.toModelOutput!(args)).toMatchObject({
    type: "text",
  });
  expect(mockRelay).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: "owner",
      operation: "computer_action",
      payload: { action: "screenshot" },
    }),
    expect.objectContaining({ serviceKey: "service" }),
  );
});
it("requires a fresh observed screen for every input", async () => {
  const { all } = build();
  const execute = all.desktop_computer_action.execute!;
  expect(await execute(click as never, opts)).toMatchObject({ ok: false });
  expect(mockRelay).not.toHaveBeenCalled();
  await observe(all);
  mockRelay.mockResolvedValue({ performed: true });
  expect(await execute(click as never, opts)).toMatchObject({
    ok: true,
    performed: true,
  });
  expect(await execute(click as never, opts)).toMatchObject({ ok: false });
  expect(mockRelay).toHaveBeenCalledTimes(2);
});
it("does not retry ambiguous input, and requires observing after it", async () => {
  const { all } = build();
  await observe(all);
  mockRelay.mockRejectedValue(
    new DesktopLocalAccessError("outcome_unknown", "lost"),
  );
  expect(
    await all.desktop_computer_action.execute!(click as never, opts),
  ).toMatchObject({ code: "outcome_unknown" });
  expect(
    await all.desktop_computer_action.execute!(click as never, opts),
  ).toMatchObject({ ok: false, error: expect.stringContaining("fresh") });
  expect(mockRelay).toHaveBeenCalledTimes(2);
});
it("fails before capture when model cannot receive images", async () => {
  const { all } = build(false);
  expect(
    await all.desktop_screenshot.execute!({ brief: "Observe" }, opts),
  ).toMatchObject({ ok: false });
  expect(mockRelay).not.toHaveBeenCalled();
});
it("preserves Plan and approval policy boundaries", () => {
  expect(build().readOnly).not.toHaveProperty("desktop_computer_action");
  expect(requiresToolApproval("auto", "desktop_computer_action", click)).toBe(
    true,
  );
  expect(requiresToolApproval("ask", "desktop_screenshot", {})).toBe(true);
  expect(requiresToolApproval("full", "desktop_computer_action", click)).toBe(
    false,
  );
});
it("rejects invalid coordinates and extra command fields", () => {
  expect(
    computerInputSchema.safeParse({
      ...click,
      request: { action: "click", x: 2, y: 0.5 },
    }).success,
  ).toBe(false);
  expect(
    computerInputSchema.safeParse({
      ...click,
      request: { action: "type", text: "hello", command: "sh" },
    }).success,
  ).toBe(false);
});
