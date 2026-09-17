import { runTrackedPreflight } from "../preflight";
import type { RateLimitInfo } from "@/types";
const usage = { servedFrom: "balance", pointsDeducted: 10 } as RateLimitInfo;
const tracker = () => ({ recordDeductions: jest.fn(), recordFreeAgentClaim: jest.fn() });
test("waits for a late reservation before exposing snapshot failure to the refund handler", async () => {
  let finish!: (value: RateLimitInfo) => void;
  const reserve = new Promise<RateLimitInfo>(resolve => { finish = resolve; });
  const records = tracker();
  const fail = new Error("snapshot offline");
  let caught = false;
  const pending = runTrackedPreflight({ reserve: () => reserve, snapshot: async () => { throw fail; }, moderation: Promise.resolve(null), tracker: records, agentMode: true });
  const settled = pending.catch(error => { caught = true; expect(error).toBe(fail); expect(records.recordDeductions).toHaveBeenCalledWith(usage); });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(caught).toBe(false);
  finish(usage);
  await settled;
  expect(records.recordDeductions).toHaveBeenCalledTimes(1);
});
test("records the free agent claim even when moderation fails", async () => {
  const records = tracker();
  await expect(runTrackedPreflight({ reserve: async () => ({...usage, servedFrom: "free"}), snapshot: async () => null, moderation: Promise.reject(new Error("moderation offline")), tracker: records, agentMode: true })).rejects.toThrow("moderation offline");
  expect(records.recordFreeAgentClaim).toHaveBeenCalledTimes(1);
});
test("a failed reservation does not record a charge", async () => {
  const records = tracker();
  await expect(runTrackedPreflight({ reserve: async () => {throw new Error("denied");}, snapshot: async () => null, moderation: Promise.resolve(null), tracker: records, agentMode: true })).rejects.toThrow("denied");
  expect(records.recordDeductions).not.toHaveBeenCalled();
});
test("returns successful parallel results and does not claim free agent use for chat", async () => {
  const records = tracker();
  await expect(runTrackedPreflight({ reserve: async () => usage, snapshot: async () => "monthly", moderation: Promise.resolve("checked"), tracker: records, agentMode: false })).resolves.toEqual([usage,"monthly","checked"]);
  expect(records.recordFreeAgentClaim).not.toHaveBeenCalled();
});
