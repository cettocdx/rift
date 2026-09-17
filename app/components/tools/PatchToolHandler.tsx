import React, { memo } from "react";
import { FileDiff } from "lucide-react";
import ToolBlock from "@/components/ui/tool-block";
import type { ChatStatus } from "@/types";
import { isUserStoppedToolError } from "@/lib/chat/tool-abort-utils";

/**
 * Row for OpenCode's `apply_patch` (what GPT-family models use instead of
 * edit/write). Summarises files touched and line deltas.
 */
interface PatchToolHandlerProps {
  part: any;
  status: ChatStatus;
}

type PatchFile = { relativePath?: string; filePath?: string; additions?: number; deletions?: number };
type PatchOutput = { files?: PatchFile[]; summary?: string };

export const PatchToolHandler = memo(function PatchToolHandler({ part, status }: PatchToolHandlerProps) {
  const { toolCallId, state, errorText } = part;
  const output = (part.output ?? {}) as PatchOutput;
  const files = Array.isArray(output.files) ? output.files : [];

  switch (state) {
    case "input-streaming":
    case "input-available":
      return status === "streaming" ? (
        <ToolBlock key={toolCallId} icon={<FileDiff />} action="Applying patch" isShimmer />
      ) : null;
    case "output-available": {
      const adds = files.reduce((s, f) => s + (f.additions ?? 0), 0);
      const dels = files.reduce((s, f) => s + (f.deletions ?? 0), 0);
      const target =
        files.length === 1
          ? (files[0].relativePath ?? files[0].filePath)
          : files.length > 1
            ? `${files.length} files`
            : undefined;
      const delta = files.length ? ` (+${adds} −${dels})` : "";
      return <ToolBlock key={toolCallId} icon={<FileDiff />} action={`Applied patch${delta}`} target={target} />;
    }
    case "output-error":
      return (
        <ToolBlock
          key={toolCallId}
          icon={<FileDiff />}
          action={isUserStoppedToolError(errorText) ? "Stopped applying patch" : "Patch failed"}
        />
      );
    default:
      return null;
  }
});
