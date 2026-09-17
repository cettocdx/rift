import { renderHook } from "@testing-library/react";
import { useConversationStatuses } from "../useConversationStatuses";

let mockRuns: Array<{
  id: string;
  chat_id: string;
  status: string;
  started_at: number;
  ended_at?: number;
}> = [];
jest.mock("convex/react", () => ({ useQuery: () => mockRuns }));

beforeEach(() => {
  mockRuns = [];
  localStorage.clear();
});

it("retains authoritative completion while chat cleanup lags, then follows the replacement", () => {
  const started_at = Date.now();
  const a = { id: "run-a", chat_id: "chat", status: "running", started_at };
  mockRuns = [a];
  const { result, rerender } = renderHook(
    ({ active }) =>
      useConversationStatuses([{ id: "chat", active_trigger_run_id: active }]),
    { initialProps: { active: "run-a" } },
  );
  expect(result.current[0].sidebarStatus).toBe("running");
  mockRuns = [{ ...a, status: "completed", ended_at: started_at + 1 }];
  rerender({ active: "run-a" });
  expect(result.current[0].sidebarStatus).toBeUndefined();
  rerender({ active: "run-b" });
  expect(result.current[0].sidebarStatus).toBe("running");
  mockRuns = [
    ...mockRuns,
    {
      ...a,
      id: "run-b",
      status: "waiting_for_approval",
      started_at: started_at + 2,
    },
  ];
  rerender({ active: "run-b" });
  expect(result.current[0].sidebarStatus).toBe("waiting");
});

it("uses the matching active run instead of choosing another run by timestamp", () => {
  const now = Date.now();
  mockRuns = [
    {
      id: "older-claim",
      chat_id: "chat",
      status: "failed",
      started_at: now + 100,
      ended_at: now + 200,
    },
    {
      id: "active-claim",
      chat_id: "chat",
      status: "waiting_for_approval",
      started_at: now,
    },
  ];
  const { result } = renderHook(() =>
    useConversationStatuses([
      { id: "chat", active_trigger_run_id: "active-claim" },
    ]),
  );
  expect(result.current[0].sidebarStatus).toBe("waiting");
});
