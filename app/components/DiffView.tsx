"use client";

import React, { useState, useRef, useLayoutEffect, useId } from "react";
import { DiffEditor, loader, type Monaco } from "@monaco-editor/react";
import { MONACO_ASSET_PATH } from "@/lib/ui/monaco-assets";
import { useTheme } from "next-themes";
import {
  WORKBENCH_EDITOR_THEME_NAMES,
  WORKBENCH_EDITOR_THEMES,
  workbenchEditorThemeName,
} from "./workbench/workbench-theme";
import { ComputerCodeBlock } from "./ComputerCodeBlock";

loader.config({ paths: { vs: MONACO_ASSET_PATH } });

type ViewMode = "diff" | "original" | "modified";

interface DiffViewProps {
  originalContent: string;
  modifiedContent: string;
  language: string;
  wrap?: boolean;
}

export const DiffView: React.FC<DiffViewProps> = ({
  originalContent,
  modifiedContent,
  language,
  wrap = true,
}) => {
  const { resolvedTheme } = useTheme();
  const [viewMode, setViewMode] = useState<ViewMode>("diff");
  const editorRef = useRef<any>(null);
  const tabRefs = useRef<Partial<Record<ViewMode, HTMLButtonElement | null>>>(
    {},
  );
  const instanceId = useId();
  const tabId = (mode: ViewMode) => `${instanceId}-${mode}-tab`;
  const panelId = (mode: ViewMode) => `${instanceId}-${mode}-panel`;

  // Detach models before the React wrapper disposes them during passive cleanup.
  // The wrapper owns editor disposal; disposing it twice races its model cleanup.
  useLayoutEffect(() => {
    return () => {
      try {
        const model = editorRef.current?.getModel();
        editorRef.current?.setModel(null);
        model?.original.dispose();
        model?.modified.dispose();
      } catch {
        // Ignore disposal errors
      }
      editorRef.current = null;
    };
  }, []);

  const handleEditorMount = (editor: any) => {
    editorRef.current = editor;
  };

  const defineThemes = (monaco: Monaco) => {
    for (const scheme of ["light", "dark"] as const) {
      monaco.editor.defineTheme(
        WORKBENCH_EDITOR_THEME_NAMES[scheme],
        WORKBENCH_EDITOR_THEMES[scheme],
      );
    }
  };

  const tabs: Array<{ id: ViewMode; label: string }> = [
    { id: "diff", label: "Diff" },
    { id: "original", label: "Original" },
    { id: "modified", label: "Modified" },
  ];

  const handleTabChange = (tab: ViewMode) => {
    setViewMode(tab);
  };

  const handleTabKeyDown = (e: React.KeyboardEvent, tab: ViewMode) => {
    const index = tabs.findIndex(({ id }) => id === tab);
    let nextIndex: number;
    switch (e.key) {
      case "ArrowRight":
        nextIndex = (index + 1) % tabs.length;
        break;
      case "ArrowLeft":
        nextIndex = (index + tabs.length - 1) % tabs.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const nextTab = tabs[nextIndex].id;
    setViewMode(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  // Map common language names to Monaco language IDs
  const getMonacoLanguage = (lang: string): string => {
    const languageMap: Record<string, string> = {
      js: "javascript",
      ts: "typescript",
      py: "python",
      rb: "ruby",
      yml: "yaml",
      md: "markdown",
      sh: "shell",
      bash: "shell",
      zsh: "shell",
      txt: "plaintext",
      text: "plaintext",
    };
    return languageMap[lang.toLowerCase()] || lang.toLowerCase();
  };

  return (
    <div
      data-ui="cursor-diff-view"
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background"
    >
      <div
        role="tablist"
        aria-label="Diff view mode"
        className="flex h-9 shrink-0 pointer-coarse:h-12 items-center gap-0.5 border-b border-border bg-muted px-1.5"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={tabId(tab.id)}
            ref={(node) => {
              tabRefs.current[tab.id] = node;
            }}
            type="button"
            onClick={() => handleTabChange(tab.id)}
            onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
            className={`h-7 pointer-coarse:h-11 rounded-md px-2.5 text-[11.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:-outline-offset-2 ${
              viewMode === tab.id
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
            tabIndex={viewMode === tab.id ? 0 : -1}
            aria-controls={panelId(tab.id)}
            aria-selected={viewMode === tab.id}
            role="tab"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-background">
        <div
          id={panelId("diff")}
          role="tabpanel"
          aria-labelledby={tabId("diff")}
          tabIndex={0}
          hidden={viewMode !== "diff"}
          className={viewMode === "diff" ? "h-full" : "hidden"}
        >
          <DiffEditor
            original={originalContent}
            modified={modifiedContent}
            language={getMonacoLanguage(language)}
            theme={workbenchEditorThemeName(resolvedTheme)}
            beforeMount={defineThemes}
            onMount={handleEditorMount}
            options={{
              readOnly: true,
              renderSideBySide: false,
              wordWrap: wrap ? "on" : "off",
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              lineNumbers: "on",
              glyphMargin: false,
              folding: false,
              lineDecorationsWidth: 8,
              lineNumbersMinChars: 3,
              renderOverviewRuler: false,
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: true,
              scrollbar: {
                vertical: "auto",
                horizontal: "auto",
                verticalScrollbarSize: 6,
                horizontalScrollbarSize: 6,
              },
              renderLineHighlight: "none",
              fontSize: 12.5,
              lineHeight: 20,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              padding: { top: 6, bottom: 8 },
            }}
          />
        </div>
        <div
          id={panelId("original")}
          role="tabpanel"
          aria-labelledby={tabId("original")}
          tabIndex={0}
          hidden={viewMode !== "original"}
          className={viewMode === "original" ? "h-full" : "hidden"}
        >
          {viewMode === "original" && (
            <ComputerCodeBlock
              language={language}
              wrap={wrap}
              showButtons={false}
            >
              {originalContent}
            </ComputerCodeBlock>
          )}
        </div>
        <div
          id={panelId("modified")}
          role="tabpanel"
          aria-labelledby={tabId("modified")}
          tabIndex={0}
          hidden={viewMode !== "modified"}
          className={viewMode === "modified" ? "h-full" : "hidden"}
        >
          {viewMode === "modified" && (
            <ComputerCodeBlock
              language={language}
              wrap={wrap}
              showButtons={false}
            >
              {modifiedContent}
            </ComputerCodeBlock>
          )}
        </div>
      </div>
    </div>
  );
};

export default DiffView;
