"use client";

function lineClass(line: string): string | undefined {
  if (/https?:\/\//.test(line)) return "text-[var(--success)]";
  if (/·|live hosts|resolved|\d+\.\d+s\s*$/.test(line))
    return "text-[var(--muted-foreground)]";
  return undefined;
}

export function FormattedTerminalOutput({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 ? "\n" : null}
          <span className={lineClass(line)}>{line}</span>
        </span>
      ))}
    </>
  );
}
