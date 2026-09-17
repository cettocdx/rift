import {
  effectiveGrantedUsedPoints,
  isAdminGrantedSubscription,
  nextUtcMonthStartIso,
  utcMonthKey,
} from "../included-credits";

describe("admin-granted allowance cycles", () => {
  const august = Date.UTC(2026, 7, 31, 22, 0, 0);

  it("recognises only the admin comp path's subscription ids", () => {
    expect(isAdminGrantedSubscription("admin_grant_ns719w")).toBe(true);
    expect(isAdminGrantedSubscription("sub_01j8x")).toBe(false);
    expect(isAdminGrantedSubscription(undefined)).toBe(false);
    expect(isAdminGrantedSubscription(null)).toBe(false);
  });

  it("rolls an admin grant whose stored cycle is a previous month", () => {
    // The production shape this exists for: a Max comp whose counter filled
    // in July and, with no renewal webhook ever coming, stayed full -- the
    // account showed and was enforced at zero included credits while its
    // purchased balance drained instead.
    const rolled = effectiveGrantedUsedPoints({
      storedUsedPoints: 1_800_000,
      storedCycleMonth: "2026-07",
      adminGranted: true,
      now: august,
    });
    expect(rolled).toEqual({
      usedPoints: 0,
      cycleRolled: true,
      cycleMonth: "2026-08",
    });
  });

  it("keeps the counter inside the same admin month", () => {
    const held = effectiveGrantedUsedPoints({
      storedUsedPoints: 250_000,
      storedCycleMonth: "2026-08",
      adminGranted: true,
      now: august,
    });
    expect(held.usedPoints).toBe(250_000);
    expect(held.cycleRolled).toBe(false);
  });

  it("treats a missing cycle stamp as due for a roll", () => {
    // Admin rows minted before the stamp existed carry no month at all.
    const rolled = effectiveGrantedUsedPoints({
      storedUsedPoints: 900_000,
      storedCycleMonth: undefined,
      adminGranted: true,
      now: august,
    });
    expect(rolled.usedPoints).toBe(0);
    expect(rolled.cycleRolled).toBe(true);
  });

  it("never rolls a paid plan on the calendar", () => {
    // Paid cycles reset on the provider's renewal webhook and only there; a
    // calendar boundary is not a paid renewal. That policy stands -- the
    // admin path is the exception because nothing else ever arrives.
    const paid = effectiveGrantedUsedPoints({
      storedUsedPoints: 1_800_000,
      storedCycleMonth: "2025-01",
      adminGranted: false,
      now: august,
    });
    expect(paid.usedPoints).toBe(1_800_000);
    expect(paid.cycleRolled).toBe(false);
  });

  it("keys and renews the cycle in UTC", () => {
    expect(utcMonthKey(august)).toBe("2026-08");
    expect(nextUtcMonthStartIso(august)).toBe("2026-09-01T00:00:00.000Z");
    // December rolls into the next year, not month 13.
    expect(nextUtcMonthStartIso(Date.UTC(2026, 11, 31))).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("sanitises a corrupt stored counter", () => {
    expect(
      effectiveGrantedUsedPoints({
        storedUsedPoints: -50,
        storedCycleMonth: "2026-08",
        adminGranted: true,
        now: august,
      }).usedPoints,
    ).toBe(0);
  });
});
