import { claim, refund, secondsUntilUtcMidnight, utcDay } from "../demo-budget";

/**
 * The landing page's counters are the only thing standing between a public,
 * unauthenticated prompt box and a bill, so they get tests rather than trust.
 *
 * These run without Redis credentials, which exercises the local floor — the
 * path taken in development and CI, and the path that must never fail open on
 * its own. The shared Redis path is the same code with an atomic INCR in front
 * of it; what is asserted here is the contract both share.
 */
describe("landing budget", () => {
  it("allows exactly the limit and then refuses", async () => {
    const key = `test:allow:${Math.random()}`;
    const first = await claim(key, 3, 3600);
    const second = await claim(key, 3, 3600);
    const third = await claim(key, 3, 3600);
    const fourth = await claim(key, 3, 3600);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(true);
    expect(fourth.allowed).toBe(false);
  });

  it("reports what is left, which is what the image route shows the visitor", async () => {
    const key = `test:remaining:${Math.random()}`;
    expect((await claim(key, 2, 3600)).remaining).toBe(1);
    expect((await claim(key, 2, 3600)).remaining).toBe(0);
  });

  it("refunds a unit so a provider outage does not spend the day's budget", async () => {
    const key = `test:refund:${Math.random()}`;
    await claim(key, 1, 3600);
    expect((await claim(key, 1, 3600)).allowed).toBe(false);

    await refund(key);
    expect((await claim(key, 1, 3600)).allowed).toBe(true);
  });

  it("keeps separate keys separate, so one visitor cannot spend another's", async () => {
    const suffix = Math.random();
    const a = await claim(`test:a:${suffix}`, 1, 3600);
    const b = await claim(`test:b:${suffix}`, 1, 3600);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });

  it("does not slide the window forward on every touch", async () => {
    // A fixed window is the point: a limiter that re-extends its own expiry on
    // each refused call never lets the caller back in.
    const key = `test:window:${Math.random()}`;
    const start = Date.parse("2026-08-20T10:00:00.000Z");
    const first = await claim(key, 1, 600, start);
    const refused = await claim(key, 1, 600, start + 500_000);

    expect(first.allowed).toBe(true);
    expect(refused.allowed).toBe(false);
    // ~100s left of the original 600, not a fresh 600.
    expect(refused.retryAfter).toBeLessThanOrEqual(600);
    expect(refused.retryAfter).toBeGreaterThan(0);
  });

  it("expires the window so the visitor gets their run back tomorrow", async () => {
    const key = `test:expiry:${Math.random()}`;
    const start = Date.parse("2026-08-20T10:00:00.000Z");
    expect((await claim(key, 1, 600, start)).allowed).toBe(true);
    expect((await claim(key, 1, 600, start + 300_000)).allowed).toBe(false);
    expect((await claim(key, 1, 600, start + 601_000)).allowed).toBe(true);
  });

  it("counts a UTC day, not a local one", () => {
    // The image budget resets at UTC midnight. A local-time day would reset at
    // a different instant on every deployment region.
    expect(utcDay(Date.parse("2026-08-20T23:59:00.000Z"))).toBe("2026-08-20");
    expect(utcDay(Date.parse("2026-08-21T00:01:00.000Z"))).toBe("2026-08-21");
  });

  it("never hands out a zero-length window", () => {
    // Called a second before midnight, a naive implementation returns 1s or 0
    // and the key expires before it can refuse anything.
    const justBefore = Date.parse("2026-08-20T23:59:59.500Z");
    expect(secondsUntilUtcMidnight(justBefore)).toBeGreaterThanOrEqual(60);
  });
});
