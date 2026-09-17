import {
  resolveEffectivePolicy,
  configurableLayers,
} from "../policy-inheritance";

const GUARDRAILS = [
  { id: "rm-rf", name: "Destructive deletes", enabled: true },
  { id: "curl-pipe-sh", name: "Pipe-to-shell installs", enabled: false },
];

const agent = {
  name: "Buddy",
  permissionPreset: "read-only" as const,
  concurrencyLimit: 2,
  approvalPolicy: "risky-actions" as const,
};

const resolve = (overrides: Record<string, unknown> = {}) =>
  resolveEffectivePolicy({
    userGuardrailOverrides: new Map(),
    productGuardrailDefaults: GUARDRAILS,
    ...overrides,
  });

describe("effective policy and where it came from", () => {
  it("names the layer that actually decided each value", () => {
    const settings = resolve({ agent });
    const permission = settings.find((s) => s.key === "permission")!;

    expect(permission.effectiveValue).toBe("Read only");
    expect(permission.decidedBy).toBe("agent");
  });

  it("attributes a guardrail to the product until the user overrides it", () => {
    const fromProduct = resolve().find((s) => s.key === "guardrail:rm-rf")!;
    expect(fromProduct.decidedBy).toBe("product");
    expect(fromProduct.effectiveValue).toBe("Blocked");

    const fromUser = resolve({
      userGuardrailOverrides: new Map([["rm-rf", false]]),
    }).find((s) => s.key === "guardrail:rm-rf")!;
    expect(fromUser.decidedBy).toBe("user");
    expect(fromUser.effectiveValue).toBe("Allowed");
  });

  it("marks a user layer that exists but did not set the value as inheriting", () => {
    const setting = resolve().find((s) => s.key === "guardrail:rm-rf")!;
    const user = setting.chain.find((layer) => layer.id === "user")!;
    expect(user.state).toBe("inherits");
  });

  it("says why a layer cannot carry a setting instead of showing an empty row", () => {
    // An organization exists in this product, so silence would read as
    // "nobody has configured this yet" rather than "this is not a thing".
    const setting = resolve({ agent }).find((s) => s.key === "permission")!;
    const org = setting.chain.find((layer) => layer.id === "organization")!;

    expect(org.state).toBe("not-configurable");
    expect(org.reason).toMatch(/spend and membership/);
    expect(org.value).toBeUndefined();
  });

  it("does not pretend a project or a run can override policy", () => {
    // Drawing these as configurable would show a hierarchy the runtime does
    // not have.
    const setting = resolve({ agent }).find((s) => s.key === "permission")!;
    for (const id of ["project", "run"] as const) {
      const layer = setting.chain.find((entry) => entry.id === id)!;
      expect(layer.state).toBe("not-configurable");
      expect(layer.reason).toBeTruthy();
    }
  });

  it("refuses to let an agent relax a guardrail", () => {
    // Guardrails are the floor. An agent layer that looked settable here would
    // invite exactly the assumption the runtime rejects.
    const setting = resolve({ agent }).find(
      (s) => s.key === "guardrail:rm-rf",
    )!;
    const agentLayer = setting.chain.find((layer) => layer.id === "agent")!;
    expect(agentLayer.state).toBe("not-configurable");
    expect(agentLayer.reason).toMatch(/cannot be relaxed/);
  });

  it("prompts for an agent rather than implying none can narrow this", () => {
    const setting = resolve().find((s) => s.key === "permission")!;
    const agentLayer = setting.chain.find((layer) => layer.id === "agent")!;
    expect(agentLayer.state).toBe("inherits");
    expect(agentLayer.reason).toMatch(/Select an agent/);
  });

  it("omits concurrency entirely with no agent selected", () => {
    // There is no account-wide concurrency to show; inventing a row would be
    // a setting the product does not have.
    expect(resolve().some((s) => s.key === "concurrency")).toBe(false);
    expect(resolve({ agent }).some((s) => s.key === "concurrency")).toBe(true);
  });

  it("reports only the layers that can actually carry policy", () => {
    const layers = configurableLayers(resolve({ agent }));
    expect(layers).toContain("product");
    expect(layers).toContain("agent");
    expect(layers).not.toContain("organization");
    expect(layers).not.toContain("run");
  });
});
