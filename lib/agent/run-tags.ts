export type RunTagOutcome = "unchanged" | "updated" | "failed" | "deferred";

/** Dashboard tags are optional metadata, never execution/cleanup authority.
 * Dispatchers normally supply them already. Direct and scheduled runs repair
 * missing tags with a bounded wait; a slow dashboard must not block the task. */
export async function ensureRunTags(
  required: readonly string[],
  existing: readonly string[],
  add: (missing: string[]) => Promise<unknown>,
): Promise<RunTagOutcome> {
  const current = new Set(existing);
  const missing = [...new Set(required)].filter((tag) => !current.has(tag));
  if (!missing.length) return "unchanged";
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Install both handlers before the deadline: a late rejection is observed.
  const update = Promise.resolve()
    .then(() => add(missing))
    .then(
      () => "updated" as const,
      () => "failed" as const,
    );
  try {
    return await Promise.race([
      update,
      new Promise<"deferred">((resolve) => {
        timer = setTimeout(() => resolve("deferred"), 250);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
