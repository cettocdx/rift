"use client";

import { type CSSProperties } from "react";

import { Reveal, Section } from "./Reveal";
import { LiveWorkbench } from "./LiveWorkbench";

/**
 * The Hack Workbench, at length.
 *
 * Every tool named here is one the sandbox actually preinstalls, and the flow
 * described is the one the product enforces — scope is declared before anything
 * runs, and the session tracks evidence rather than chat. An offensive
 * toolchain is the one part of a product where vague marketing copy is
 * genuinely dangerous: a reader has to be able to tell exactly what it will do
 * on their behalf before they point it at a host.
 */

/**
 * The five things the Workbench does, each carrying a piece of its own output.
 *
 * Words alone described a process the reader has no way to check. A scope line,
 * a plan row, a container banner, a verification count and a report hash are
 * all things the session actually produces — so the card demonstrates the step
 * while it explains it, the way every explanation card on axiom.co does.
 */
const FLOW = [
  {
    step: "01",
    title: "Scope, before anything else",
    body: "The session opens on a target field, not a prompt. Until an authorised scope is declared there is nothing to run against — and the scope stays pinned in the header for the rest of the session, so nothing drifts onto a host you did not name.",
    artifact: "scope" as const,
  },
  {
    step: "02",
    title: "The agent plans the assessment",
    body: "It picks the phase — discover, enumerate, assess — and the tools that phase calls for, then tells you what it intends to run before it runs it.",
    artifact: "plan" as const,
  },
  {
    step: "03",
    title: "Tools run in an isolated container",
    body: "Not on your machine. The whole toolchain lives in the sandbox, so a scanner that misbehaves takes the container with it and nothing else.",
    artifact: "container" as const,
  },
  {
    step: "04",
    title: "Findings get verified, not just reported",
    body: "Raw scanner output is noisy and wrong often enough to be useless on its own. Findings stay pending until they are corroborated, and severity is only assigned after that.",
    artifact: "verify" as const,
  },
  {
    step: "05",
    title: "Evidence becomes a report",
    body: "Hashes, timeline and chain-of-custody logging accumulate as it works, then export as a written report rather than a scrollback you have to reread.",
    artifact: "report" as const,
  },
];

/** The fragment of real output inside a flow card. */
function FlowArtifact({ kind }: { kind: (typeof FLOW)[number]["artifact"] }) {
  const shell =
    "block rounded-[6px] border border-border bg-background/60 px-2.5 py-2 font-mono text-[11.5px] leading-[1.7] text-foreground/60";

  if (kind === "scope") {
    return (
      <span className={shell}>
        <span className="text-foreground/25">scope </span>
        <span className="text-foreground">scanme.nmap.org</span>
        <span className="text-foreground/35"> · authorised</span>
      </span>
    );
  }

  if (kind === "plan") {
    return (
      <span className={shell}>
        <span className="text-foreground/25">phase </span>enumerate
        <br />
        <span className="text-foreground/25">will run </span>
        <span className="text-foreground">nmap -sV · whatweb</span>
      </span>
    );
  }

  if (kind === "container") {
    return (
      <span className={shell}>
        <span className="text-foreground/25">container </span>
        <span className="text-foreground">isolated</span>
        <br />
        <span className="text-foreground/25">host access </span>none
      </span>
    );
  }

  if (kind === "verify") {
    return (
      <span className={shell}>
        <span className="text-foreground">2 verified</span>
        <span className="text-foreground/35">
          {" "}
          · 3 discarded · unreproducible
        </span>
      </span>
    );
  }

  return (
    <span className={shell}>
      <span className="text-foreground/25">sha256 </span>7f3c9a1b4e2d8c05
      <br />
      <span className="text-foreground/25">export </span>
      <span className="text-foreground">report.md</span>
    </span>
  );
}

const PANELS = [
  {
    name: "Attack surface",
    body: "Hosts, services and endpoints as they are discovered, with the resolved IP and the phase the run is in.",
  },
  {
    name: "Verified risk",
    body: "Findings split by severity — critical, high, medium, low — and an overall posture that stays pending until evidence lands.",
  },
  {
    name: "Agent session",
    body: "Task budget, model, mode, runtime and how many lines of evidence have been collected so far.",
  },
];

const TOOLCHAIN = [
  {
    group: "Recon & discovery",
    tools:
      "nmap · naabu · masscan · httpx · dnsx · subfinder · amass · arp-scan · gospider · katana",
  },
  {
    group: "Web testing",
    tools:
      "ffuf · feroxbuster · dirsearch · arjun · nikto · whatweb · wpscan · wapiti · wafw00f",
  },
  {
    group: "Injection & exploitation",
    tools:
      "sqlmap · dalfox · metasploit-framework · searchsploit · pwntools · msfvenom",
  },
  {
    group: "Credentials & cracking",
    tools: "hydra · hashcat · john · hashid · cewl · SecLists",
  },
  {
    group: "Active Directory & Windows",
    tools:
      "BloodHound · impacket-suite · netexec · Rubeus · Mimikatz · certipy-ad · evil-winrm · responder",
  },
  {
    group: "Cloud & container",
    tools:
      "Pacu · ScoutSuite · prowler · cloudsploit · trivy · awscli · az · gcloud",
  },
  {
    group: "API & GraphQL",
    tools:
      "burpsuite · zaproxy · wfuzz · apifuzzer · graphql-cop · graphql-introspection · swagger-codegen",
  },
  {
    group: "Mobile",
    tools: "MobSF · Frida · objection · apktool · drozer · adb",
  },
  {
    group: "OSINT & threat intel",
    tools:
      "theHarvester · sherlock · maigret · holehe · recon-ng · Shodan · VirusTotal · AbuseIPDB",
  },
  {
    group: "Secrets, forensics & evidence",
    tools:
      "trufflehog · gitdumper · binwalk · foremost · exiftool · EyeWitness · sha256 chain-of-custody",
  },
  {
    group: "Vulnerability intelligence",
    tools:
      "nuclei · vulnx · cvemap · Exploit-DB · NVD API · MITRE ATT&CK mapping",
  },
  {
    group: "Reporting",
    tools: "reportlab · python-docx · openpyxl · pandoc · timeline generation",
  },
];

/**
 * One ground for the whole page.
 *
 * This section used to invert to true white — a deliberate attention device,
 * and the strongest one available without motion. It is gone because none of
 * the pages this product is measured against does it: Axiom, Linear, Cursor and
 * v0 hold a single ground from the masthead to the footer and let type and
 * space carry the hierarchy. Flipping the ground once is a stronger signal than
 * anything on the page deserves, and it stops the page reading as one surface.
 *
 * The tokens stay declared rather than deleted so the section still owns its
 * own contrast, one step above the page black. That is how the reader knows
 * where they are without the page changing colour underneath them.
 */
const LAB = {
  "--background": "#050505",
  "--surface": "#0d0d0d",
  "--border": "#171717",
  "--border-strong": "#242424",
} as CSSProperties;

export function HackWorkbenchSection() {
  return (
    <div style={LAB} className="relative bg-background text-foreground">
      <Section
        id="workbench"
        eyebrow="Hack Workbench"
        title="A security lab that runs the tools, not just names them."
        lede="87 tools across 25 categories, preinstalled in an isolated container and driven by an agent that has to declare its scope before it touches anything. Recon, enumeration, exploitation, verification and the written report happen in one session."
      >
        {/* The Workbench itself, as its own instance.
 
          This section described an assessment in five cards and never ran one.
          A reader deciding whether to point an offensive toolchain at a host of
          theirs needs to see the thing operate — scope declared first, then the
          scan, then the findings — not five paragraphs asserting that it does.
          "Run again" restarts it as many times as they want.
 
          Its own instance rather than a link up to the hero frame: sending a
          reader back to the top of the page to see the section they are
          currently reading is not a design, it is an apology. */}
        <LiveWorkbench />

        <div className="mt-14 grid gap-px overflow-hidden rounded-[12px] border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {FLOW.map((item, index) => (
            <Reveal key={item.step} delay={index * 0.05}>
              <div className="flex h-full flex-col bg-background p-7">
                <span className="text-[11px] font-medium tracking-[0.08em] text-[var(--cursor-text-secondary)]">
                  {item.step}
                </span>
                <h3 className="mt-3 text-[15px] font-medium tracking-[-0.01em] text-foreground">
                  {item.title}
                </h3>
                <p className="mt-2.5 text-[13px] leading-[1.62] text-[var(--cursor-text-secondary)]">
                  {item.body}
                </p>
                {/* The step's own output, so the card shows what it describes. */}
                <span className="mt-auto block pt-5">
                  <FlowArtifact kind={item.artifact} />
                </span>
              </div>
            </Reveal>
          ))}
          {/* The grid is 5 across 6 cells at three columns; the last cell carries
            the constraint rather than sitting empty. */}
          <Reveal delay={0.3}>
            <div className="h-full bg-[var(--surface,#0c0c0c)] p-7">
              <h3 className="text-[15px] font-medium tracking-[-0.01em] text-foreground">
                Authorised targets only
              </h3>
              <p className="mt-2.5 text-[13px] leading-[1.62] text-[var(--cursor-text-secondary)]">
                For systems you own or have written permission to test. The
                scope gate is the product asking you to mean it — everything
                after that is logged against the target you named.
              </p>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.08}>
          <h3 className="mt-16 text-[13px] font-medium uppercase tracking-[0.12em] text-[var(--cursor-text-secondary)]">
            What the session tracks
          </h3>
        </Reveal>
        <div className="mt-6 grid gap-x-10 gap-y-7 sm:grid-cols-3">
          {PANELS.map((panel, index) => (
            <Reveal key={panel.name} delay={index * 0.06}>
              <div className="border-t border-border-strong pt-4">
                <h4 className="text-[13px] font-medium text-foreground">
                  {panel.name}
                </h4>
                <p className="mt-2 text-[13px] leading-[1.6] text-[var(--cursor-text-secondary)]">
                  {panel.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.08}>
          <h3 className="mt-16 text-[13px] font-medium uppercase tracking-[0.12em] text-[var(--cursor-text-secondary)]">
            The toolchain
          </h3>
        </Reveal>
        <div className="mt-6 divide-y divide-border border-y border-border">
          {TOOLCHAIN.map((row, index) => (
            <Reveal key={row.group} delay={Math.min(index * 0.03, 0.24)}>
              <div className="grid gap-1 py-4 sm:grid-cols-[220px_1fr] sm:gap-6">
                <h4 className="text-[13.5px] font-medium text-foreground">
                  {row.group}
                </h4>
                {/* Monospace because these are commands the reader will recognise
                  by shape before they finish reading the word. */}
                <p className="font-mono text-[12.5px] leading-[1.75] text-[var(--cursor-text-secondary)]">
                  {row.tools}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>
    </div>
  );
}
