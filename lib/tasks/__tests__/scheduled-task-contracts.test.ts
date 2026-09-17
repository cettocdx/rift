import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";

const root = path.resolve(__dirname, "../../..");
const workerSource = fs.readFileSync(
  path.join(root, "trigger/scheduled-tasks.ts"),
  "utf8",
);
const agentSource = fs.readFileSync(
  path.join(root, "trigger/agent-long.ts"),
  "utf8",
);

describe("scheduled task Trigger contracts", () => {
  it("uses one bounded declarative dispatcher and idempotent worker runs", () => {
    expect(workerSource).toContain('id: "scheduled-task-dispatcher"');
    expect(workerSource).toContain('cron: "* * * * *"');
    expect(workerSource).toContain("const DISPATCH_LIMIT = 10");
    expect(workerSource).toContain(
      "idempotencyKey: `scheduled-worker:${claim.executionKey}:${claim.dispatchAttempt}`",
    );
    expect(workerSource).toContain("queue: { concurrencyLimit: 10 }");
  });

  it("treats Trigger payloads as lookup keys and revalidates before side effects", () => {
    const begin = workerSource.indexOf("beginScheduledRun({");
    const save = workerSource.indexOf("await saveChat({");
    const trigger = workerSource.indexOf("scheduledAgentTask.trigger(");
    expect(begin).toBeGreaterThan(0);
    expect(save).toBeGreaterThan(begin);
    expect(trigger).toBeGreaterThan(save);
    expect(workerSource).toMatch(
      /type ScheduledTaskWorkerPayload = \{\s*executionKey: string;\s*convexUrl\?: string;\s*\}/,
    );
  });

  it("carries the server-owned task mode into both chat and agent runtime", () => {
    expect(workerSource).toContain("purpose: snapshot.purpose!");
    expect(workerSource.match(/purpose: snapshot\.purpose!/g)).toHaveLength(2);
    expect(workerSource).not.toContain('purpose: "app"');
  });

  it("requires the registered scheduled agent run and persists final status", () => {
    const authorize = agentSource.indexOf("authorizeScheduledAgentRun({");
    const costGate = agentSource.indexOf(
      "assertUserCanMakeCostIncurringRequest(userId)",
    );
    expect(authorize).toBeGreaterThan(0);
    expect(costGate).toBeGreaterThan(authorize);
    expect(agentSource).toContain("finishScheduledRun({");
    expect(agentSource).toContain("agentRunId: ctx.run.id");
  });
});
