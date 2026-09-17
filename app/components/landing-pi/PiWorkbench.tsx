"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  HackWorkbenchMini,
  type MiniFinding,
} from "@/app/components/landing-v2/HackWorkbenchMini";
import {
  WORKBENCH_FINDINGS,
  WORKBENCH_LINES,
  WORKBENCH_TARGET,
} from "@/app/components/landing-v2/mini-app-surfaces";

/**
 * The Hack Workbench, running, inside a pi cell.
 *
 * The same surface and the same endpoint as the other landing uses — the
 * product's real `/hack` shell, driven by one authorised reconnaissance pass a
 * day per visitor against scanme.nmap.org. What is different here is only the
 * host: the pi grid draws its own square hairline and figure label, so this
 * hands the screen over with no frame of its own.
 *
 * Kept as a thin wrapper rather than importing LiveWorkbench directly, because
 * that component brings ProductFrame's rounded mat and caption with it, and a
 * rounded panel inside a square cell reads as two frames arguing.
 */

/** The recorded findings, reshaped to match what the probe returns. */
const RECORDED: readonly MiniFinding[] = WORKBENCH_FINDINGS.map((finding) => {
  const [title, ...rest] = finding.text.split(" — ");
  return {
    title: title.trim(),
    detail: rest.join(" — ").trim() || finding.severity,
  };
});

export function PiWorkbench() {
  const [lines, setLines] = useState<readonly string[]>(WORKBENCH_LINES);
  const [findings, setFindings] = useState<readonly MiniFinding[]>(RECORDED);
  const [recorded, setRecorded] = useState(false);
  const asked = useRef(false);

  const request = useCallback(() => {
    void fetch("/api/landing-probe", { method: "POST" })
      .then(async (response) => {
        if (response.status === 429) {
          setRecorded(true);
          return null;
        }
        return response.ok ? response.json() : null;
      })
      .then((data) => {
        if (!data?.ok || !Array.isArray(data.lines)) return;
        const text = data.lines
          .map((line: { text?: unknown }) =>
            typeof line?.text === "string" ? line.text : null,
          )
          .filter((line: string | null): line is string => Boolean(line));
        if (text.length) setLines(text);
        if (Array.isArray(data.findings)) setFindings(data.findings);
        setRecorded(false);
      })
      .catch(() => setRecorded(true));
  }, []);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    request();
  }, [request]);

  return (
    <HackWorkbenchMini
      host={WORKBENCH_TARGET}
      lines={lines}
      findings={findings}
      recorded={recorded}
    />
  );
}
