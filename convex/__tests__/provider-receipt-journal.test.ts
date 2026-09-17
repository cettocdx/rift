/** @jest-environment node */
jest.mock("../_generated/server", () => ({
  mutation: (c: unknown) => c,
  query: (c: unknown) => c,
}));
jest.mock("../lib/utils", () => ({ validateServiceKey: jest.fn() }));
jest.mock("../unitEconomicsLib", () => ({
  applyUnitEconomicsDelta: jest.fn(),
  utcDay: jest.fn(),
}));
const { recordProviderReceipt } = jest.requireActual("../usageLogs");
function fixture() {
  const rows: any[] = [];
  const db = {
    query: jest.fn(() => ({
      withIndex: (_: string, where: any) => {
        let id: string;
        where({
          eq: (_: string, value: string) => {
            id = value;
          },
        });
        return { take: async () => rows.filter((r) => r.receipt_id === id) };
      },
    })),
    insert: jest.fn(async (_: string, row: any) => {
      rows.push(row);
      return "receipt";
    }),
  };
  return { db, rows };
}
const receipt = {
  serviceKey: "trusted",
  receipt_id: "receipt-1",
  user_id: "owner",
  run_id: "run-1",
  model: "test-model",
  usage: { input_tokens: 10, output_tokens: 2, cost_dollars: 0 },
};
it("retains exactly one receipt after a lost response and exact replay", async () => {
  const { db, rows } = fixture();
  await recordProviderReceipt.handler({ db }, receipt); // Drop successful acknowledgment.
  expect(await recordProviderReceipt.handler({ db }, receipt)).toBe(true);
  expect(rows).toHaveLength(1);
  expect(rows[0].usage.cost_dollars).toBe(0);
});
it.each([
  { user_id: "other" },
  { run_id: "other" },
  { model: "other" },
  { usage: { input_tokens: 11, output_tokens: 2, cost_dollars: 0 } },
])("rejects reuse with changed binding or evidence: %j", async (changed) => {
  const { db, rows } = fixture();
  await recordProviderReceipt.handler({ db }, receipt);
  await expect(
    recordProviderReceipt.handler({ db }, { ...receipt, ...changed }),
  ).rejects.toThrow();
  expect(rows).toHaveLength(1);
});
it.each([-1, NaN, Infinity, 1.5])(
  "rejects invalid token evidence %s",
  async (value) => {
    const { db, rows } = fixture();
    await expect(
      recordProviderReceipt.handler(
        { db },
        { ...receipt, usage: { input_tokens: value } },
      ),
    ).rejects.toThrow();
    expect(rows).toHaveLength(0);
  },
);
it("preserves unknown usage rather than inventing zero", async () => {
  const { db, rows } = fixture();
  await recordProviderReceipt.handler({ db }, { ...receipt, usage: {} });
  expect(rows[0].usage).toEqual({});
});

it("validates backend authority before reading or writing receipts", async () => {
  const { validateServiceKey } = jest.requireMock("../lib/utils");
  validateServiceKey.mockImplementationOnce(() => {
    throw new Error("Unauthenticated");
  });
  const { db } = fixture();
  await expect(
    recordProviderReceipt.handler(
      { db },
      { ...receipt, serviceKey: "invalid" },
    ),
  ).rejects.toThrow("Unauthenticated");
  expect(db.query).not.toHaveBeenCalled();
  expect(db.insert).not.toHaveBeenCalled();
});
