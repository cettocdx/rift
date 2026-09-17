import React, { memo } from "react";
import { FileSearch, FolderSearch } from "lucide-react";
import ToolBlock from "@/components/ui/tool-block";
import type { ChatStatus } from "@/types";
import { isUserStoppedToolError } from "@/lib/chat/tool-abort-utils";

/**
 * Compact row for the OpenCode engine's grep/glob (mapped to `tool-search`).
 * Shows what was searched and how many hits came back; no result dump — the
 * transcript already carries the text and the model already read it.
 */
interface SearchToolHandlerProps {
  part: any;
  status: ChatStatus;
}

type SearchInput = { kind?: "grep" | "glob"; pattern?: string; path?: string; brief?: string };
type SearchOutput = { count?: number; truncated?: boolean; text?: string };

export const SearchToolHandler = memo(function SearchToolHandler({ part, status }: SearchToolHandlerProps) {
  const { toolCallId, state, errorText } = part;
  const input = (part.input ?? {}) as SearchInput;
  const output = (part.output ?? {}) as SearchOutput;
  const isGlob = input.kind === "glob";
  const icon = isGlob ? <FolderSearch /> : <FileSearch />;
  const verb = isGlob ? "Finding files" : "Searching code";
  const done = isGlob ? "Found files" : "Searched code";
  const target = input.pattern ? `'${input.pattern}'` : undefined;

  switch (state) {
    case "input-streaming":
    case "input-available":
      return status === "streaming" ? (
        <ToolBlock key={toolCallId} icon={icon} action={verb} target={target} isShimmer />
      ) : null;
    case "output-available": {
      const n = typeof output.count === "number" ? output.count : undefined;
      const unit = isGlob ? "files" : "matches";
      const summary = n === undefined ? done : `${done} · ${n}${output.truncated ? "+" : ""} ${unit}`;
      return <ToolBlock key={toolCallId} icon={icon} action={summary} target={target} />;
    }
    case "output-error":
      return (
        <ToolBlock
          key={toolCallId}
          icon={icon}
          action={isUserStoppedToolError(errorText) ? `Stopped ${verb.toLowerCase()}` : `${done} failed`}
          target={target}
        />
      );
    default:
      return null;
  }
});
