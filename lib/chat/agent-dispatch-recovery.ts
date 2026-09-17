/** Resolve ambiguous delivery by reading one owner-authorized receipt. This
 * never resends a task and never falls back to the chat's current run. */
export async function recoverAgentDispatch(
  init: RequestInit | undefined,
  timeoutMs = 3000,
  channel: "app" | "hack" = "app",
): Promise<Response | null> {
  if (
    (channel === "app" &&
      process.env.NEXT_PUBLIC_RIFT_DURABLE_DISPATCH_ADMISSION !== "true") ||
    init?.signal?.aborted ||
    typeof init?.body !== "string"
  )
    return null;
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(init.body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    body = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (
    body.temporary ||
    body.regenerate ||
    body.isAutoContinue ||
    !Array.isArray(body.messages)
  )
    return null;
  const validId = (id: unknown): id is string =>
    typeof id === "string" && !!id && id.length <= 200 && id.trim() === id;
  const message = body.messages.findLast(
    (value: unknown) =>
      !!value &&
      typeof value === "object" &&
      "role" in value &&
      value.role === "user",
  );
  const dispatchId = message?.id;
  if (!validId(body.chatId) || !validId(dispatchId)) return null;
  const query = new URLSearchParams({ chatId: body.chatId, dispatchId });
  const controller = new AbortController();
  let settle: () => void = () => {};
  const interrupted = new Promise<null>((resolve) => {
    settle = () => {
      controller.abort();
      resolve(null);
    };
  });
  const onAbort = () => settle();
  init.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(settle, Math.max(1, timeoutMs));
  try {
    return await Promise.race([
      interrupted,
      (async () => {
        const response = await fetch(
          `/api/${channel === "hack" ? "hack-long" : "agent-long"}/receipt?${query}`,
          {
            method: "GET",
            cache: "no-store",
            credentials: init.credentials ?? "same-origin",
            headers: init.headers,
            signal: controller.signal,
          },
        );
        if (!response.ok || controller.signal.aborted) return null;
        const receipt: unknown = await response.clone().json();
        if (
          controller.signal.aborted ||
          !receipt ||
          typeof receipt !== "object" ||
          Array.isArray(receipt)
        )
          return null;
        const value = receipt as Record<string, unknown>;
        if (
          channel === "hack" &&
          value.delivery === "canceled" &&
          value.dispatchId === dispatchId &&
          value.canceled === true
        )
          return response;
        if (
          value.delivery !== "accepted" ||
          value.dispatchId !== dispatchId ||
          !validId(value.runId) ||
          typeof value.publicAccessToken !== "string" ||
          !value.publicAccessToken.trim()
        )
          return null;
        return response;
      })(),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onAbort);
  }
}

/** A canceled receipt is terminal only for the exact request being observed. */
export async function isConfirmedHackCancellation(
  response: Response,
  init?: RequestInit,
): Promise<boolean> {
  if (
    (!response.ok && response.status !== 409) ||
    typeof init?.body !== "string"
  )
    return false;
  try {
    const body = JSON.parse(init.body);
    if (
      !body ||
      !Array.isArray(body.messages) ||
      body.temporary ||
      body.regenerate ||
      body.isAutoContinue
    )
      return false;
    const dispatchId = body.messages.findLast(
      (value: unknown) =>
        !!value &&
        typeof value === "object" &&
        "role" in value &&
        value.role === "user",
    )?.id;
    if (
      typeof dispatchId !== "string" ||
      !dispatchId ||
      dispatchId.length > 200 ||
      dispatchId.trim() !== dispatchId
    )
      return false;
    const value = await response.clone().json();
    return (
      value?.delivery === "canceled" &&
      value.dispatchId === dispatchId &&
      value.canceled === true
    );
  } catch {
    return false;
  }
}
