const NOW = 1800000000000;
type Row = Record<string, any>;
export function dispatchFixture() {
  const tables: Record<string, Row[]> = {
    chats: [
      {
        _id: "chat-row",
        _creationTime: NOW,
        id: "chat",
        user_id: "owner",
        title: "test",
        purpose: "security",
        update_time: NOW,
      },
    ],
    agent_run_claims: [
      {
        _id: "claim-row",
        user_id: "owner",
        chat_id: "chat",
        claim_id: "claim",
        phase: "released",
        lease_until: NOW + 90000,
      },
    ],
    agent_dispatch_requests: [],
    agent_dispatch_admissions: [],
    agent_dispatch_intents: [],
    agent_dispatch_stops: [],
    agent_checkpoints: [],
    hack_http_executions: [],
    hack_http_execution_heads: [],
  };
  const db = {
    query: jest.fn((table: string) => ({
      withIndex: (_index: string, predicate: (q: any) => unknown) => {
        const matches: Record<string, unknown> = {};
        const q = {
          eq: (field: string, value: unknown) => {
            matches[field] = value;
            return q;
          },
        };
        predicate(q);
        const read = () =>
          tables[table].filter((r) =>
            Object.entries(matches).every(([key, value]) => r[key] === value),
          );
        return {
          take: async (n: number) => read().slice(0, n),
          first: async () => read()[0] ?? null,
        };
      },
    })),
    patch: jest.fn(async (id: string, patch: Row) => {
      const found = Object.values(tables)
        .flat()
        .find((r) => r._id === id);
      if (!found) throw new Error("missing row");
      Object.assign(found, patch);
    }),
    insert: jest.fn(async (table: string, value: Row) => {
      const next = { _id: `${table}-${tables[table].length}`, ...value };
      tables[table].push(next);
      return next._id;
    }),
  };
  return { ctx: { db }, tables };
}
