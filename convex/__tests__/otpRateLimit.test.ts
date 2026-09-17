import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";

// Pass internalMutation config straight through so we can call .handler directly.
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
// emailCanonical is pure and intentionally NOT mocked — canonicalization is
// part of what the limiter must enforce (one inbox = one bucket).

type Row = Record<string, any>;

// Minimal in-memory Convex db supporting the exact access pattern the handler
// uses: query(table).withIndex(name, q => q.eq(field, value)).unique(),
// insert, and patch.
function makeCtx(seed?: {
  otp_send_limits?: Row[];
  otp_global_limits?: Row[];
}) {
  const tables: Record<string, Row[]> = {
    otp_send_limits: seed?.otp_send_limits ?? [],
    otp_global_limits: seed?.otp_global_limits ?? [],
  };
  let counter = 1;

  const ctx = {
    db: {
      query(table: string) {
        return {
          withIndex(_name: string, fn: (q: any) => any) {
            let field: string | undefined;
            let value: unknown;
            const q = {
              eq(f: string, val: unknown) {
                field = f;
                value = val;
                return q;
              },
            };
            fn(q);
            const matches = tables[table].filter((r) => r[field!] === value);
            return {
              async unique() {
                if (matches.length > 1) {
                  throw new Error(`expected at most one ${table} row`);
                }
                return matches[0] ?? null;
              },
            };
          },
        };
      },
      async insert(table: string, doc: Row) {
        const _id = `${table}_${counter++}`;
        tables[table].push({ _id, ...doc });
        return _id;
      },
      async patch(id: string, patch: Row) {
        for (const rows of Object.values(tables)) {
          const row = rows.find((r) => r._id === id);
          if (row) Object.assign(row, patch);
        }
      },
    },
  };

  return { ctx, tables };
}

let nowMs = 1_700_000_000_000;

describe("otpRateLimit.checkAndRecordSend", () => {
  let handler: (ctx: any, args: { email: string }) => Promise<unknown>;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Date, "now").mockImplementation(() => nowMs);
    delete process.env.OTP_GLOBAL_DAILY_CAP;
    const mod = await import("../otpRateLimit");
    handler = (mod.checkAndRecordSend as any).handler;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("allows the first send and records both buckets", async () => {
    const { ctx, tables } = makeCtx();
    await expect(
      handler(ctx, { email: "alice@example.com" }),
    ).resolves.toBeNull();

    expect(tables.otp_send_limits).toHaveLength(1);
    expect(tables.otp_send_limits[0]).toMatchObject({
      email: "alice@example.com",
      count: 1,
      window_start: nowMs,
      last_sent_at: nowMs,
    });
    expect(tables.otp_global_limits).toHaveLength(1);
    expect(tables.otp_global_limits[0]).toMatchObject({
      bucket: "otp:global",
      count: 1,
    });
  });

  it("rejects a second send to the same inbox within the 60s min-interval", async () => {
    const { ctx, tables } = makeCtx();
    await handler(ctx, { email: "bob@example.com" });

    nowMs += 30 * 1000; // 30s later — inside the min-interval
    await expect(handler(ctx, { email: "bob@example.com" })).rejects.toThrow(
      /please wait/i,
    );
    // The blocked attempt must NOT have incremented the counter.
    expect(tables.otp_send_limits[0].count).toBe(1);
  });

  it("caps a single inbox at 3 sends per 15-minute window", async () => {
    const { ctx, tables } = makeCtx();
    const email = "carol@example.com";

    await handler(ctx, { email }); // 1
    nowMs += 61 * 1000;
    await handler(ctx, { email }); // 2
    nowMs += 61 * 1000;
    await handler(ctx, { email }); // 3
    expect(tables.otp_send_limits[0].count).toBe(3);

    nowMs += 61 * 1000; // still inside the 15-min window
    await expect(handler(ctx, { email })).rejects.toThrow(
      /too many verification codes/i,
    );
    expect(tables.otp_send_limits[0].count).toBe(3);
  });

  it("starts a fresh window once the previous one has elapsed", async () => {
    const { ctx, tables } = makeCtx();
    const email = "dave@example.com";

    await handler(ctx, { email });
    await handler(ctx, { email }).catch(() => {}); // blocked by min-interval, ignore

    nowMs += 16 * 60 * 1000; // past the 15-min window
    await expect(handler(ctx, { email })).resolves.toBeNull();
    expect(tables.otp_send_limits[0]).toMatchObject({
      count: 1,
      window_start: nowMs,
    });
  });

  it("treats +tag / dot / case variants of one inbox as the same bucket", async () => {
    const { ctx, tables } = makeCtx();
    await handler(ctx, { email: "User+signup@Gmail.com" });

    nowMs += 5 * 1000; // within the min-interval
    // canonicalizes to the same user@gmail.com → blocked.
    await expect(
      handler(ctx, { email: "u.s.e.r+other@gmail.com" }),
    ).rejects.toThrow(/please wait/i);
    expect(tables.otp_send_limits).toHaveLength(1);
    expect(tables.otp_send_limits[0].email).toBe("user@gmail.com");
  });

  it("enforces the global daily backstop independent of the per-email gate", async () => {
    // Global bucket already at the default cap, window active.
    const { ctx } = makeCtx({
      otp_global_limits: [
        {
          _id: "otp_global_limits_seed",
          bucket: "otp:global",
          window_start: nowMs,
          count: 1000,
        },
      ],
    });
    // Brand-new inbox → passes per-email gates, but global cap is hit.
    await expect(handler(ctx, { email: "fresh@example.com" })).rejects.toThrow(
      /too many verification emails are being sent/i,
    );
  });

  it("honours an OTP_GLOBAL_DAILY_CAP env override", async () => {
    process.env.OTP_GLOBAL_DAILY_CAP = "2";
    const { ctx } = makeCtx({
      otp_global_limits: [
        {
          _id: "otp_global_limits_seed",
          bucket: "otp:global",
          window_start: nowMs,
          count: 2,
        },
      ],
    });
    await expect(handler(ctx, { email: "fresh2@example.com" })).rejects.toThrow(
      /being sent right now/i,
    );
  });

  it("rejects a malformed recipient without recording it", async () => {
    const { ctx, tables } = makeCtx();
    await expect(handler(ctx, { email: "not-an-email" })).rejects.toThrow(
      /valid email address/i,
    );
    expect(tables.otp_send_limits).toHaveLength(0);
    expect(tables.otp_global_limits).toHaveLength(0);
  });
});
