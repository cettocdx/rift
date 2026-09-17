import { createHash } from "node:crypto";

type Tool = {
  type: string;
  name?: string;
  namespace?: string;
  description?: string;
  tools?: Tool[];
  [key: string]: unknown;
};
type Item = {
  type?: string;
  name?: string;
  namespace?: string;
  [key: string]: unknown;
};
type Request = {
  tools?: Tool[];
  input?: string | Item[];
  [key: string]: unknown;
};
type Event = {
  item?: Item;
  response?: { output?: Item[]; [key: string]: unknown };
  [key: string]: unknown;
};
/** Adapt namespaced local tools to providers' flat Responses tool declarations. */
export function nativeToolNamespaces<T extends Request>(request: T) {
  const names = new Map<string, { name: string; namespace: string }>();
  const encode = (namespace: string, name: string) => {
    const encoded =
      "rift_ns_" +
      createHash("sha256")
        .update(JSON.stringify([namespace, name]))
        .digest("hex")
        .slice(0, 56);
    const existing = names.get(encoded);
    if (
      existing &&
      (existing.namespace !== namespace || existing.name !== name)
    )
      throw new Error("Native tool name collision");
    names.set(encoded, { namespace, name });
    return encoded;
  };
  const input = Array.isArray(request.input)
    ? request.input.map((item) => {
        if (
          (item.type === "function_call" || item.type === "custom_tool_call") &&
          item.namespace &&
          item.name
        ) {
          const { namespace, ...rest } = item;
          return { ...rest, name: encode(namespace, item.name) };
        }
        return item;
      })
    : request.input;
  const tools = request.tools?.flatMap((tool) =>
    tool.type === "namespace"
      ? (tool.tools ?? []).map((child) => ({
          ...child,
          name: encode(tool.name!, child.name!),
          description: [tool.description, child.description]
            .filter(Boolean)
            .join("\n"),
        }))
      : [tool],
  );
  if (
    tools &&
    (tools.length > 256 ||
      new Set(tools.map((t) => t.name)).size !== tools.length)
  )
    throw new Error("Native tool name collision or tool limit exceeded");
  for (const tool of request.tools ?? [])
    if (tool.type !== "namespace" && names.has(tool.name!))
      throw new Error("Native tool name collision");
  const restoreItem = (item: Item): Item => {
    const name =
      typeof item.name === "string" ? names.get(item.name) : undefined;
    return name &&
      (item.type === "function_call" || item.type === "custom_tool_call")
      ? { ...item, ...name }
      : item;
  };
  return {
    body: { ...request, input, tools },
    restore<E extends Event>(event: E): E {
      return {
        ...event,
        ...(event.item ? { item: restoreItem(event.item) } : {}),
        ...(event.response?.output
          ? {
              response: {
                ...event.response,
                output: event.response.output.map(restoreItem),
              },
            }
          : {}),
      };
    },
  };
}
