import { getLocalPlanPromptContext } from "../local-plan-prompt-context";

const readContext = jest.fn();
const unavailable = jest.fn();
const config = () => ({
  mode: "ask" as const,
  purpose: "app" as const,
  preference: "runner-owned",
  manager: { getReadOnlySandboxContextForPrompt: readContext },
  onUnavailable: unavailable,
});
beforeEach(() => {
  jest.clearAllMocks();
  readContext.mockResolvedValue("Selected local runner: macOS");
  unavailable.mockResolvedValue(undefined);
});

it("uses read-only environment context for Local Plan without Agent command guidance", async () => {
  const commandContext = jest.fn();
  await expect(
    getLocalPlanPromptContext({
      ...config(),
      manager: {
        ...config().manager,
        getSandboxContextForPrompt: commandContext,
      },
    }),
  ).resolves.toBe("Selected local runner: macOS");
  expect(readContext).toHaveBeenCalledTimes(1);
  expect(commandContext).not.toHaveBeenCalled();
  expect(unavailable).not.toHaveBeenCalled();
});

it.each([
  { preference: "e2b" },
  { preference: "desktop" },
  { preference: undefined },
  { mode: "agent" as const },
  { purpose: "security" as const },
  { purpose: "image" as const },
])(
  "does not connect a runner or boot Cloud for an unrelated context: %p",
  async (override) => {
    await expect(
      getLocalPlanPromptContext({ ...config(), ...override }),
    ).resolves.toBeNull();
    expect(readContext).not.toHaveBeenCalled();
    expect(unavailable).not.toHaveBeenCalled();
  },
);

it("awaits pre-model failure cleanup before surfacing an unavailable runner", async () => {
  readContext.mockRejectedValue(new Error("offline"));
  let finish!: () => void;
  unavailable.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  let settled = false;
  const pending = getLocalPlanPromptContext(config()).finally(() => {
    settled = true;
  });
  const rejected = expect(pending).rejects.toMatchObject({
    type: "bad_request",
    surface: "stream",
    cause: expect.stringMatching(/local runner is unavailable/),
  });
  while (!finish) await Promise.resolve();
  expect(settled).toBe(false);
  finish();
  await rejected;
  expect(unavailable).toHaveBeenCalledTimes(1);
});

it("rejects missing local metadata support without silently returning cloud context", async () => {
  await expect(
    getLocalPlanPromptContext({ ...config(), manager: {} }),
  ).rejects.toMatchObject({
    type: "bad_request",
    surface: "stream",
    cause: expect.stringMatching(/local runner is unavailable/),
  });
  expect(unavailable).toHaveBeenCalledTimes(1);
});
