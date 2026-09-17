import "server-only";
import { api } from "@/convex/_generated/api";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";

import { findSavedPreview, type SavedPreview } from "./preview-evidence";
export { findSavedPreview, type SavedPreview } from "./preview-evidence";

export async function loadSavedPreview(
  chatId: string,
  userId: string,
): Promise<SavedPreview | null> {
  let cursor: string | null = null;
  // Bound history reads. Exhausting the budget is uncertainty, not absence.
  for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
    const result: {
      page: Array<{ role: string; parts: unknown[] }>;
      isDone: boolean;
      continueCursor: string | null;
    } = await getConvexClient().query(api.messages.getMessagesPageForBackend, {
      serviceKey: getConvexServiceKey()!,
      chatId,
      userId,
      paginationOpts: { numItems: 50, cursor },
    });
    const preview = findSavedPreview(result.page);
    if (preview) return preview;
    if (result.isDone) return null;
    if (!result.continueCursor || result.continueCursor === cursor)
      throw new Error("Preview history unavailable");
    cursor = result.continueCursor;
  }
  throw new Error("Preview history budget exhausted");
}
