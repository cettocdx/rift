<div align="center">
  <img src="public/brand/rift-header.png" alt="RIFT — autonomous offensive intelligence" width="100%" />
</div>

<br/>

<div align="center">

[![Website](https://img.shields.io/badge/riftsys.app-live-0ea5e9?style=flat-square&labelColor=0a0f14)](https://riftsys.app)
[![Desktop](https://img.shields.io/badge/Desktop-Mac%20%26%20Windows-white?style=flat-square&labelColor=0a0f14)](https://riftsys.app/download)
[![CLI](https://img.shields.io/badge/CLI-npx%20install-6366f1?style=flat-square&labelColor=0a0f14)](#cli)
[![License](https://img.shields.io/badge/License-Apache%202.0-red?style=flat-square&labelColor=0a0f14)](LICENSE)

</div>

<br/>

RIFT is an autonomous security intelligence platform. You describe a target — RIFT plans, executes, and reports. It runs real tools inside an isolated sandbox, reasons about the output, decides what to do next, and keeps going until the job is done.

No scripts. No playbooks. No manual steps.

---

## What RIFT does

RIFT operates as an autonomous agent. Give it a target and an objective — it builds the plan, selects the tools, runs them in sequence, adapts based on what it finds, and delivers results. Every action happens inside a sandboxed environment with no trace left on your machine.

```
You:   find vulnerabilities in testphp.vulnweb.com
RIFT:  ✦ Planning next moves
       ›_ Quick port scan on testphp.vulnweb.com        Done
       ›_ Identify web technologies with whatweb         Done
       ›_ DNS resolution for the target                  Done
       ›_ WAF detection with wafw00f                     Done
       ›_ Scan alternative ports with naabu              Done
       ›_ curl -sl http://testphp.vulnweb.com 2>&1       Running...
       ›_ Vulnerability scanning with nuclei             Running...
       ›_ Exploit identified vulnerabilities             Queued
```

---

## Modes

RIFT operates in two modes depending on what you need:

|                      | **EXECUTOR** | **ASK** |
| -------------------- | ------------ | ------- |
| Runs tools           | ✓            | —       |
| Reads live output    | ✓            | —       |
| Reasons autonomously | ✓            | ✓       |
| Security knowledge   | ✓            | ✓       |
| Sandbox required     | ✓            | —       |
| Speed                | Deep         | Instant |

Switch freely mid-session. Use **ASK** to understand a CVE or review findings. Switch to **EXECUTOR** to act on them.

---

## Operations

RIFT ships with built-in operation templates for the most common security workflows — but you can describe anything in plain language.

```
Recon a target        →  Subdomains, live hosts, tech stack, WAF, open ports
Find web vulns        →  Nuclei templates + fuzzing on a scoped host
Scan a network        →  Port & service discovery across a CIDR range
Explain a CVE         →  Impact, affected versions, PoC approach, remediation
Subdomain enum        →  Passive + active enumeration, DNS resolution, screenshot
```

You're not limited to these. RIFT understands scope, objectives, and context. Describe any security operation and it adapts.

---

## Power levels

RIFT gives you control over how deep it goes.

**Recon** — Fast, quiet, read-only. Maps the surface, collects intelligence, produces a structured overview. Suitable for initial assessment and broad coverage.

**Strike** — Active probing. Sends payloads, tests inputs, fingerprints services, identifies specific weaknesses. Goes beyond surface-level enumeration.

**Dominate** — Full depth. Exploits confirmed vulnerabilities, chains findings, escalates access where possible. For authorized red-team and penetration testing engagements.

---

## Tools RIFT knows how to use

RIFT uses industry-standard tools natively. No wrappers, no abstraction layer — real tool output, parsed and acted on in real time.

<table>
<tr>
<td valign="top">

**Discovery**

- `nmap` — port scanning, service detection
- `naabu` — fast port sweeps
- `masscan` — high-speed network scanning
- `subfinder` — passive subdomain discovery
- `dnsx` — DNS resolution & brute-force
- `httpx` — HTTP probing, status, tech

</td>
<td valign="top">

**Analysis**

- `whatweb` — web technology fingerprinting
- `wafw00f` — WAF detection & bypass hints
- `nikto` — web server misconfiguration checks
- `nuclei` — template-based vulnerability scanning
- `curl` — raw HTTP request crafting

</td>
<td valign="top">

**Exploitation**

- `sqlmap` — SQL injection detection & exploitation
- `ffuf` — directory & parameter fuzzing
- `nuclei` — exploit-grade templates
- `curl` — manual payload delivery
- Custom scripts generated on-the-fly

</td>
</tr>
</table>

New tools can be added. RIFT's agent understands how to invoke arbitrary CLI tools given a description.

---

## Platforms

### Web

The fastest way to start. Open [riftsys.app](https://riftsys.app), connect a sandbox, and go. Nothing to install.

### Desktop

Native apps for Mac and Windows. Full RIFT interface, runs the cloud sandbox by default, works offline for everything except the agent.

<div align="center">

| Platform | Download                                                                               |
| -------- | -------------------------------------------------------------------------------------- |
| macOS    | [RIFT-mac.dmg](https://riftsys.app/downloads/RIFT-mac.dmg)                             |
| Windows  | [RIFT-windows-x64-setup.exe](https://riftsys.app/downloads/RIFT-windows-x64-setup.exe) |

</div>

### CLI

Run RIFT agent operations directly from your terminal. No account setup required beyond a token. The CLI connects to the same backend as the web app and streams real-time output to your terminal.

```bash
npx https://riftsys.app/downloads/rift-cli.tgz --token <your-token>
```

The token is available from your [account settings](https://riftsys.app) on any plan including free.

**Example:**

```bash
npx https://riftsys.app/downloads/rift-cli.tgz \
  --token rift_... \
  --message "run a full recon on example.com and give me a report"
```

Output streams live, the same as in the web UI — tool invocations, results, RIFT's reasoning, and the final report.

---

## Sandbox

Every RIFT agent operation runs inside an isolated environment. Your machine is never used as an execution surface.

**Cloud sandbox** — Spun up automatically. Zero configuration. RIFT provisions the environment, runs tools, tears it down. Available on all plans.

**Local sandbox** — RIFT can also execute through your machine over an encrypted relay channel. Install the CLI, connect it, and RIFT will route tool execution locally while the agent continues running in the cloud. Useful for internal networks and private targets that aren't reachable from the cloud.

```bash
# Connect local sandbox
npx https://riftsys.app/downloads/rift-cli.tgz --token <your-token>
```

Once connected, the sandbox indicator in the top-right turns green and shows **local**.

---

## What's coming

RIFT is still early. The core agent loop is solid — but the ceiling is far from here.

- **Report generation** — structured PDF/Markdown reports, CVSS scoring, remediation steps
- **Persistent projects** — ongoing engagement tracking, diff between scans, asset management
- **Team workspaces** — shared operations, collaborative review, role-based access
- **Custom tool registry** — bring your own tools, teach RIFT how to use them
- **Integrations** — Jira, Slack, DefectDojo, webhook push on findings
- **API** — programmatic access to every RIFT operation
- **Scheduled operations** — continuous monitoring, alerting on new findings
- **Memory** — RIFT remembers your targets, past findings, and preferred workflows

The more it runs, the better it gets. Every operation is an opportunity to improve the agent's decision-making, tool selection, and output quality.

---

## Pricing

RIFT uses token-based pay-as-you-go. No subscriptions, no monthly commitments.

- **Free** — 10 messages per day, cloud sandbox, all operations, all tools
- **Tokens** — buy when you need more. Tokens never expire.

| Pack    | Tokens    | Price |
| ------- | --------- | ----- |
| Starter | 150,000   | $15   |
| Plus    | 300,000   | $30   |
| Pro     | 750,000   | $75   |
| Max     | 2,000,000 | $200  |

Crypto accepted (USDC on Solana, USDT on Ethereum).

---

## Self-hosting

RIFT is open-source. You can run the full stack yourself.

### Prerequisites

You'll need accounts for the following services:

**Required:**

- [OpenRouter](https://openrouter.ai/) — AI model routing
- [OpenAI](https://platform.openai.com/) — content moderation
- [E2B](https://e2b.dev/) — cloud sandbox execution
- [Convex](https://www.convex.dev/) — database and backend
- [WorkOS](https://workos.com/) — authentication
- [Trigger.dev](https://trigger.dev/) — durable agent runtime

**Optional:**

- [Stripe](https://stripe.com/) — payments
- [Perplexity](https://perplexity.ai/) — web search
- [Jina AI](https://jina.ai/reader) — URL content retrieval
- [Upstash Redis](https://upstash.com/) — rate limiting
- [PostHog](https://posthog.com/) — analytics
- [Amazon S3](https://aws.amazon.com/s3/) — file storage

### Setup

```bash
git clone https://github.com/riftsys/rift.git
cd rift
pnpm install
pnpm run setup
pnpm run dev
```

The setup script will walk you through configuring required environment variables.

### Run the agent worker

Agent mode requires a running Trigger.dev worker:

```bash
# 1. Add TRIGGER_SECRET_KEY to .env.local
# 2. Add required env vars to your Trigger.dev project dashboard
# 3. Start the worker
npx trigger.dev@latest dev
```

Full setup documentation is in [`docs/`](docs/).

---

## Architecture

```
Browser / Desktop / CLI
        │
        ▼
   riftsys.app  (Next.js on Vercel)
        │
        ├── Convex          database, auth, billing, subscriptions
        ├── Trigger.dev     agent loop, durable task execution
        ├── E2B             cloud sandbox (tool execution)
        └── Centrifugo      real-time relay for local sandbox (wss://rt.riftsys.app)
```

---

<div align="center">
  <img src="public/brand/Rift-AppIcon-Light.svg" width="72" alt="RIFT" />
  <br/><br/>
  <strong>RIFT</strong> · <a href="https://riftsys.app">riftsys.app</a>
  <br/>
  <sub>Built to do the work. Not explain it.</sub>
  <br/><br/>

[![Website](https://img.shields.io/badge/riftsys.app-0ea5e9?style=for-the-badge&labelColor=0a0f14)](https://riftsys.app)
[![Download](https://img.shields.io/badge/Download-Desktop%20App-white?style=for-the-badge&labelColor=0a0f14)](https://riftsys.app/download)

</div>
