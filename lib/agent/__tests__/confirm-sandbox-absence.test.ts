/** @jest-environment node */
import { confirmSandboxAbsence } from "../confirm-sandbox-absence";
class Missing extends Error {}
function fixture() {
  return {
    info: jest.fn().mockRejectedValue(new Missing()),
    isNotFound: (e: unknown) => e instanceof Missing,
    inventory: async function* () {
      yield [{ sandboxId: "other" }];
      yield [];
    },
  };
}
it("requires two not-found responses and a complete inventory", async () => {
  const d = fixture();
  expect(await confirmSandboxAbsence("target", d)).toBe(true);
  expect(d.info).toHaveBeenCalledTimes(2);
});
it.each(["timeout", "unauthorized", "not found"])(
  "rejects generic %s",
  async (m) => {
    const d = fixture();
    d.info.mockRejectedValue(new Error(m));
    expect(await confirmSandboxAbsence("target", d)).toBe(false);
  },
);
it("rejects a paused or running VM in a later page", async () => {
  const d = fixture();
  d.inventory = async function* () {
    yield [];
    yield [{ sandboxId: "target" }];
  };
  expect(await confirmSandboxAbsence("target", d)).toBe(false);
});
it("rejects interrupted inventory", async () => {
  const d = fixture();
  d.inventory = async function* () {
    yield [];
    throw Error("timeout");
  };
  expect(await confirmSandboxAbsence("target", d)).toBe(false);
});
it("rejects a VM reappearing during inventory", async () => {
  const d = fixture();
  d.info.mockRejectedValueOnce(new Missing()).mockResolvedValueOnce({});
  expect(await confirmSandboxAbsence("target", d)).toBe(false);
});
it("rejects cancellation", async () => {
  expect(
    await confirmSandboxAbsence("target", fixture(), AbortSignal.abort()),
  ).toBe(false);
});
