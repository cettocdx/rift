/**
 * Normalize an MCP tool's root input schema to a plain object.
 *
 * Several providers — xAI most strictly — reject a tool whose root parameter
 * schema is not an object. A server that publishes
 * `{"anyOf": [{...object...}, {"type": "string"}]}` at the root therefore kills
 * the whole run with:
 *
 *   tool parameter root must be an object type
 *   (root schema is an anyOf/oneOf union with a non-object branch)
 *
 * One connector shipping a union root should not take the conversation down, so
 * the root is flattened before the tool ever reaches a provider.
 *
 * The transformation is deliberately LOSSY and deliberately PERMISSIVE:
 * branches are merged into one object, and `required` is only kept where every
 * alternative agreed on it. That can let a call through that the union would
 * have rejected — which is safe, because the MCP server validates the payload
 * itself and remains the authority. The opposite bias (inventing constraints)
 * would silently make valid calls impossible.
 */

type JsonRecord = Record<string, unknown>;

const UNION_KEYS = ["anyOf", "oneOf"] as const;

const isPlainObject = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

/** A branch contributes properties only if it is (or could be) an object. */
const objectBranchProperties = (
  branch: unknown,
): { properties: JsonRecord; required: string[] } | null => {
  if (!isPlainObject(branch)) return null;
  if (typeof branch.type === "string" && branch.type !== "object") return null;
  return {
    properties: isPlainObject(branch.properties) ? branch.properties : {},
    required: stringArray(branch.required),
  };
};

const intersect = (lists: string[][]): string[] =>
  lists.length === 0
    ? []
    : lists.reduce((accumulator, list) =>
        accumulator.filter((key) => list.includes(key)),
      );

const union = (lists: string[][]): string[] =>
  Array.from(new Set(lists.flat()));

export function normalizeMcpRootSchema(schema: unknown): JsonRecord {
  if (!isPlainObject(schema)) return { type: "object", properties: {} };

  const unionBranches = UNION_KEYS.flatMap((key) =>
    Array.isArray(schema[key]) ? (schema[key] as unknown[]) : [],
  );
  const allOfBranches = Array.isArray(schema.allOf)
    ? (schema.allOf as unknown[])
    : [];

  const hasComposition = unionBranches.length > 0 || allOfBranches.length > 0;

  // Already a well-formed object root with nothing to flatten.
  if (schema.type === "object" && !hasComposition) return schema;

  if (!hasComposition) {
    // A scalar root (string/array/…) carries no properties worth keeping.
    if (typeof schema.type === "string" && schema.type !== "object") {
      return { type: "object", properties: {}, additionalProperties: true };
    }
    // Typeless root: assume object, which is what every MCP tool means.
    return {
      ...schema,
      type: "object",
      properties: isPlainObject(schema.properties) ? schema.properties : {},
    };
  }

  const properties: JsonRecord = isPlainObject(schema.properties)
    ? { ...schema.properties }
    : {};
  const unionRequired: string[][] = [];
  const allOfRequired: string[][] = [];

  for (const branch of unionBranches) {
    const contribution = objectBranchProperties(branch);
    if (!contribution) continue;
    Object.assign(properties, contribution.properties);
    unionRequired.push(contribution.required);
  }
  for (const branch of allOfBranches) {
    const contribution = objectBranchProperties(branch);
    if (!contribution) continue;
    Object.assign(properties, contribution.properties);
    allOfRequired.push(contribution.required);
  }

  // anyOf/oneOf: only what EVERY alternative demanded is genuinely required.
  // allOf: every branch applies, so their requirements all stand.
  const required = union([
    intersect(unionRequired),
    ...allOfRequired,
    stringArray(schema.required),
  ]).filter((key) => key in properties);

  // `required` is dropped from the spread as well: the merged list below is
  // authoritative, and letting the original through would keep demanding keys
  // that only existed on a branch we just flattened away.
  const {
    anyOf: _anyOf,
    oneOf: _oneOf,
    allOf: _allOf,
    required: _required,
    ...rest
  } = schema as JsonRecord & {
    anyOf?: unknown;
    oneOf?: unknown;
    allOf?: unknown;
    required?: unknown;
  };

  return {
    ...rest,
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

/** True when the root would have been rejected before normalization. */
export function hasNonObjectRoot(schema: unknown): boolean {
  if (!isPlainObject(schema)) return true;
  if (
    UNION_KEYS.some((key) => Array.isArray(schema[key])) ||
    Array.isArray(schema.allOf)
  ) {
    return true;
  }
  return schema.type !== "object";
}
