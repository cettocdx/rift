/** @jest-environment node */
import {
  createAgentDispatchIdentity,
  hashAgentDispatchPayload,
} from "../agent-dispatch-identity";

test("stable logical identity is scoped by owner and conversation without delimiter collisions", () => {
  const a = createAgentDispatchIdentity({
    userId: "u",
    chatId: "c",
    dispatchId: "d",
  });
  expect(a).toBe(
    createAgentDispatchIdentity({ userId: "u", chatId: "c", dispatchId: "d" }),
  );
  expect(a).not.toBe(
    createAgentDispatchIdentity({ userId: "u2", chatId: "c", dispatchId: "d" }),
  );
  expect(a).not.toBe(
    createAgentDispatchIdentity({ userId: "u", chatId: "c2", dispatchId: "d" }),
  );
  expect(
    createAgentDispatchIdentity({
      userId: "a:b",
      chatId: "c",
      dispatchId: "d",
    }),
  ).not.toBe(
    createAgentDispatchIdentity({
      userId: "a",
      chatId: "b:c",
      dispatchId: "d",
    }),
  );
  expect(a).toMatch(/^agent-dispatch:v1:[a-f0-9]{64}$/);
});

test("canonical payload digest ignores object key insertion order but binds execution settings and content", () => {
  const first = {
    parts: [{ type: "text", text: "Build it" }],
    model: "model-a",
    sandbox: "e2b",
  };
  expect(hashAgentDispatchPayload(first)).toBe(
    hashAgentDispatchPayload({
      sandbox: "e2b",
      model: "model-a",
      parts: [{ text: "Build it", type: "text" }],
    }),
  );
  for (const changed of [
    { ...first, model: "model-b" },
    { ...first, sandbox: "desktop" },
    { ...first, parts: [{ type: "text", text: "Delete it" }] },
  ]) {
    expect(hashAgentDispatchPayload(first)).not.toBe(
      hashAgentDispatchPayload(changed),
    );
  }
  expect(hashAgentDispatchPayload({ a: [1, 2] })).not.toBe(
    hashAgentDispatchPayload({ a: [2, 1] }),
  );
});

test("rejects non-JSON data and ambiguous missing array elements", () => {
  const cyclic: any = {};
  cyclic.self = cyclic;
  for (const value of [
    cyclic,
    { a: NaN },
    { a: Infinity },
    { a: BigInt(1) },
    { a: () => 1 },
    { a: new Date() },
    { a: [undefined] },
    { a: new Array(1) },
  ]) {
    expect(() => hashAgentDispatchPayload(value)).toThrow();
  }
  const accessor = Object.defineProperty({}, "a", {
    enumerable: true,
    get: () => "secret",
  });
  expect(() => hashAgentDispatchPayload(accessor)).toThrow();
});

test("handles optional normalized fields and repeated object references consistently", () => {
  const shared = { a: "x" };
  expect(
    hashAgentDispatchPayload({
      optional: undefined,
      left: shared,
      right: shared,
    }),
  ).toBe(hashAgentDispatchPayload({ right: { a: "x" }, left: { a: "x" } }));
  expect(() =>
    createAgentDispatchIdentity({ userId: "", chatId: "c", dispatchId: "d" }),
  ).toThrow();
  expect(() =>
    createAgentDispatchIdentity({
      userId: "u",
      chatId: "c",
      dispatchId: " d ",
    }),
  ).toThrow();
});
