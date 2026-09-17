import { ChevronDown } from "lucide-react";
import { useGlobalState } from "@/app/contexts/GlobalState";

interface ScrollToBottomButtonProps {
  onClick: () => void;
  hasMessages: boolean;
  isAtBottom: boolean;
}

export const ScrollToBottomButton = ({
  onClick,
  hasMessages,
  isAtBottom,
}: ScrollToBottomButtonProps) => {
  const { isTodoPanelExpanded } = useGlobalState();

  const shouldShowScrollButton =
    hasMessages && !isAtBottom && !isTodoPanelExpanded;

  if (!shouldShowScrollButton) return null;

  return (
    <div>
      <button
        onClick={onClick}
        // The grow is gated to real pointers: a tap on a touch screen fires a
        // hover the finger never takes back, so the button would sit enlarged
        // until something else was tapped. `transition-all` also went — it
        // animated every property that differs between states, layout ones
        // included, when only the shadow and the scale actually change.
        className="bg-background border border-border rounded-full p-2 shadow-lg transition-[box-shadow,transform] duration-200 ease-(--ease-out) pointer-fine:hover:shadow-xl pointer-fine:hover:scale-105 motion-reduce:transition-none flex items-center justify-center"
        aria-label="Scroll to bottom"
        tabIndex={0}
      >
        <ChevronDown className="w-4 h-4 text-muted-foreground" />
      </button>
    </div>
  );
};
