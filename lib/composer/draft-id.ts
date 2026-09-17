/** Keep the existing Build draft while giving other composers their own scope. */
export function newChatDraftId(purpose: string): string {
  return purpose === "app" ? "new" : `new:${purpose}`;
}

export function isNewChatDraft(id: string): boolean {
  return id === "new" || id.startsWith("new:");
}
