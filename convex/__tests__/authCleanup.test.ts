import { describe, it, expect, jest, beforeEach } from "@jest/globals";

jest.mock("../_generated/server", () => ({
  internalMutation: jest.fn((config: any) => config),
}));
jest.mock("convex/values", () => ({
  v: {
    string: jest.fn(() => "string"),
    number: jest.fn(() => "number"),
    null: jest.fn(() => "null"),
    object: jest.fn(() => "object"),
    optional: jest.fn(() => "optional"),
  },
}));

type Row = Record<string, any>;

const FIELD = Symbol("field");
function resolve(x: any, row: Row) {
  return x && typeof x === "object" && FIELD in x ? row[x[FIELD]] : x;
}
// Mirrors the subset of Convex's filter-expression builder the handler uses.
const filterBuilder = {
  field: (name: string) => ({ [FIELD]: name }),
  eq: (a: any, b: any) => (r: Row) => resolve(a, r) === resolve(b, r),
  lt: (a: any, b: any) => (r: Row) => resolve(a, r) < resolve(b, r),
  and:
    (...ps: ((r: Row) => boolean)[]) =>
    (r: Row) =>
      ps.every((p) => p(r)),
  or:
    (...ps: ((r: Row) => boolean)[]) =>
    (r: Row) =>
      ps.some((p) => p(r)),
};

function makeCtx(tables: Record<string, Row[]>) {
  const ctx = {
    db: {
      query(table: string) {
        return {
          withIndex(_name: string, fn?: (q: any) => any) {
            const constraints: ((r: Row) => boolean)[] = [];
            const iq = {
              eq(f: string, val: unknown) {
                constraints.push((r) => r[f] === val);
                return iq;
              },
              lt(f: string, val: any) {
                constraints.push((r) => r[f] < val);
                return iq;
              },
              gt(f: string, val: any) {
                constraints.push((r) => r[f] > val);
                return iq;
              },
            };
            if (fn) fn(iq);
            let rows = (tables[table] ?? []).filter((r) =>
              constraints.every((c) => c(r)),
            );
            const chain = {
              filter(filterFn: (q: any) => (r: Row) => boolean) {
                const pred = filterFn(filterBuilder);
                rows = rows.filter(pred);
                return chain;
              },
              async take(n: number) {
                return rows.slice(0, n);
              },
              async collect() {
                return rows.slice();
              },
            };
            return chain;
          },
        };
      },
      async get(id: string) {
        for (const rows of Object.values(tables)) {
          const row = rows.find((r) => r._id === id);
          if (row) return row;
        }
        return null;
      },
      async delete(id: string) {
        for (const rows of Object.values(tables)) {
          const idx = rows.findIndex((r) => r._id === id);
          if (idx !== -1) {
            rows.splice(idx, 1);
            return;
          }
        }
      },
    },
  };
  return ctx;
}

const NOW = 1_700_000_000_000;
const CUTOFF = NOW - 30 * 60 * 1000;
const OLD = CUTOFF - 60 * 1000; // before the cutoff
const RECENT = CUTOFF + 60 * 1000; // after the cutoff

describe("authCleanup.purgeUnverifiedPasswordAccounts", () => {
  let handler: (
    ctx: any,
    args: { cutoffTimeMs: number; limit?: number },
  ) => Promise<{ deletedCount: number }>;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await import("../authCleanup");
    handler = (mod.purgeUnverifiedPasswordAccounts as any).handler;
  });

  it("deletes inert unverified password accounts plus their codes and user", async () => {
    const tables: Record<string, Row[]> = {
      authAccounts: [
        {
          _id: "A1",
          provider: "password",
          emailVerified: undefined,
          _creationTime: OLD,
          userId: "U1",
        },
      ],
      authVerificationCodes: [
        { _id: "C1", accountId: "A1" },
        { _id: "C2", accountId: "A1" },
      ],
      users: [{ _id: "U1", email: "u1@example.com" }],
      authSessions: [],
    };
    const ctx = makeCtx(tables);

    const res = await handler(ctx, { cutoffTimeMs: CUTOFF });

    expect(res.deletedCount).toBe(1);
    expect(tables.authAccounts).toHaveLength(0);
    expect(tables.authVerificationCodes).toHaveLength(0);
    expect(tables.users).toHaveLength(0);
  });

  it("preserves verified, recent, and non-password accounts", async () => {
    const tables: Record<string, Row[]> = {
      authAccounts: [
        // verified password account → keep
        {
          _id: "A_verified",
          provider: "password",
          emailVerified: "v@example.com",
          _creationTime: OLD,
          userId: "U_v",
        },
        // recent unverified password account → keep (inside grace window)
        {
          _id: "A_recent",
          provider: "password",
          emailVerified: undefined,
          _creationTime: RECENT,
          userId: "U_r",
        },
        // OAuth account → keep
        {
          _id: "A_google",
          provider: "google",
          emailVerified: undefined,
          _creationTime: OLD,
          userId: "U_g",
        },
      ],
      authVerificationCodes: [],
      users: [
        { _id: "U_v", emailVerificationTime: OLD },
        { _id: "U_r" },
        { _id: "U_g" },
      ],
      authSessions: [],
    };
    const ctx = makeCtx(tables);

    const res = await handler(ctx, { cutoffTimeMs: CUTOFF });

    expect(res.deletedCount).toBe(0);
    expect(tables.authAccounts).toHaveLength(3);
    expect(tables.users).toHaveLength(3);
  });

  it("deletes the orphan account but keeps a user who has another linked login", async () => {
    const tables: Record<string, Row[]> = {
      authAccounts: [
        {
          _id: "A_pw",
          provider: "password",
          emailVerified: undefined,
          _creationTime: OLD,
          userId: "U_multi",
        },
        {
          _id: "A_oauth",
          provider: "google",
          emailVerified: "real@example.com",
          _creationTime: OLD,
          userId: "U_multi",
        },
      ],
      authVerificationCodes: [],
      users: [{ _id: "U_multi", email: "real@example.com" }],
      authSessions: [],
    };
    const ctx = makeCtx(tables);

    const res = await handler(ctx, { cutoffTimeMs: CUTOFF });

    expect(res.deletedCount).toBe(1);
    // password row gone, google row + user kept.
    expect(tables.authAccounts.map((a) => a._id)).toEqual(["A_oauth"]);
    expect(tables.users).toHaveLength(1);
  });

  it("keeps a user who already has a session even if a stale password row is purged", async () => {
    const tables: Record<string, Row[]> = {
      authAccounts: [
        {
          _id: "A_pw",
          provider: "password",
          emailVerified: undefined,
          _creationTime: OLD,
          userId: "U_session",
        },
      ],
      authVerificationCodes: [],
      users: [{ _id: "U_session" }],
      authSessions: [{ _id: "S1", userId: "U_session" }],
    };
    const ctx = makeCtx(tables);

    const res = await handler(ctx, { cutoffTimeMs: CUTOFF });

    expect(res.deletedCount).toBe(1);
    expect(tables.authAccounts).toHaveLength(0);
    expect(tables.users).toHaveLength(1); // session present → user kept
  });
});

describe("authCleanup.purgeStaleOtpLimits", () => {
  let handler: (
    ctx: any,
    args: { cutoffTimeMs: number; limit?: number },
  ) => Promise<{ deletedCount: number }>;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await import("../authCleanup");
    handler = (mod.purgeStaleOtpLimits as any).handler;
  });

  it("deletes only rows whose last send predates the cutoff", async () => {
    const tables: Record<string, Row[]> = {
      otp_send_limits: [
        { _id: "R_old", email: "a@x.com", last_sent_at: OLD },
        { _id: "R_recent", email: "b@x.com", last_sent_at: RECENT },
      ],
    };
    const ctx = makeCtx(tables);

    const res = await handler(ctx, { cutoffTimeMs: CUTOFF });

    expect(res.deletedCount).toBe(1);
    expect(tables.otp_send_limits.map((r) => r._id)).toEqual(["R_recent"]);
  });
});
