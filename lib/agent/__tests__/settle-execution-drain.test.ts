import { settleExecutionDrain } from "../settle-execution-drain";

it("preserves local drain proof when remote exit verification fails", async () => {
  const events: string[] = [];
  const error = new Error("receipt unavailable");
  await expect(
    settleExecutionDrain({
      drain: {
        drainTools: async () => {
          events.push("tools");
        },
        settle: async () => {
          events.push("remote");
          throw error;
        },
      },
      closeIntegrations: async () => {
        events.push("integrations");
      },
      recordLocalDrain: () => {
        events.push("proof");
      },
      stage: () => {},
    }),
  ).rejects.toBe(error);
  expect(events).toEqual(["tools", "integrations", "proof", "remote"]);
});

it.each(["tools", "integrations"])(
  "does not certify local cleanup after %s fails",
  async (failed) => {
    const proof = jest.fn();
    const remote = jest.fn();
    const failure = async (stage: string) => {
      if (stage === failed) throw new Error(stage);
    };
    await expect(
      settleExecutionDrain({
        drain: { drainTools: () => failure("tools"), settle: remote },
        closeIntegrations: () => failure("integrations"),
        recordLocalDrain: proof,
        stage: () => {},
      }),
    ).rejects.toThrow(failed);
    expect(proof).not.toHaveBeenCalled();
  },
);
