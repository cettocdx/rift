import type { ChatMessage } from "@/types";
import type { FilePart } from "@/types/file";

type MessagePart = ChatMessage["parts"][number];

const TRAILING_METADATA_PART_TYPES = new Set([
  "data-agent-heartbeat",
  "data-appendMessage",
  "data-auto-continue",
  "data-context-usage",
  "data-diff",
  "data-file-metadata",
  "data-rate-limit-warning",
  "data-sandbox-fallback",
  "data-title",
  "data-upload-status",
  "finish-step",
  "step-start",
]);

export type WorkedForParts = {
  fileParts: FilePart[];
  /** Completed media is a user-facing deliverable, never hidden as work log. */
  deliverableParts: MessagePart[];
  nonFileParts: MessagePart[];
  /** Display order, including generated media at its original position. */
  contentParts: MessagePart[];
  workParts: MessagePart[];
  trailingTextParts: MessagePart[];
};

const isMediaDeliverablePart = (part: MessagePart) =>
  part.type === "tool-generate_image" || part.type === "tool-generate_video";

const isTrailingMetadataPart = (part: MessagePart) => {
  const type = (part as { type?: string }).type;
  return !!type && TRAILING_METADATA_PART_TYPES.has(type);
};

export function splitWorkedForParts(
  parts: ChatMessage["parts"],
): WorkedForParts {
  const fileParts = parts.filter((part) => part.type === "file") as FilePart[];
  const deliverableParts = parts.filter(isMediaDeliverablePart);
  const nonFileParts = parts.filter(
    (part) => part.type !== "file" && !isMediaDeliverablePart(part),
  );

  let trailingEnd = nonFileParts.length;
  while (
    trailingEnd > 0 &&
    isTrailingMetadataPart(nonFileParts[trailingEnd - 1])
  ) {
    trailingEnd -= 1;
  }

  let trailingStart = trailingEnd;
  for (let i = trailingEnd - 1; i >= 0; i--) {
    if ((nonFileParts[i] as { type?: string }).type === "text") {
      trailingStart = i;
    } else {
      break;
    }
  }

  return {
    fileParts,
    deliverableParts,
    contentParts: parts.filter((part) => part.type !== "file"),
    nonFileParts,
    workParts: nonFileParts.slice(0, trailingStart),
    trailingTextParts: nonFileParts.slice(trailingStart, trailingEnd),
  };
}
