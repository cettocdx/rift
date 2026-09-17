import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { Download, Copy, Check } from "lucide-react";
import { downloadFile } from "@/lib/utils/file-download";

function extractTableData(tableEl: HTMLTableElement): string[][] {
  const rows: string[][] = [];
  for (const row of Array.from(tableEl.rows)) {
    const cells: string[] = [];
    for (const cell of Array.from(row.cells)) {
      cells.push(cell.textContent?.trim() || "");
    }
    rows.push(cells);
  }
  return rows;
}

function toCSV(data: string[][]): string {
  return data
    .map((row) =>
      row
        .map((cell) => {
          if (cell.includes(",") || cell.includes('"') || cell.includes("\n")) {
            return `"${cell.replace(/"/g, '""')}"`;
          }
          return cell;
        })
        .join(","),
    )
    .join("\n");
}

interface MarkdownTableProps {
  children?: ReactNode;
  className?: string;
  node?: unknown;
}

export function MarkdownTable({
  children,
  className,
  node: _node,
  ...props
}: MarkdownTableProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const getTableData = () => {
    const tableEl = wrapperRef.current?.querySelector("table");
    if (!tableEl) return null;
    return extractTableData(tableEl);
  };

  const handleCopy = async () => {
    const data = getTableData();
    if (!data) return;
    try {
      const tableEl = wrapperRef.current?.querySelector("table");
      const tsv = data.map((row) => row.join("\t")).join("\n");
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([tsv], { type: "text/plain" }),
          ...(tableEl
            ? {
                "text/html": new Blob([tableEl.outerHTML], {
                  type: "text/html",
                }),
              }
            : {}),
        }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback to plain text copy
      try {
        const tsv = data.map((row) => row.join("\t")).join("\n");
        await navigator.clipboard.writeText(tsv);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error("Failed to copy table:", err);
      }
    }
  };

  const handleDownload = () => {
    const data = getTableData();
    if (!data) return;
    downloadFile({
      filename: "table.csv",
      content: toCSV(data),
      mimeType: "text/csv",
    });
  };

  return (
    /* The aicss data-table frame: the toolbar band is part of a tinted frame
       and the table itself sits INSET on its own lighter card, so the data
       reads as the object and the chrome as its mat. */
    <div
      ref={wrapperRef}
      className="my-3 flex flex-col overflow-hidden rounded-lg border border-border bg-surface-2"
      data-streamdown="table-wrapper"
    >
      <div className="flex h-8 items-center justify-end gap-0.5 px-1.5">
        <button
          aria-label="Download table as CSV"
          className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none"
          onClick={handleDownload}
          title="Download as CSV"
          type="button"
        >
          <Download size={14} />
        </button>
        <button
          aria-label={copied ? "Copied table" : "Copy table"}
          className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none"
          onClick={handleCopy}
          title={copied ? "Copied!" : "Copy table"}
          type="button"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <div className="mx-1.5 mb-1.5 overflow-x-auto overscroll-y-auto rounded-md border border-border/70 bg-background">
        <table
          className={`w-full divide-y divide-border ${className || ""}`}
          data-streamdown="table"
          {...props}
        >
          {children}
        </table>
      </div>
    </div>
  );
}
