"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, TerminalSquare } from "lucide-react";

const PIXEL = "font-mono";

type Kind = "cmd" | "ok" | "warn" | "crit" | "dim";
const COLOR: Record<Kind, string> = {
  cmd: "text-[#f4efe7]",
  ok: "text-[#7fc593]",
  warn: "text-[#e3a53d]",
  crit: "text-[#f0613a]",
  dim: "text-[#8b8275]",
};

const ASK_Q = "which CVE affects nginx 1.18 here?";
const ASK_A =
  "CVE-2021-23017, a one-byte DNS resolver overflow in nginx 1.21.0 and below. Confirm a resolver directive is set, then probe with a crafted response. This is guidance only, I won't touch the host. Want the exact check?";

const AGENT_CMD = "rift assess vpn.acme.com";
type AgentLine = { kind: Kind; text: string };
const AGENT_OUT: AgentLine[] = [
  { kind: "dim", text: "planning recon, then a targeted scan" },
  { kind: "cmd", text: "nmap -sV --top-ports 100 vpn.acme.com" },
  { kind: "ok", text: "  22/tcp   ssh    OpenSSH 6.6.1p1" },
  { kind: "ok", text: "  443/tcp  https  OpenVPN 2.4.6" },
  { kind: "dim", text: "nuclei, 4,200 templates loaded" },
  { kind: "crit", text: "  CRITICAL  CVE-2023-46850 heap overflow" },
  { kind: "warn", text: "  HIGH      exposed config directory" },
  { kind: "ok", text: "  report ready, 6 findings" },
];

const ASK_POINTS = [
  "Conversational answers",
  "CVEs, payloads, methodology",
  "No execution, just guidance",
];
const AGENT_POINTS = [
  "Autonomous, runs the assessment",
  "Real tools in an isolated sandbox",
  "Recon, testing and reporting, live",
];

const blink =
  "ml-0.5 inline-block h-[1.05em] w-[7px] translate-y-[2px] animate-[cursor-blink_1.1s_step-end_infinite] align-text-bottom";

export function AskVsAgent() {
  const [askQ, setAskQ] = useState("");
  const [askA, setAskA] = useState("");
  const [agCmd, setAgCmd] = useState("");
  const [agLines, setAgLines] = useState<AgentLine[]>([]);
  const [reduced, setReduced] = useState(false);
  const agentScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number) =>
      new Promise<void>((res) => {
        const t = setTimeout(res, ms);
        timers.push(t);
      });

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Two independent loops so both panels feel alive at once. All setState
    // lives inside these async runners (never synchronously in the effect body).
    async function askLoop() {
      while (!cancelled) {
        setAskQ("");
        setAskA("");
        await wait(700);
        for (let c = 1; c <= ASK_Q.length && !cancelled; c++) {
          setAskQ(ASK_Q.slice(0, c));
          await wait(32 + Math.random() * 30);
        }
        await wait(520);
        for (let c = 1; c <= ASK_A.length && !cancelled; c++) {
          setAskA(ASK_A.slice(0, c));
          await wait(10 + Math.random() * 12);
        }
        await wait(3800);
      }
    }

    async function agentLoop() {
      while (!cancelled) {
        setAgCmd("");
        setAgLines([]);
        await wait(700);
        for (let c = 1; c <= AGENT_CMD.length && !cancelled; c++) {
          setAgCmd(AGENT_CMD.slice(0, c));
          await wait(34 + Math.random() * 30);
        }
        await wait(420);
        for (let i = 0; i < AGENT_OUT.length && !cancelled; i++) {
          await wait(340 + Math.random() * 300);
          if (cancelled) break;
          setAgLines((p) => [...p, AGENT_OUT[i]]);
        }
        await wait(3000);
      }
    }

    async function run() {
      if (prefersReduced) {
        setReduced(true);
        setAskQ(ASK_Q);
        setAskA(ASK_A);
        setAgCmd(AGENT_CMD);
        setAgLines(AGENT_OUT);
        return;
      }
      askLoop();
      agentLoop();
    }
    run();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    if (agentScrollRef.current) {
      agentScrollRef.current.scrollTop = agentScrollRef.current.scrollHeight;
    }
  }, [agLines, agCmd]);

  return (
    <div className="grid items-stretch gap-5 lg:grid-cols-[1fr_auto_1fr]">
      {/* ───────────── ASK ───────────── */}
      <div className="relative flex flex-col rounded-2xl border border-border bg-surface-1 p-6 sm:p-7">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
            <MessageSquare className="size-[18px]" strokeWidth={1.75} />
          </span>
          <div className="flex-1">
            <div
              className={`text-[15px] leading-none tracking-[0.1em] ${PIXEL}`}
            >
              ASK
            </div>
            <div className="mt-1 text-[12px] text-muted-foreground">
              It answers.
            </div>
          </div>
          <span className="rounded-full border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Free · 10 / day
          </span>
        </div>

        {/* chat mock */}
        <div className="min-h-[214px] space-y-3 rounded-xl border border-border bg-background/60 p-4">
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-surface-2 px-3.5 py-2 text-[13px] leading-relaxed text-foreground/90">
              {askQ || " "}
              {!reduced && askQ && askQ.length < ASK_Q.length && (
                <span className={`${blink} bg-muted-foreground`} />
              )}
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-[#00d3f5]/15 font-mono text-[10px] text-[#00d3f5]">
              R
            </span>
            <div className="max-w-[88%] rounded-2xl rounded-bl-sm border border-border bg-card px-3.5 py-2 text-[13px] leading-relaxed text-foreground/85">
              {askA || (askQ.length >= ASK_Q.length ? " " : "")}
              {!reduced && askA && askA.length < ASK_A.length && (
                <span className={`${blink} bg-[#00d3f5]`} />
              )}
            </div>
          </div>
        </div>

        <ul className="mt-5 space-y-2">
          {ASK_POINTS.map((p) => (
            <li
              key={p}
              className="flex items-center gap-2.5 text-[13px] text-muted-foreground"
            >
              <span className="size-1 rounded-full bg-muted-foreground/60" />
              {p}
            </li>
          ))}
        </ul>
      </div>

      {/* ───────────── VS divider ───────────── */}
      <div className="flex items-center justify-center lg:flex-col lg:gap-3">
        <span className="hidden h-full w-px bg-gradient-to-b from-transparent via-border to-transparent lg:block" />
        <span
          className={`flex size-11 shrink-0 items-center justify-center rounded-full border border-[#00d3f5]/40 bg-background text-[12px] tracking-[0.1em] text-[#00d3f5] ${PIXEL}`}
        >
          VS
        </span>
        <span className="hidden h-full w-px bg-gradient-to-b from-transparent via-border to-transparent lg:block" />
      </div>

      {/* ───────────── AGENT ───────────── */}
      <div className="relative flex flex-col overflow-hidden rounded-2xl border border-[#00d3f5]/40 bg-[#14171a] p-6 shadow-[0_0_60px_-18px_rgba(0,178,214,0.55)] sm:p-7">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#00d3f5]/60 to-transparent" />
        <div className="mb-5 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg border border-[#00d3f5]/40 bg-[#00d3f5]/10 text-[#00d3f5]">
            <TerminalSquare className="size-[18px]" strokeWidth={1.75} />
          </span>
          <div className="flex-1">
            <div
              className={`text-[15px] leading-none tracking-[0.1em] text-[#00d3f5] ${PIXEL}`}
            >
              AGENT
            </div>
            <div className="mt-1 text-[12px] text-foreground/70">
              It operates.
            </div>
          </div>
          <span className="rounded-full border border-[#00d3f5]/40 bg-[#00d3f5]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#00d3f5]">
            1 free run · then credits
          </span>
        </div>

        {/* terminal mock */}
        <div className="overflow-hidden rounded-xl border border-white/10 bg-[#1b1e23]">
          <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-3.5 py-2.5">
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="size-2.5 rounded-full bg-white/15" />
            <span className="ml-2 font-mono text-[10.5px] text-white/40">
              rift — sandbox
            </span>
          </div>
          <div
            ref={agentScrollRef}
            className="h-[214px] overflow-hidden px-4 py-3 font-mono text-[11px] leading-[1.75]"
          >
            <div className="whitespace-pre-wrap text-[#f4efe7]">
              <span className="text-[#00d3f5]">$ </span>
              {agCmd}
              {!reduced && agCmd.length < AGENT_CMD.length && (
                <span className={`${blink} bg-[#00d3f5]`} />
              )}
            </div>
            {agLines.map((ln, i) => (
              <div key={i} className={`whitespace-pre-wrap ${COLOR[ln.kind]}`}>
                {ln.kind === "cmd" ? (
                  <>
                    <span className="text-[#00d3f5]">$ </span>
                    {ln.text}
                  </>
                ) : (
                  ln.text
                )}
              </div>
            ))}
            {!reduced &&
              agCmd.length >= AGENT_CMD.length &&
              agLines.length < AGENT_OUT.length && (
                <div className="text-[#f4efe7]">
                  <span className={`${blink} bg-[#00d3f5]`} />
                </div>
              )}
          </div>
        </div>

        <ul className="mt-5 space-y-2">
          {AGENT_POINTS.map((p) => (
            <li
              key={p}
              className="flex items-center gap-2.5 text-[13px] text-foreground/80"
            >
              <span className="size-1 rounded-full bg-[#00d3f5]" />
              {p}
            </li>
          ))}
        </ul>
      </div>

      {/* ───────────── caption (full width) ───────────── */}
      <div className="lg:col-span-3">
        <p className="mx-auto mt-2 max-w-3xl text-center text-[14px] leading-relaxed text-muted-foreground sm:text-[15px]">
          <span className="text-foreground">Ask</span> tells you how.{" "}
          <span className="text-[#00d3f5]">Agent</span> does it for you —
          spinning up a sandbox and running the whole job end to end. That
          autonomous work is what your{" "}
          <span className="text-foreground">plan&apos;s credits</span> pay for.
        </p>
      </div>
    </div>
  );
}
