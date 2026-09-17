import type { FileDetails } from "@/types/file";

/** Latest complete receipt wins, retaining each file's first display position. */
export function mergeFileMetadataReceipt(
  previous: ReadonlyMap<string, FileDetails[]>,
  messageId: string,
  incoming: readonly FileDetails[],
): Map<string, FileDetails[]> {
  const next = new Map(previous);
  const existing = next.get(messageId) ?? [];
  const files = new Map(existing.map((file) => [file.fileId, file]));
  for (const file of incoming) files.set(file.fileId, file);
  next.set(messageId, Array.from(files.values()));
  return next;
}
