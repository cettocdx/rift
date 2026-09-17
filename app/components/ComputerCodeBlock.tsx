import { useTheme } from "next-themes";
import type { ReactNode } from "react";
import { useState, useMemo } from "react";
import { Download, Copy, Check, WrapText } from "lucide-react";
import ShikiHighlighter from "react-shiki";
import { isLanguageSupported, ShikiErrorBoundary } from "@/lib/utils/shiki";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { downloadFile } from "@/lib/utils/file-download";
import { CURSOR_DARK_SHIKI_THEME } from "@/lib/cursor-shiki-theme";

interface ComputerCodeBlockProps {
  children: ReactNode;
  language?: string;
  wrap?: boolean;
  showButtons?: boolean;
}

export const ComputerCodeBlock = ({
  children,
  language,
  wrap = true,
  showButtons = true,
}: ComputerCodeBlockProps) => {
  const { resolvedTheme } = useTheme();
  const codeContent = String(children);
  const [copied, setCopied] = useState(false);
  const [wrapping, setWrapping] = useState({ source: wrap, value: wrap });
  const isWrapped = wrapping.source === wrap ? wrapping.value : wrap;
  // A parent control wins immediately; keep local toggles until it changes.
  if (wrapping.source !== wrap) setWrapping({ source: wrap, value: wrap });

  // Check if language is supported by Shiki
  const shouldUsePlainText = useMemo(() => {
    return !isLanguageSupported(language);
  }, [language]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy code:", error);
    }
  };

  const handleDownload = () => {
    downloadFile({
      filename: `code.${language || "txt"}`,
      content: codeContent,
    });
  };

  const handleToggleWrap = () => {
    setWrapping({ source: wrap, value: !isWrapped });
  };

  return (
    <div className="shiki not-prose relative flex h-full w-full flex-col overflow-hidden bg-background font-mono text-[12.5px] leading-5">
      {/* Reserve toolbar space so actions never cover the first code line */}
      {showButtons && (
        <div
          role="group"
          aria-label="Code actions"
          className="flex shrink-0 justify-end border-b border-border bg-background p-1"
        >
          <div className="inline-flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="inline-flex size-6 [@media(pointer:coarse)]:size-11 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  aria-label="Download"
                >
                  <Download size={13} strokeWidth={1.75} />
                </button>
              </TooltipTrigger>
              <TooltipContent>Download</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleToggleWrap}
                  className={`inline-flex size-6 [@media(pointer:coarse)]:size-11 items-center justify-center rounded transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                    isWrapped
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                  aria-pressed={isWrapped}
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

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex size-6 [@media(pointer:coarse)]:size-11 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
          </div>
        </div>
      )}

      {/* Code content - takes full available space */}
      <div
        data-testid="code-scroll-area"
        className="min-h-0 w-full flex-1 overflow-auto bg-background"
      >
        {shouldUsePlainText ? (
          <pre
            className={`shiki not-prose relative m-0 h-full min-h-full w-full min-w-0 rounded-none bg-transparent px-3 py-2 font-mono text-[12.5px] leading-5 text-foreground ${
              isWrapped
                ? "whitespace-pre-wrap break-words word-break-break-word"
                : "whitespace-pre overflow-x-auto"
            }`}
          >
            <code className="bg-transparent">{codeContent}</code>
          </pre>
        ) : (
          <ShikiErrorBoundary
            fallback={
              <pre
                className={`shiki not-prose relative m-0 h-full min-h-full w-full min-w-0 rounded-none bg-transparent px-3 py-2 font-mono text-[12.5px] leading-5 text-foreground ${
                  isWrapped
                    ? "whitespace-pre-wrap break-words word-break-break-word"
                    : "whitespace-pre overflow-x-auto"
                }`}
              >
                <code className="bg-transparent">{codeContent}</code>
              </pre>
            }
          >
            <ShikiHighlighter
              language={language}
              theme={
                resolvedTheme === "light"
                  ? "github-light"
                  : CURSOR_DARK_SHIKI_THEME
              }
              delay={150}
              addDefaultStyles={false}
              showLanguage={false}
              className={`shiki not-prose relative h-full w-full bg-transparent font-mono text-[12.5px] leading-5 text-foreground [&_code]:bg-transparent [&_pre]:m-0 [&_pre]:h-full [&_pre]:min-h-full [&_pre]:min-w-0 [&_pre]:w-full [&_pre]:rounded-none [&_pre]:!bg-transparent [&_pre]:px-3 [&_pre]:py-2 [&_span]:bg-transparent ${
                isWrapped
                  ? "[&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:word-break-break-word"
                  : "[&_pre]:whitespace-pre [&_pre]:overflow-x-auto"
              }`}
            >
              {codeContent}
            </ShikiHighlighter>
          </ShikiErrorBoundary>
        )}
      </div>
    </div>
  );
};
