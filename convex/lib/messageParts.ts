import type { Id } from "../_generated/dataModel";

/**
 * Extract text content from message parts for search and display
 */
export const extractTextFromParts = (parts: any[]): string => {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text || "")
    .join(" ")
    .trim();
};

export const extractFileIdsFromParts = (parts: any[]): Id<"files">[] => {
  const fileIds = new Set<Id<"files">>();

  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "file" && typeof part.fileId === "string") {
      fileIds.add(part.fileId as Id<"files">);
      continue;
    }
    if (
      (part.type === "tool-generate_image" ||
        part.type === "tool-generate_video") &&
      part.output &&
      typeof part.output === "object" &&
      typeof part.output.fileId === "string"
    ) {
      fileIds.add(part.output.fileId as Id<"files">);
    }
  }

  return Array.from(fileIds);
};
