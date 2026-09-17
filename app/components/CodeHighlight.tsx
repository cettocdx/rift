import type { ReactNode } from "react";
import { memo, useMemo } from "react";
import { useTheme } from "next-themes";
import { useShikiHighlighter, isInlineCode, type Element } from "react-shiki";
import { CodeActionButtons } from "@/components/ui/code-action-buttons";
import { CURSOR_DARK_SHIKI_THEME } from "@/lib/cursor-shiki-theme";
import { isLanguageSupported, ShikiErrorBoundary } from "@/lib/utils/shiki";

import {
  useCodePresentationIdentity,
  useCodeWrapping,
} from "@/app/contexts/CodePresentationContext";

interface CodeHighlightProps {
  className?: string | undefined;
  children?: ReactNode | undefined;
  node?: unknown;
  isStreaming?: boolean;
}

// Tokenizing an ever-growing source block also builds thousands of React/DOM
// nodes on the UI thread. Keep large results readable and copyable in full,
// without letting syntax decoration delay input and panel interactions.
const MAX_HIGHLIGHT_CHARACTERS = 32_000;
const MAX_HIGHLIGHT_LINES = 400;

function exceedsHighlightBudget(code: string): boolean {
  if (code.length > MAX_HIGHLIGHT_CHARACTERS) return true;
  let lines = 1;
  for (let i = 0; i < code.length; i++) {
    if (code.charCodeAt(i) === 10 && ++lines > MAX_HIGHLIGHT_LINES) return true;
  }
  return false;
}

/** The SDK component renders nothing until highlighting resolves. Keep the
 * complete plain source in that interval so the transcript cannot collapse. */
function HighlightedCode({
  code,
  language,
  dark,
  fallback,
  className,
}: {
  code: string;
  language: string | undefined;
  dark: boolean;
  fallback: ReactNode;
  className: string;
}) {
  const highlighted = useShikiHighlighter(
    code,
    language,
    dark ? CURSOR_DARK_SHIKI_THEME : "github-light",
    { delay: 150 },
  );
  return (
    <div
      className={`rs-root not-prose ${className}`}
      data-testid="shiki-container"
      data-slot="container"
    >
      {highlighted ?? fallback}
    </div>
  );
}

const CodeHighlightImpl = ({
  className,
  children,
  node,
  isStreaming = false,
  ...props
}: CodeHighlightProps) => {
  const { resolvedTheme } = useTheme();
  const match = className?.match(/language-(\w+)/);
  const language = match ? match[1] : undefined;
  const codeContent = String(children);

  const scope = useCodePresentationIdentity();
  const position = (
    node as { position?: { start?: { offset?: number } } } | undefined
  )?.position?.start?.offset;
  // A standalone fence owns the block scope. Nested AST code needs its source
  // offset to distinguish multiple fences; unavailable identity stays local.
  const identity =
    scope && (!node || typeof position === "number")
      ? JSON.stringify([scope, language ?? null, position ?? null])
      : undefined;
  const [isWrapped, handleToggleWrap] = useCodeWrapping(identity, codeContent);

  const isInline: boolean | undefined = node
    ? isInlineCode(node as Element)
    : undefined;

  // Bound optional syntax work, never the displayed or copied source.
  const shouldUsePlainText = useMemo(() => {
    return (
      isStreaming ||
      !isLanguageSupported(language) ||
      exceedsHighlightBudget(codeContent)
    );
  }, [isStreaming, language, codeContent]);

  const plainCode = (
    <pre
      className={`shiki not-prose relative m-0 rounded-none bg-transparent px-3 py-2.5 font-mono text-[12.5px] font-normal leading-5 text-foreground ${
        isWrapped
          ? "whitespace-pre-wrap break-words overflow-visible"
          : "overflow-x-auto max-w-full"
      }`}
    >
      <code>{codeContent}</code>
    </pre>
  );

  return !isInline ? (
    <div
      data-ui="cursor-code-block"
      className="shiki not-prose relative my-3 overflow-hidden rounded-lg border border-border bg-muted/40"
    >
      {/* Menu bar */}
      <div className="flex h-8 items-center justify-between border-b border-border bg-white/[0.025] px-2.5">
        {/* Left side - Language */}
        <div className="flex-1">
          {language && (
            <span className="font-mono text-[11px] leading-4 text-muted-foreground">
              {language}
            </span>
          )}
        </div>

        {/* Right side - Action buttons */}
        <CodeActionButtons
          content={codeContent}
          language={language}
          isWrapped={isWrapped}
          onToggleWrap={handleToggleWrap}
          variant="codeblock"
        />
      </div>

      {/* Code content */}
      <div className="overflow-hidden">
        {shouldUsePlainText ? (
          plainCode
        ) : (
          <ShikiErrorBoundary fallback={plainCode}>
            <HighlightedCode
              // The hook retains its last result while new work is pending.
              // Give each source/language/theme its own result lifetime so a
              // previous result or late promise never replaces current source.
              key={JSON.stringify([
                codeContent,
                language,
                resolvedTheme === "dark",
              ])}
              code={codeContent}
              language={language}
              dark={resolvedTheme === "dark"}
              fallback={plainCode}
              className={`shiki not-prose relative bg-transparent font-mono text-[12.5px] font-normal leading-5 text-foreground [&_pre]:!m-0 [&_pre]:!bg-transparent [&_pre]:px-3 [&_pre]:py-2.5 [&_pre]:rounded-none ${
                isWrapped
                  ? "[&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:overflow-visible"
                  : "[&_pre]:overflow-x-auto [&_pre]:max-w-full"
              }`}
            />
          </ShikiErrorBoundary>
        )}
      </div>
    </div>
  ) : (
    <code
      className="whitespace-pre-wrap break-words rounded-[4px] border border-border bg-foreground/[0.05] px-1 py-0.5 font-mono text-[0.88em] text-foreground [overflow-wrap:anywhere]"
      {...props}
    >
      {children}
    </code>
  );
};

// Memoize so finished code blocks don't re-highlight when sibling markdown
// re-renders during streaming. Streaming code blocks still update because
// `children` changes each token. Syntax work starts only after streaming,
// with the hook's 150ms delay and full-source fallback while it resolves.
export const CodeHighlight = memo(CodeHighlightImpl);
