import {
  __resetOpsAlertWarningForTests,
  buildRunFailureAlert,
  buildTriggerRunUrl,
  formatSlackPayload,
  MAX_FIELD_VALUE_CHARS,
  postOpsAlert,
  shouldAlertOnFailure,
  type OpsAlert,
} from "../alerts";

const baseInput = {
  runId: "run_123",
  chatId: "chat_456",
  category: "provider_error",
  phase: "streaming",
};

describe("shouldAlertOnFailure", () => {
  const quiet = [
    "chat_not_found",
    "login_required",
    "empty_prompt",
    "rate_limited",
    "provider_content_filter",
    "run_conflict",
  ];

  it.each(quiet)("is quiet for %s in setup phase", (category) => {
    expect(shouldAlertOnFailure({ category, phase: "setup" })).toBe(false);
  });

  it.each(quiet)("is quiet for %s in streaming phase", (category) => {
    expect(shouldAlertOnFailure({ category, phase: "streaming" })).toBe(false);
  });

  it.each(quiet)("is quiet for %s with no phase", (category) => {
    expect(shouldAlertOnFailure({ category })).toBe(false);
  });

  it.each(["provider_stream_terminated", "provider_timeout"])(
    "defers %s to the rate check only during streaming",
    (category) => {
      expect(shouldAlertOnFailure({ category, phase: "streaming" })).toBe(false);
      expect(shouldAlertOnFailure({ category, phase: "setup" })).toBe(true);
      expect(shouldAlertOnFailure({ category })).toBe(true);
    },
  );

  it.each([
    "provider_error",
    "unexpected_error",
    "chat_error",
    "input_too_large",
    "something_never_seen",
  ])("alerts on %s in both phases", (category) => {
    expect(shouldAlertOnFailure({ category, phase: "setup" })).toBe(true);
    expect(shouldAlertOnFailure({ category, phase: "streaming" })).toBe(true);
  });

  it("suppresses when the user cancelled", () => {
    expect(
      shouldAlertOnFailure({ category: "unexpected_error", phase: "setup", userCancelled: true }),
    ).toBe(false);
  });

  it("suppresses when a fallback recovered the run", () => {
    expect(
      shouldAlertOnFailure({
        category: "provider_error",
        phase: "streaming",
        recoveredViaFallback: true,
      }),
    ).toBe(false);
  });
});

describe("buildRunFailureAlert", () => {
  it("returns null without a run id", () => {
    expect(buildRunFailureAlert({ ...baseInput, runId: "" })).toBeNull();
  });

  it("marks setup failures critical and streaming failures warning", () => {
    expect(buildRunFailureAlert({ ...baseInput, phase: "setup" })?.severity).toBe("critical");
    expect(buildRunFailureAlert({ ...baseInput, phase: "streaming" })?.severity).toBe("warning");
    expect(buildRunFailureAlert({ ...baseInput, phase: undefined })?.severity).toBe("warning");
  });

  it("includes the identifying fields and optional context", () => {
    const alert = buildRunFailureAlert({
      ...baseInput,
      code: "internal_server_error:chat",
      model: "x-ai/grok-4.3",
      subscription: "pro",
      elapsedMs: 83_400,
    });
    expect(alert).not.toBeNull();
    const map = Object.fromEntries(alert!.fields.map((f) => [f.label, f.value]));
    expect(map).toMatchObject({
      Category: "provider_error",
      Phase: "streaming",
      Run: "run_123",
      Chat: "chat_456",
      Code: "internal_server_error:chat",
      Model: "x-ai/grok-4.3",
      Tier: "pro",
      Elapsed: "1m 23s",
    });
    expect(alert!.title).toContain("provider_error");
    expect(alert!.title).toContain("streaming");
  });

  it("never lets a 2 KB error body reach the fields", () => {
    const body = `Error: ${"x".repeat(2048)} secret prompt text here`;
    const alert = buildRunFailureAlert({
      ...baseInput,
      category: body,
      code: body,
      model: body,
      subscription: body,
    });
    expect(alert).not.toBeNull();
    for (const field of alert!.fields) {
      expect(field.value.length).toBeLessThanOrEqual(MAX_FIELD_VALUE_CHARS);
      expect(field.value).not.toContain("secret prompt text");
    }
    expect(alert!.title).not.toContain("secret prompt text");
    const payload = formatSlackPayload(alert!);
    expect(JSON.stringify(payload)).not.toContain("secret prompt text");
  });

  it("only produces a link when both Trigger ids are present", () => {
    expect(buildRunFailureAlert(baseInput)?.link).toBeUndefined();
    expect(
      buildRunFailureAlert({ ...baseInput, triggerOrgSlug: "rift" })?.link,
    ).toBeUndefined();
    expect(
      buildRunFailureAlert({ ...baseInput, triggerProjectId: "proj_abc" })?.link,
    ).toBeUndefined();
    expect(
      buildRunFailureAlert({
        ...baseInput,
        triggerOrgSlug: "rift",
        triggerProjectId: "proj_abc",
      })?.link,
    ).toBe("https://cloud.trigger.dev/orgs/rift/projects/proj_abc/runs/run_123");
  });

  it("buildTriggerRunUrl treats blank ids as missing", () => {
    expect(
      buildTriggerRunUrl({ runId: "r", triggerOrgSlug: "  ", triggerProjectId: "p" }),
    ).toBeUndefined();
  });
});

describe("formatSlackPayload", () => {
  const alert: OpsAlert = {
    title: "Agent run failed (provider_error) during setup",
    severity: "critical",
    fields: [
      { label: "Category", value: "provider_error" },
      { label: "Run", value: "run_1" },
    ],
    link: "https://cloud.trigger.dev/orgs/o/projects/p/runs/run_1",
  };

  it("produces a one-line fallback text with the facts", () => {
    const { text } = formatSlackPayload(alert);
    expect(text).not.toContain("\n");
    expect(text).toContain("Agent run failed");
    expect(text).toContain("Category: provider_error");
    expect(text).toContain("Run: run_1");
  });

  it("emits header, section fields and a context block with the link", () => {
    const { blocks } = formatSlackPayload(alert);
    const types = (blocks as Array<{ type: string }>).map((b) => b.type);
    expect(types).toEqual(["header", "section", "context"]);
    const context = blocks[2] as { elements: Array<{ text: string }> };
    expect(context.elements[0].text).toContain(alert.link!);
  });

  it("escapes mrkdwn control characters in field values", () => {
    const { blocks } = formatSlackPayload({
      ...alert,
      fields: [{ label: "Code", value: "<script>&" }],
    });
    const section = blocks[1] as { fields: Array<{ text: string }> };
    expect(section.fields[0].text).toContain("&lt;script&gt;&amp;");
  });

  it("chunks more than ten fields across sections", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ label: `F${i}`, value: `${i}` }));
    const { blocks } = formatSlackPayload({ ...alert, fields: many, link: undefined });
    const sections = (blocks as Array<{ type: string }>).filter((b) => b.type === "section");
    expect(sections).toHaveLength(2);
  });
});

describe("postOpsAlert", () => {
  const alert: OpsAlert = {
    title: "t",
    severity: "warning",
    fields: [{ label: "Run", value: "r" }],
  };
  const originalEnv = process.env.OPS_ALERT_WEBHOOK_URL;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    __resetOpsAlertWarningForTests();
    delete process.env.OPS_ALERT_WEBHOOK_URL;
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (originalEnv === undefined) delete process.env.OPS_ALERT_WEBHOOK_URL;
    else process.env.OPS_ALERT_WEBHOOK_URL = originalEnv;
  });

  it("posts JSON to the webhook and reports sent", async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200 }) as Response);
    const result = await postOpsAlert(alert, {
      webhookUrl: "https://hooks.slack.com/services/x",
      fetchImpl,
    });
    expect(result).toEqual({ sent: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.com/services/x");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.text).toContain("t");
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(init.signal).toBeDefined();
  });

  it("reports http_<status> on a non-2xx response without throwing", async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 500 }) as Response);
    await expect(
      postOpsAlert(alert, { webhookUrl: "https://hooks.example/x", fetchImpl }),
    ).resolves.toEqual({ sent: false, reason: "http_500" });
  });

  it("reports network when fetch throws, and never rethrows", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      postOpsAlert(alert, { webhookUrl: "https://hooks.example/x", fetchImpl }),
    ).resolves.toEqual({ sent: false, reason: "network" });
  });

  it("reports timeout when the request is aborted", async () => {
    const fetchImpl = jest.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    await expect(
      postOpsAlert(alert, { webhookUrl: "https://hooks.example/x", fetchImpl }),
    ).resolves.toEqual({ sent: false, reason: "timeout" });
  });

  it("returns no_webhook and warns exactly once per process when unset", async () => {
    const fetchImpl = jest.fn();
    const first = await postOpsAlert(alert, { fetchImpl });
    const second = await postOpsAlert(alert, { fetchImpl });
    expect(first).toEqual({ sent: false, reason: "no_webhook" });
    expect(second).toEqual({ sent: false, reason: "no_webhook" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to OPS_ALERT_WEBHOOK_URL from the environment", async () => {
    process.env.OPS_ALERT_WEBHOOK_URL = "https://hooks.example/env";
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200 }) as Response);
    await postOpsAlert(alert, { fetchImpl });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hooks.example/env");
  });
});
