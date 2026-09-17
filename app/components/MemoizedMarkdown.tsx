import { memo, useMemo } from "react";
import { standaloneCodeFence } from "@/lib/ui/streaming-code-fence";
import { markdownLinkRepairOptions } from "@/lib/ui/markdown-link-repair";
import { createIncrementalMarkdownParser } from "@/lib/ui/incremental-markdown-blocks";
import { remarkPlainParagraph } from "@/lib/ui/plain-paragraph-parser";
import {
  Block,
  type BlockProps,
  Streamdown,
  parseMarkdownIntoBlocks,
  defaultRemarkPlugins,
  useIsCodeFenceIncomplete,
} from "streamdown";
import { isInlineCode, type Element } from "react-shiki";
import { CodeHighlight } from "./CodeHighlight";
import { useFileRef } from "./file-ref-context";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { MarkdownTable } from "./MarkdownTable";
import { isTauriEnvironment, revealFileInDir } from "@/app/hooks/useTauri";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

/** Local file path: starts with / or ~/ */
function isLocalFilePath(href: string | undefined): boolean {
  if (!href) return false;
  return href.startsWith("/") || href.startsWith("~/");
}

import { CodePresentationScope } from "@/app/contexts/CodePresentationContext";

interface MemoizedMarkdownProps {
  presentationKey?: string;
  content: string;
  /** Marks an active stream for incremental Markdown parsing. */
  revealWords?: boolean;
}

function MarkdownLink({
  children,
  href,
}: {
  children?: React.ReactNode;
  href?: string;
}) {
  // Local file paths: clickable in Tauri, plain text on web
  if (isLocalFilePath(href)) {
    // Streaming Markdown may expose an unfinished percent escape, and real
    // filenames can contain a literal %. Neither should crash the transcript.
    let decodedPath = href!;
    try {
      decodedPath = decodeURIComponent(decodedPath);
    } catch {
      // Preserve the supplied path rather than guessing at a partial encoding.
    }
    if (isTauriEnvironment()) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => revealFileInDir(decodedPath)}
              className="inline cursor-pointer text-link underline decoration-current/35 underline-offset-2 transition-colors duration-200 hover:text-link/80 hover:decoration-current"
            >
              {children}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{decodedPath}</TooltipContent>
        </Tooltip>
      );
    }
    // Web: render as plain text, not a navigable link
    return <span className="text-muted-foreground">{children}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-link underline decoration-current/35 underline-offset-2 transition-colors duration-200 hover:text-link/80 hover:decoration-current"
    >
      {children}
    </a>
  );
}

// Streamdown revisits all blocks on each delta. Skip unchanged wrappers too,
// before fence classification; default comparison retains every prop update.
const StreamingMarkdownBlock = memo(function StreamingMarkdownBlock(
  props: BlockProps,
) {
  return (
    <CodePresentationScope identity={String(props.index)} requireParent>
      <CodeMarkdownBlock {...props} />
    </CodePresentationScope>
  );
});
function CodeMarkdownBlock(props: BlockProps) {
  // Keep the same code component when its closing fence arrives. Switching to
  // Block here would discard Wrap and the scroll hook's live <pre> anchor.
  // Streamdown gives following prose its own block, with the fence key intact.
  const fence = standaloneCodeFence(props.content);
  if (fence)
    return (
      <CodeHighlight
        isStreaming={props.isIncomplete && !fence.closed}
        className={fence.language ? `language-${fence.language}` : undefined}
      >
        {fence.code}
      </CodeHighlight>
    );
  return <Block {...props} />;
}

// Streamdown compares renderer identities for each completed block. Defining
// a link component during each text delta invalidates every block in the turn.
const MARKDOWN_COMPONENTS = {
  code: FileAwareCode,
  table: MarkdownTable,
  a: MarkdownLink,
};

const MARKDOWN_REMARK_PLUGINS = [
  ...Object.values(defaultRemarkPlugins),
  remarkPlainParagraph,
];

export const MemoizedMarkdown = memo(
  ({
    content,
    revealWords = false,
    presentationKey,
  }: MemoizedMarkdownProps) => {
    const parseBlocks = useMemo(
      () => createIncrementalMarkdownParser(parseMarkdownIntoBlocks),
      [],
    );
    return (
      <CodePresentationScope identity={presentationKey}>
        <Streamdown
          // Render incoming text immediately. Per-word blur and stagger delay
          // reading and make the text reflow look like a second typing animation.
          isAnimating={revealWords}
          animated={false}
          remend={markdownLinkRepairOptions(content)}
          parseMarkdownIntoBlocksFn={parseBlocks}
          components={MARKDOWN_COMPONENTS}
          remarkPlugins={MARKDOWN_REMARK_PLUGINS}
          BlockComponent={StreamingMarkdownBlock}
        >
          {content}
        </Streamdown>
      </CodePresentationScope>
    );
  },
);

MemoizedMarkdown.displayName = "MemoizedMarkdown";

/**
 * Inline code that knows the run.
 *
 * A code span whose text is one of the run's changed files (path or bare
 * name) renders in the command blue and opens that file's diff in the
 * computer sidebar -- the reference agent's "AGENTS.md is a link" behaviour.
 * Everything else falls through to CodeHighlight untouched, so a span is
 * never painted as clickable unless the click has somewhere to go.
 */
export function FileAwareCode(
  props: React.ComponentProps<typeof CodeHighlight>,
) {
  const isStreaming = useIsCodeFenceIncomplete();
  const { node, children } = props as {
    node?: Element;
    children?: React.ReactNode;
  };
  const inline = node ? isInlineCode(node) : false;
  const text = inline ? String(children ?? "") : null;
  const execution = useFileRef(text);
  const { openSidebar } = useGlobalState();

  if (!inline || !execution)
    return <CodeHighlight {...props} isStreaming={isStreaming} />;

  return (
    <button
      type="button"
      data-ui="file-ref"
      title={"path" in execution ? (execution.path as string) : undefined}
      onClick={() => openSidebar(execution)}
      className="inline cursor-pointer whitespace-pre-wrap break-words rounded-[4px] border border-[var(--composer-command)]/25 bg-[var(--composer-command)]/[0.08] px-1 py-0.5 font-mono text-[0.88em] text-[var(--composer-command)] transition-colors duration-(--duration-hover) hover:bg-[var(--composer-command)]/[0.16] focus-visible:outline-none focus-visible:bg-[var(--composer-command)]/[0.16]"
    >
      {children}
    </button>
  );
}
