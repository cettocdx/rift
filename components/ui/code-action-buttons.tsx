import React, { useState } from "react";
import { Download, Copy, Check, WrapText } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { downloadFile } from "@/lib/utils/file-download";

interface CodeActionButtonsProps {
  content: string;
  filename?: string;
  language?: string;
  isWrapped: boolean;
  onToggleWrap: () => void;
  variant?: "sidebar" | "codeblock";
  showDownload?: boolean;
  showCopy?: boolean;
  showWrap?: boolean;
}

export const CodeActionButtons: React.FC<CodeActionButtonsProps> = ({
  content,
  filename,
  language,
  isWrapped,
  onToggleWrap,
  variant = "codeblock",
  showDownload = true,
  showCopy = true,
  showWrap = true,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      if (variant === "sidebar") {
        toast.success("Code copied to clipboard");
      }
    } catch (error) {
      console.error("Failed to copy code:", error);
      if (variant === "sidebar") {
        toast.error("Failed to copy code");
      }
    }
  };

  const handleDownload = () => {
    downloadFile({
      filename: filename || `code.${language || "txt"}`,
      content,
    });
  };

  const getButtonClasses = () => {
    if (variant === "sidebar") {
      return "inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none";
    }
    return "inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none";
  };

  const getWrapButtonClasses = () => {
    if (variant === "sidebar") {
      return `inline-flex size-6 items-center justify-center rounded-md transition-colors focus-visible:outline-none ${
        isWrapped
          ? "bg-foreground/[0.08] text-foreground"
          : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
      }`;
    }
    return `inline-flex size-6 items-center justify-center rounded-md transition-colors focus-visible:outline-none ${
      isWrapped
        ? "bg-foreground/[0.08] text-foreground"
        : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
    }`;
  };

  return (
    <div className="flex items-center gap-0.5">
      {showDownload && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleDownload}
              className={getButtonClasses()}
              aria-label="Download"
            >
              <Download size={13} strokeWidth={1.75} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Download</TooltipContent>
        </Tooltip>
      )}

      {showWrap && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggleWrap}
              className={getWrapButtonClasses()}
              aria-label={
                isWrapped ? "Disable text wrapping" : "Enable text wrapping"
              }
            >
              <WrapText size={13} strokeWidth={1.75} />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {isWrapped ? "Disable text wrapping" : "Enable text wrapping"}
          </TooltipContent>
        </Tooltip>
      )}

      {showCopy && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleCopy}
              className={getButtonClasses()}
              aria-label={copied ? "Copied!" : "Copy"}
            >
              {copied ? (
                <Check size={13} strokeWidth={1.75} />
              ) : (
                <Copy size={13} strokeWidth={1.75} />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>{copied ? "Copied!" : "Copy"}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
};
