import fs from "fs";
import path from "path";

const chatHandlerSource = fs.readFileSync(
  path.resolve(__dirname, "../chat-handler.ts"),
  "utf8",
);
const hackRouteSource = fs.readFileSync(
  path.resolve(__dirname, "../../../app/api/hack-chat/route.ts"),
  "utf8",
);
const hackPageSource = fs.readFileSync(
  path.resolve(__dirname, "../../../app/hack/page.tsx"),
  "utf8",
);
const agentLongRouteSource = fs.readFileSync(
  path.resolve(__dirname, "../../../lib/api/agent-long-handler.ts"),
  "utf8",
);
const agentLongWorkerSource = fs.readFileSync(
  path.resolve(__dirname, "../../../trigger/agent-long.ts"),
  "utf8",
);
const resumableStreamRouteSource = fs.readFileSync(
  path.resolve(__dirname, "../../../app/api/chat/[id]/stream/route.ts"),
  "utf8",
);
const agentLongResumeRouteSource = fs.readFileSync(
  path.resolve(__dirname, "../../../app/api/agent-long/resume/route.ts"),
  "utf8",
);
const taskCenterSource = fs.readFileSync(
  path.resolve(__dirname, "../../../app/components/tasks/TaskCenter.tsx"),
  "utf8",
);
const taskBackendSource = fs.readFileSync(
  path.resolve(__dirname, "../../../convex/tasks.ts"),
  "utf8",
);

describe("Hack Workbench Max boundary", () => {
  it("configures the isolated API as Hack-only and forces security purpose", () => {
    expect(hackRouteSource).toMatch(/hackWorkbenchOnly:\s*true/);
    expect(hackRouteSource).toMatch(/forcedPurpose:\s*["']security["']/);
  });

  it("authorizes Max access before parsing an untrusted request body", () => {
    const gateIndex = chatHandlerSource.indexOf(
      "assertHackWorkbenchAccess(verifiedAccess.subscription)",
    );
    const parseIndex = chatHandlerSource.indexOf("await req.json()");

    expect(gateIndex).toBeGreaterThan(-1);
    expect(parseIndex).toBeGreaterThan(gateIndex);
  });

  it("also performs a per-request Max server page gate", () => {
    expect(hackPageSource).toMatch(/await getUserIDAndPro\(\)/);
    expect(hackPageSource).toMatch(
      /hasHackWorkbenchAccess\(access\.subscription\)/,
    );
    expect(hackPageSource).toMatch(/<MaxHackGate\s*\/>/);
  });

  it("rejects the retired security purpose on every normal chat execution boundary", () => {
    expect(chatHandlerSource).toMatch(
      /assertHackWorkbenchPurposeRoute\([\s\S]*?purpose,[\s\S]*?hackWorkbenchOnly && forcedPurpose === "security"/,
    );
    expect(agentLongRouteSource).toContain(
      "assertHackWorkbenchPurposeRoute(purpose, false)",
    );
    expect(agentLongWorkerSource).toContain(
      'purpose: requestedPurpose = "app"',
    );
    const workerValidation = agentLongWorkerSource.indexOf(
      "const projectRuntime = await resolveProjectRuntimeContext",
    );
    expect(
      agentLongWorkerSource.indexOf(
        "assertHackWorkbenchPurposeRoute(purpose, false)",
        workerValidation,
      ),
    ).toBeGreaterThan(workerValidation);
  });

  it("revalidates Max access before reconnecting or replaying Hack streams", () => {
    const ownershipCheck = resumableStreamRouteSource.indexOf(
      "chat.user_id !== userId",
    );
    const premiumCheck = resumableStreamRouteSource.indexOf(
      "assertHackWorkbenchAccess(subscription)",
    );
    const streamLookup = resumableStreamRouteSource.indexOf(
      "const recentStreamId",
    );

    expect(resumableStreamRouteSource).toContain("getUserIDAndPro(req)");
    expect(resumableStreamRouteSource).toContain(
      'coerceChatPurpose(chat.purpose) === "security"',
    );
    expect(premiumCheck).toBeGreaterThan(ownershipCheck);
    expect(streamLookup).toBeGreaterThan(premiumCheck);
  });

  it("never mints normal agent-long resume tokens for legacy Hack chats", () => {
    const ownershipCheck = agentLongResumeRouteSource.indexOf(
      "chat.user_id !== userId",
    );
    const purposeCheck = agentLongResumeRouteSource.indexOf(
      "assertHackWorkbenchPurposeRoute(coerceChatPurpose(chat.purpose), false)",
    );
    const tokenMint = agentLongResumeRouteSource.indexOf(
      "auth.createPublicToken",
    );

    expect(purposeCheck).toBeGreaterThan(ownershipCheck);
    expect(tokenMint).toBeGreaterThan(purposeCheck);
  });

  it("routes Security IA to Hack instead of offering a normal-chat task mode", () => {
    expect(taskCenterSource).toMatch(/<SelectItem value="security" disabled>/);
    expect(taskCenterSource).toContain('href="/hack"');
    expect(taskCenterSource).toContain('form.purpose !== "security"');
    expect(taskBackendSource).toContain(
      "Security tasks must be run from the dedicated Hack Workbench",
    );
    expect(taskBackendSource).toMatch(
      /if \(isSecurityTask\(task\.purpose\)\) \{[\s\S]*?await retireSecurityTask\(ctx, task, args\.now\);[\s\S]*?return \{ state: "canceled" as const \};/,
    );
  });
});
