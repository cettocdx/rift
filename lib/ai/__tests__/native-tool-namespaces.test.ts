import { nativeToolNamespaces } from "../native-tool-namespaces";

describe("native tool namespaces", () => {
  it("preserves namespace identity through provider flattening and stateless history", () => {
    const original = {
      tools: [
        { type: "function", name: "exec", parameters: {} },
        {
          type: "namespace",
          name: "collaboration",
          description: "Agents",
          tools: [
            {
              type: "function",
              name: "spawn_agent",
              parameters: { type: "object" },
            },
          ],
        },
      ],
      input: [
        {
          type: "function_call",
          namespace: "collaboration",
          name: "spawn_agent",
          call_id: "c1",
          arguments: "{}",
        },
      ],
    };
    const adapter = nativeToolNamespaces(original);
    const mapped = adapter.body.tools![1].name;
    expect(mapped).toMatch(/^rift_ns_[a-f0-9]+$/);
    expect((adapter.body.input as Record<string, unknown>[])[0]).toEqual({
      type: "function_call",
      name: mapped,
      call_id: "c1",
      arguments: "{}",
    });
    const event = {
      type: "response.output_item.done",
      item: {
        type: "function_call",
        name: mapped,
        call_id: "c2",
        arguments: "{}",
      },
    };
    expect(adapter.restore(event)).toEqual({
      type: event.type,
      item: { ...event.item, name: "spawn_agent", namespace: "collaboration" },
    });
    expect(
      adapter.restore({
        type: "response.completed",
        response: { output: [event.item] },
      }),
    ).toMatchObject({
      response: {
        output: [{ namespace: "collaboration", name: "spawn_agent" }],
      },
    });
    expect(original.input[0].namespace).toBe("collaboration");
  });
  it("rejects a root function that collides with an encoded namespaced tool", () => {
    const input = {
      tools: [
        {
          type: "namespace",
          name: "ns",
          tools: [{ type: "function", name: "run", parameters: {} }],
        },
      ],
    };
    const name = nativeToolNamespaces(input).body.tools![0].name;
    expect(() =>
      nativeToolNamespaces({
        tools: [...input.tools, { type: "function", name, parameters: {} }],
      }),
    ).toThrow(/collision/);
  });
});
