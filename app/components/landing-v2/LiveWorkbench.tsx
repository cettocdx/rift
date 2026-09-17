"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { HackWorkbenchMini, type MiniFinding } from "./HackWorkbenchMini";
import { ProductFrame } from "./ProductFrame";
import {
  WORKBENCH_FINDINGS,
  WORKBENCH_LINES,
  WORKBENCH_TARGET,
} from "./mini-app-surfaces";

/**
 * The Hack Workbench section's frame: the real surface, driven by a real pass.
 *
 * Two things are joined here and nothing else. HackWorkbenchMini knows how the
 * product's `/hack` screen is built and nothing about where its output comes
 * from; /api/landing-probe runs one authorised reconnaissance pass a day per
 * visitor and knows nothing about how it will be drawn. This asks for the pass
 * and hands it over.
 *
 * When the day's pass is spent — or the network refuses, or the endpoint is
 * down — the recorded trace stands in and the surface says so in its own
 * console rather than in a caption underneath it. A page that promises a live
 * scan and quietly replays a recording is lying about the screen in front of
 * the reader.
 */
export function LiveWorkbench({
  /**
   * Which frame to draw, if any.
   *
   * `mat` is the default and is what /landing/v4 has always rendered. `bare`
   * exists because a host that draws its own frame ends up with two: the x
   * landing wraps this in a 16px hairline and the mat added a second one 12px
   * inside it, which ProductFrame's own notes warn about and which is plainly
   * visible on a near-black ground. The caption travels with the mat, so a
   * `bare` host is responsible for saying what the reader is looking at.
   */
  variant = "mat",
}: {
  variant?: "mat" | "bare";
} = {}) {
  const [lines, setLines] = useState<readonly string[]>(WORKBENCH_LINES);
  const [findings, setFindings] = useState<readonly MiniFinding[]>(
    WORKBENCH_FINDINGS_AS_MINI,
  );
  const [recorded, setRecorded] = useState(false);
  // A ref, not state: nothing renders from "have we asked yet", and writing
  // state inside the effect that reads it is both a re-render nobody needs and
  // the pattern this repo lints against.
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

  // Asked for once, on mount, rather than when the frame scrolls into view:
  // the pass resolves in under a second and the surface paces its own replay,
  // so having the data ready before the reader arrives costs nothing and
  // avoids the recorded trace flashing before the live one replaces it.
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    request();
  }, [request]);

  return (
    <ProductFrame
      variant={variant}
      className={variant === "bare" ? undefined : "mt-14"}
      caption={`Hack Workbench, running · target ${WORKBENCH_TARGET}`}
      note="scanme.nmap.org is Nmap’s own public test host · the addresses, ports, certificate and findings are read live, once a visitor a day"
    >
      <HackWorkbenchMini
        host={WORKBENCH_TARGET}
        lines={lines}
        findings={findings}
        recorded={recorded}
      />
    </ProductFrame>
  );
}

/**
 * The recorded findings, in the shape the live ones arrive in.
 *
 * mini-app-surfaces types these as `{severity, text}` because that is what the
 * replayed trace needed; the probe returns `{title, detail}` because a derived
 * finding has both. Rather than teach the surface two shapes, the recorded set
 * is converted once, here, at the boundary where the two meet.
 */
const WORKBENCH_FINDINGS_AS_MINI: readonly MiniFinding[] =
  WORKBENCH_FINDINGS.map((finding) => {
    const [title, ...rest] = finding.text.split(" — ");
    return {
      title: title.trim(),
      detail: rest.join(" — ").trim() || finding.severity,
    };
  });
