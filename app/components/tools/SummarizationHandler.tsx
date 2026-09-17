import { memo } from "react";
import { UIMessage } from "@ai-sdk/react";
import { LoaderCircle, WandSparkles } from "lucide-react";
import { Shimmer } from "@/components/ai-elements/shimmer";

interface SummarizationHandlerProps {
  message: UIMessage;
  part: any;
  partIndex: number;
}

// Custom comparison for summarization handler
function areSummarizationPropsEqual(
  prev: SummarizationHandlerProps,
  next: SummarizationHandlerProps,
): boolean {
  if (prev.message.id !== next.message.id) return false;
  if (prev.partIndex !== next.partIndex) return false;
  if (prev.part.data?.status !== next.part.data?.status) return false;
  if (prev.part.data?.message !== next.part.data?.message) return false;
  return true;
}

export const SummarizationHandler = memo(function SummarizationHandler({
  message,
  part,
  partIndex,
}: SummarizationHandlerProps) {
  const isStarted = part.data.status === "started";

  return (
    <div
      key={`${message.id}-summarization-${partIndex}`}
      role="status"
      aria-live="polite"
      className="flex min-h-[30px] items-center gap-1.5 px-0.5 py-1.5 text-[12px] leading-4"
    >
      {isStarted ? (
        <LoaderCircle
          className="size-3.5 shrink-0 text-muted-foreground motion-safe:animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : (
        <WandSparkles
          className="size-3.5 shrink-0 text-muted-foreground/65"
          aria-hidden="true"
        />
      )}
      {isStarted ? (
        <Shimmer className="text-[12px] text-[var(--cursor-text-secondary)]">
          {part.data.message}
        </Shimmer>
      ) : (
        <span className="text-[12px] text-[var(--cursor-text-secondary)]">
          {part.data.message}
        </span>
      )}
    </div>
  );
}, areSummarizationPropsEqual);
