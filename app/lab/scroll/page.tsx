"use client";

import { useMemo, useState } from "react";
import { useMessageScroll } from "@/app/hooks/useMessageScroll";
import { FilePartRenderer } from "@/app/components/FilePartRenderer";
import dockStyles from "@/app/components/workbench/WorkbenchDock.module.css";

/** Local-only geometry regression fixture. Never creates an agent run. */
export default function ScrollPreview() {
  const view = useMemo(() => ({}), []);
  const { scrollRef, contentRef, scrollToBottom, isAtBottom } =
    useMessageScroll(view);
  const [panel, setPanel] = useState(false);
  const [image, setImage] = useState(false);
  const [lines, setLines] = useState(0);
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b px-4 text-sm">
        <span>Scroll regression · local fixture</span>
        <button onClick={() => setPanel((v) => !v)}>Toggle panel</button>
        <button onClick={() => setImage(true)}>Insert image</button>
        <button onClick={() => setLines((v) => v + 1)}>Append output</button>
        <button onClick={() => scrollToBottom({ instant: true, force: true })}>
          Latest
        </button>
        <span data-testid="following">
          {isAtBottom ? "Following" : "Reading"}
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <div
          ref={scrollRef}
          data-testid="scroll-surface"
          className="min-h-0 min-w-0 flex-1 overflow-y-auto"
        >
          <div
            ref={contentRef}
            data-testid="scroll-content"
            className="mx-auto max-w-[840px] space-y-5 p-5"
          >
            {image && (
              <FilePartRenderer
                part={{
                  url: "/scroll-fixture.svg",
                  mediaType: "image/svg+xml",
                  aspectRatio: "16:9",
                }}
                partIndex={0}
                messageId="fixture"
                large
              />
            )}
            {Array.from({ length: 30 }, (_, i) => (
              <p
                key={i}
                data-testid={`paragraph-${i}`}
                className="text-[14px] leading-6"
              >
                Section {i + 1}.{" "}
                {"Keep this reading position when the workspace panel opens or a generated image finishes loading. The transcript stays mounted and does not jump to the latest output. ".repeat(
                  4,
                )}
              </p>
            ))}
            <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs">
              <code>{"const next = renderFrame();\n".repeat(12 + lines)}</code>
            </pre>
          </div>
        </div>
        <aside
          className={dockStyles.container}
          data-visible={panel}
          style={{ width: panel ? "45%" : 0 }}
          aria-hidden={!panel}
          inert={!panel}
        >
          <div className="p-4 text-sm">Workspace panel</div>
        </aside>
      </div>
    </div>
  );
}
