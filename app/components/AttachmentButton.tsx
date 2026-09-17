import { Button } from "@/components/ui/button";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Plus } from "lucide-react";

interface AttachmentButtonProps {
  onAttachClick: () => void;
  disabled?: boolean;
}

export const AttachmentButton = ({
  onAttachClick,
  disabled = false,
}: AttachmentButtonProps) => {
  // File / image attachments are available to everyone — no plan gate.
  return (
    <TooltipPrimitive.Root>
      <TooltipTrigger asChild>
        <Button
          type="button"
          onClick={onAttachClick}
          variant="ghost"
          size="icon"
          className="h-11 w-11 min-w-11 cursor-pointer rounded-[8px] p-0 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent motion-reduce:transition-none md:h-7 md:w-7 md:min-w-0 md:rounded-[7px]"
          aria-label="Attach files"
          data-testid="attach-files-button"
          disabled={disabled}
        >
          <Plus aria-hidden="true" className="size-4" strokeWidth={1.7} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Add files and context</p>
      </TooltipContent>
    </TooltipPrimitive.Root>
  );
};
