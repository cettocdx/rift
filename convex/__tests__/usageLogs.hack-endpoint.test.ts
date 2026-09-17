/** @jest-environment node */
jest.mock("@convex-dev/auth/server", () => ({ authTables: {} }), {
  virtual: true,
});
jest.mock("../_generated/server", () => ({
  mutation: (config: unknown) => config,
  query: (config: unknown) => config,
}));
jest.mock("../lib/utils", () => ({ validateServiceKey: jest.fn() }));
jest.mock("../unitEconomicsLib", () => ({
  applyUnitEconomicsDelta: jest.fn(async () => {}),
  utcDay: () => "2026-09-13",
}));
const { logUsage } = jest.requireActual("../usageLogs");
const schema = jest.requireActual("../schema").default;

it("admits the dedicated Hack endpoint in both the mutation and stored row contracts", () => {
  for (const endpoint of [
    logUsage.args.endpoint,
    schema.tables.usage_logs.validator.fields.endpoint,
  ]) {
    expect(endpoint.json).toMatchObject({
      type: "union",
      value: expect.arrayContaining([
        { type: "literal", value: "/api/hack-long" },
        { type: "literal", value: "/api/agent-long" },
        { type: "literal", value: "/api/chat" },
        { type: "literal", value: "/api/console/model" },
      ]),
    });
  }
});
it("retains the Hack endpoint when writing its actual usage receipt", async () => {
  const insert = jest.fn(async () => "receipt");
  await logUsage.handler(
    { db: { insert } },
    {
      serviceKey: "fixture",
      user_id: "owner",
      chat_id: "hack-chat",
      endpoint: "/api/hack-long",
      model: "model-grok-4.3",
      type: "included",
      input_tokens: 10,
      output_tokens: 2,
      total_tokens: 12,
      cost_dollars: 0.001,
    },
  );
  expect(insert).toHaveBeenCalledWith(
    "usage_logs",
    expect.objectContaining({
      endpoint: "/api/hack-long",
      chat_id: "hack-chat",
      user_id: "owner",
      total_tokens: 12,
    }),
  );
});
