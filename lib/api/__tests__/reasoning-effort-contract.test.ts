import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "../../..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const chatClient = read("app/components/chat.tsx");
const chatHandler = read("lib/api/chat-handler.ts");
const agentLongRoute = read("lib/api/agent-long-handler.ts");
const agentLongWorker = read("trigger/agent-long.ts");

describe("reasoning effort transport contract", () => {
  it("adds the latest model-aware effort after caller body overrides", () => {
    const bodyStart = chatClient.indexOf("body: {");
    const spread = chatClient.indexOf("...body", bodyStart);
    const effort = chatClient.indexOf("reasoningEffort:", spread);

    expect(bodyStart).toBeGreaterThan(-1);
    expect(effort).toBeGreaterThan(spread);
    expect(chatClient).toMatch(
      /chatPurposeRef\.current === "app"[\s\S]*reasoningEffortRef\.current/,
    );
  });

  it("normalizes after the active profile model override and enables Build Plan reasoning", () => {
    const processIdx = chatHandler.indexOf("await processChatMessages({");
    const normalizeIdx = chatHandler.indexOf(
      "resolveBuildReasoningEffort(",
      processIdx,
    );

    expect(chatHandler).toMatch(/reasoningEffort:\s*rawReasoningEffort/);
    expect(normalizeIdx).toBeGreaterThan(processIdx);
    expect(chatHandler).toMatch(
      /agentRuntimePolicy\?\.activeProfile\?\.reasoningEffort\s*\?\?[\s\S]*rawReasoningEffort/,
    );
    expect(chatHandler).toMatch(/purpose === "app" \|\| isAgentMode\(mode\)/);
  });

  it("passes the validated value through the route and revalidates in the worker", () => {
    expect(agentLongRoute).toMatch(/resolveBuildReasoningEffort\(/);
    expect(agentLongRoute).toMatch(
      /selectedModel:\s*selectedModelOverride,[\s\S]*reasoningEffort,/,
    );

    const processIdx = agentLongWorker.indexOf("await processChatMessages({");
    const normalizeIdx = agentLongWorker.indexOf(
      "resolveBuildReasoningEffort(",
      processIdx,
    );
    expect(normalizeIdx).toBeGreaterThan(processIdx);
    expect(agentLongWorker).toMatch(
      /agentRuntimePolicy\.activeProfile\?\.reasoningEffort\s*\?\?[\s\S]*rawReasoningEffort/,
    );
    expect(agentLongWorker).toMatch(/reasoningEffort,\s*maxDurationMs:/);
  });
});
