import {
  buildCreditsAlert,
  classifyCreditsBand,
  DEFAULT_CRITICAL_BELOW_USD,
  DEFAULT_WARN_BELOW_USD,
  evaluateCreditsAlert,
  fetchOpenRouterCredits,
  OPENROUTER_CREDITS_URL,
  parseOpenRouterCredits,
  shouldPostCreditsAlertAt,
} from "../credits";

describe("parseOpenRouterCredits", () => {
  it("reads the documented shape and derives remaining", () => {
    expect(
      parseOpenRouterCredits({ data: { total_credits: 100, total_usage: 99.34 } }),
    ).toEqual({ totalCredits: 100, totalUsage: 99.34, remaining: 0.66 });
  });

  it("rounds float noise out of remaining", () => {
    const parsed = parseOpenRouterCredits({
      data: { total_credits: 0.3, total_usage: 0.1 },
    });
    expect(parsed?.remaining).toBe(0.2);
  });

  it.each([
    null,
    undefined,
    "string",
    {},
    { data: null },
    { data: {} },
    { data: { total_credits: "100", total_usage: 1 } },
    { data: { total_credits: 100 } },
    { data: { total_credits: Number.NaN, total_usage: 1 } },
    { total_credits: 100, total_usage: 1 },
  ])("returns null for %p instead of guessing", (input) => {
    expect(parseOpenRouterCredits(input)).toBeNull();
  });
});

describe("classifyCreditsBand", () => {
  it("uses strict less-than at both thresholds", () => {
    expect(classifyCreditsBand(DEFAULT_WARN_BELOW_USD)).toBe("ok");
    expect(classifyCreditsBand(DEFAULT_WARN_BELOW_USD - 0.01)).toBe("warn");
    expect(classifyCreditsBand(DEFAULT_CRITICAL_BELOW_USD)).toBe("warn");
    expect(classifyCreditsBand(DEFAULT_CRITICAL_BELOW_USD - 0.01)).toBe("critical");
  });

  it("treats the incident balance as critical", () => {
    expect(classifyCreditsBand(0.66)).toBe("critical");
  });

  it("treats negative and non-finite balances as critical", () => {
    expect(classifyCreditsBand(-3)).toBe("critical");
    expect(classifyCreditsBand(Number.NaN)).toBe("critical");
  });

  it("honours custom thresholds", () => {
    expect(classifyCreditsBand(40, 50, 10)).toBe("warn");
    expect(classifyCreditsBand(9, 50, 10)).toBe("critical");
    expect(classifyCreditsBand(60, 50, 10)).toBe("ok");
  });
});

describe("evaluateCreditsAlert", () => {
  it("alerts on first entry into warn and critical", () => {
    expect(evaluateCreditsAlert({ remaining: 10 })).toEqual({
      band: "warn",
      shouldAlert: true,
    });
    expect(evaluateCreditsAlert({ remaining: 1 })).toEqual({
      band: "critical",
      shouldAlert: true,
    });
  });

  it("never alerts while ok", () => {
    expect(evaluateCreditsAlert({ remaining: 500 })).toEqual({
      band: "ok",
      shouldAlert: false,
    });
    expect(
      evaluateCreditsAlert({ remaining: 500, lastAlertedBand: "critical" }),
    ).toEqual({ band: "ok", shouldAlert: false });
  });

  it("does not repeat within the same band", () => {
    expect(
      evaluateCreditsAlert({ remaining: 10, lastAlertedBand: "warn" }).shouldAlert,
    ).toBe(false);
    expect(
      evaluateCreditsAlert({ remaining: 1, lastAlertedBand: "critical" })
        .shouldAlert,
    ).toBe(false);
  });

  it("alerts again when warn worsens to critical", () => {
    expect(
      evaluateCreditsAlert({ remaining: 1, lastAlertedBand: "warn" }).shouldAlert,
    ).toBe(true);
  });

  it("stays quiet when critical eases to warn", () => {
    expect(
      evaluateCreditsAlert({ remaining: 10, lastAlertedBand: "critical" })
        .shouldAlert,
    ).toBe(false);
  });
});

describe("shouldPostCreditsAlertAt", () => {
  const at = (iso: string) => new Date(iso);

  it("never posts while ok", () => {
    expect(shouldPostCreditsAlertAt({ band: "ok", now: at("2026-09-02T00:00:00Z") })).toBe(
      false,
    );
  });

  it("posts on every check while critical", () => {
    for (const iso of [
      "2026-09-02T00:00:00Z",
      "2026-09-02T03:30:00Z",
      "2026-09-02T17:45:00Z",
    ]) {
      expect(shouldPostCreditsAlertAt({ band: "critical", now: at(iso) })).toBe(true);
    }
  });

  it("posts warn only in the first half hour of every sixth UTC hour", () => {
    const yes = [
      "2026-09-02T00:00:00Z",
      "2026-09-02T00:29:59Z",
      "2026-09-02T06:00:00Z",
      "2026-09-02T12:15:00Z",
      "2026-09-02T18:00:00Z",
    ];
    const no = [
      "2026-09-02T00:30:00Z",
      "2026-09-02T01:00:00Z",
      "2026-09-02T05:59:00Z",
      "2026-09-02T12:30:00Z",
      "2026-09-02T23:00:00Z",
    ];
    for (const iso of yes) {
      expect(shouldPostCreditsAlertAt({ band: "warn", now: at(iso) })).toBe(true);
    }
    for (const iso of no) {
      expect(shouldPostCreditsAlertAt({ band: "warn", now: at(iso) })).toBe(false);
    }
  });

  it("accepts epoch milliseconds and custom cadence", () => {
    const t = Date.UTC(2026, 8, 2, 4, 10);
    expect(
      shouldPostCreditsAlertAt({
        band: "warn",
        now: t,
        warnEveryHours: 4,
        checkIntervalMinutes: 15,
      }),
    ).toBe(true);
    expect(
      shouldPostCreditsAlertAt({
        band: "warn",
        now: t,
        warnEveryHours: 4,
        checkIntervalMinutes: 5,
      }),
    ).toBe(false);
  });

  it("does not post on an invalid clock", () => {
    expect(shouldPostCreditsAlertAt({ band: "warn", now: Number.NaN })).toBe(false);
  });
});

describe("buildCreditsAlert", () => {
  const base = { totalCredits: 100, totalUsage: 99.34, remaining: 0.66 };

  it("maps band to severity", () => {
    expect(buildCreditsAlert({ ...base, band: "critical" }).severity).toBe("critical");
    expect(buildCreditsAlert({ ...base, remaining: 12, band: "warn" }).severity).toBe(
      "warning",
    );
    expect(buildCreditsAlert({ ...base, remaining: 80, band: "ok" }).severity).toBe(
      "info",
    );
  });

  it("puts the balance and the tripped threshold in the title", () => {
    const alert = buildCreditsAlert({ ...base, band: "critical" });
    expect(alert.title).toContain("$0.66");
    expect(alert.title).toContain("$5.00");
    const warn = buildCreditsAlert({ ...base, remaining: 12, band: "warn" });
    expect(warn.title).toContain("$20.00");
  });

  it("carries the numbers as fields and links to the credits page", () => {
    const alert = buildCreditsAlert({ ...base, band: "critical" });
    const labels = alert.fields.map((f) => f.label);
    expect(labels).toEqual([
      "Remaining",
      "Band",
      "Total credits",
      "Total usage",
      "Thresholds",
    ]);
    expect(alert.fields.find((f) => f.label === "Remaining")?.value).toBe("$0.66");
    expect(alert.link).toMatch(/^https:\/\/openrouter\.ai\//);
  });
});

describe("fetchOpenRouterCredits", () => {
  const okResponse = (body: unknown, ok = true, status = 200) =>
    ({
      ok,
      status,
      json: async () => body,
    }) as unknown as Response;

  it("sends a bearer token to the credits endpoint and parses the body", async () => {
    const fetchImpl = jest.fn(async () =>
      okResponse({ data: { total_credits: 50, total_usage: 20 } }),
    ) as unknown as typeof fetch;
    const result = await fetchOpenRouterCredits({ apiKey: "sk-or-test", fetchImpl });
    expect(result).toEqual({ totalCredits: 50, totalUsage: 20, remaining: 30 });
    const [url, init] = (fetchImpl as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(OPENROUTER_CREDITS_URL);
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer sk-or-test",
    );
  });

  it("returns null without calling out when the key is empty", async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    expect(await fetchOpenRouterCredits({ apiKey: "  ", fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null on a non-2xx status", async () => {
    const fetchImpl = jest.fn(async () =>
      okResponse({ error: "unauthorized" }, false, 401),
    ) as unknown as typeof fetch;
    expect(await fetchOpenRouterCredits({ apiKey: "k", fetchImpl })).toBeNull();
  });

  it("returns null when the body is not the credits shape", async () => {
    const fetchImpl = jest.fn(async () =>
      okResponse({ data: { balance: 3 } }),
    ) as unknown as typeof fetch;
    expect(await fetchOpenRouterCredits({ apiKey: "k", fetchImpl })).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    expect(await fetchOpenRouterCredits({ apiKey: "k", fetchImpl })).toBeNull();
  });

  it("returns null when json() throws", async () => {
    const fetchImpl = jest.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("bad json");
        },
      }) as unknown as Response,
    ) as unknown as typeof fetch;
    expect(await fetchOpenRouterCredits({ apiKey: "k", fetchImpl })).toBeNull();
  });

  it("aborts and returns null after the timeout", async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = jest.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      ) as unknown as typeof fetch;
      const pending = fetchOpenRouterCredits({
        apiKey: "k",
        fetchImpl,
        timeoutMs: 100,
      });
      jest.advanceTimersByTime(101);
      expect(await pending).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
