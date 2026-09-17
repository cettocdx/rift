// Operation definitions for the interactive Arsenal launcher. Each operation
// declares the inputs it needs (rendered by OperationLauncher) and a build()
// that turns the collected values into a tailored agent prompt. `next` lists
// follow-up operations for the chaining / operation-mode flow.

import {
  Radar,
  Globe,
  Network,
  BookOpen,
  Boxes,
  Bug,
  ShieldAlert,
  KeyRound,
  Crosshair,
  FileText,
  Search,
  Mail,
  Crosshair as TargetIcon,
  type LucideIcon,
} from "lucide-react";

export type OperationFieldType = "text" | "textarea" | "chips" | "segment";

export interface OperationOption {
  value: string;
  label: string;
}

export interface OperationField {
  id: string;
  type: OperationFieldType;
  label: string;
  placeholder?: string;
  mono?: boolean;
  required?: boolean;
  icon?: LucideIcon;
  options?: OperationOption[]; // chips | segment
  defaultValue?: string | string[];
  /** Return an error string when invalid, or null when valid. */
  validate?: (value: string) => string | null;
}

export type OperationValues = Record<string, string | string[]>;

export interface OperationDef {
  id: string;
  icon: LucideIcon;
  label: string;
  desc: string;
  /** Field id whose value is the primary target (badge + saved targets). */
  targetField?: string;
  fields: OperationField[];
  build: (v: OperationValues) => string;
  /** Suggested follow-up operation ids. */
  next?: string[];
  /** Run in ASK mode instead of AGENT (research-only ops). */
  ask?: boolean;
}

// ── loose validators (sanity only, never block a determined operator) ──
const DOMAIN_RE = /^([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/i;
const looksLikeIp = (s: string) =>
  /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(s);

export const validateTarget = (v: string): string | null => {
  const s = v.trim();
  if (!s) return "Enter a target";
  if (DOMAIN_RE.test(s) || looksLikeIp(s)) return null;
  if (/\s/.test(s)) return "No spaces in a target";
  return null; // allow hostnames / odd formats — just a hint, not a gate
};

export const validateUrl = (v: string): string | null => {
  const s = v.trim();
  if (!s) return "Enter a URL or host";
  return null;
};

export const validateCidr = (v: string): string | null => {
  const s = v.trim();
  if (!s) return "Enter an IP, host or CIDR";
  return null;
};

const str = (v: string | string[] | undefined): string =>
  Array.isArray(v) ? v.join(", ") : (v ?? "");

const list = (v: string | string[] | undefined): string[] =>
  Array.isArray(v) ? v : v ? [v] : [];

const INTENSITY: OperationField = {
  id: "intensity",
  type: "segment",
  label: "Intensity",
  options: [
    { value: "fast", label: "Fast" },
    { value: "thorough", label: "Thorough" },
  ],
  defaultValue: "fast",
};

const paceLine = (v: OperationValues) =>
  str(v.intensity) === "thorough"
    ? "Be thorough — full coverage over speed."
    : "Keep it fast — prioritise quick, high-signal results.";

export const OPERATIONS: OperationDef[] = [
  {
    id: "recon",
    icon: Radar,
    label: "Recon a target",
    desc: "Subdomains, live hosts, tech stack",
    targetField: "target",
    next: ["web-vulns", "nuclei", "subdomains"],
    fields: [
      {
        id: "target",
        type: "text",
        label: "Target",
        placeholder: "scanme.nmap.org",
        mono: true,
        required: true,
        icon: TargetIcon,
        validate: validateTarget,
      },
      {
        id: "include",
        type: "chips",
        label: "Include",
        options: [
          { value: "subdomains", label: "Subdomains" },
          { value: "live", label: "Live hosts" },
          { value: "tech", label: "Tech stack" },
          { value: "webvulns", label: "Quick web vulns" },
        ],
        defaultValue: ["subdomains", "live", "tech"],
      },
      INTENSITY,
    ],
    build: (v) => {
      const inc = list(v.include);
      const parts: string[] = [];
      if (inc.includes("subdomains")) parts.push("enumerate subdomains");
      if (inc.includes("live")) parts.push("probe for live hosts");
      if (inc.includes("tech")) parts.push("fingerprint the tech stack");
      if (inc.includes("webvulns")) parts.push("flag any obvious web vulns");
      const what = parts.length ? parts.join(", ") : "map the attack surface";
      return `Do recon on ${str(v.target)} — ${what}. ${paceLine(v)} Summarise findings clearly.`;
    },
  },
  {
    id: "web-vulns",
    icon: Globe,
    label: "Find web vulns",
    desc: "Nuclei + fuzzing on a scoped host",
    targetField: "url",
    next: ["vuln-triage", "exploit", "report"],
    fields: [
      {
        id: "url",
        type: "text",
        label: "URL / host",
        placeholder: "http://testphp.vulnweb.com",
        mono: true,
        required: true,
        icon: Globe,
        validate: validateUrl,
      },
      {
        id: "focus",
        type: "chips",
        label: "Focus",
        options: [
          { value: "owasp", label: "OWASP Top 10" },
          { value: "nuclei", label: "Nuclei templates" },
          { value: "fuzzing", label: "Content fuzzing" },
          { value: "auth", label: "Auth / access control" },
        ],
        defaultValue: ["owasp", "nuclei"],
      },
      INTENSITY,
    ],
    build: (v) => {
      const f = list(v.focus);
      const focus = f.length
        ? `Focus on ${f
            .map(
              (x) =>
                ({
                  owasp: "the OWASP Top 10",
                  nuclei: "nuclei templates",
                  fuzzing: "content/parameter fuzzing",
                  auth: "authentication and access control",
                })[x] ?? x,
            )
            .join(", ")}.`
        : "";
      return `Assess the web application at ${str(v.url)} for vulnerabilities. ${focus} ${paceLine(v)} Report findings with severity and evidence.`;
    },
  },
  {
    id: "network-scan",
    icon: Network,
    label: "Scan a network",
    desc: "Port & service discovery on CIDR",
    targetField: "cidr",
    next: ["web-vulns", "cred-test"],
    fields: [
      {
        id: "cidr",
        type: "text",
        label: "IP / host / CIDR",
        placeholder: "scanme.nmap.org or 10.0.0.0/24",
        mono: true,
        required: true,
        icon: Network,
        validate: validateCidr,
      },
      {
        id: "ports",
        type: "segment",
        label: "Ports",
        options: [
          { value: "top", label: "Top 100" },
          { value: "common", label: "Common 1k" },
          { value: "all", label: "All 65k" },
        ],
        defaultValue: "top",
      },
      INTENSITY,
    ],
    build: (v) => {
      const ports =
        {
          top: "the top 100 ports",
          common: "the top 1000 ports",
          all: "all 65535 ports",
        }[str(v.ports)] ?? "the top ports";
      return `Run port and service discovery on ${str(v.cidr)} across ${ports}. ${paceLine(v)} Summarise exposed services with versions and suggest next steps.`;
    },
  },
  {
    id: "subdomains",
    icon: Boxes,
    label: "Subdomain enum",
    desc: "Enumerate and resolve hosts",
    targetField: "domain",
    next: ["recon", "web-vulns"],
    fields: [
      {
        id: "domain",
        type: "text",
        label: "Domain",
        placeholder: "vulnweb.com",
        mono: true,
        required: true,
        icon: Boxes,
        validate: validateTarget,
      },
      INTENSITY,
    ],
    build: (v) =>
      `Enumerate subdomains for ${str(v.domain)}, resolve them, and flag any that look interesting or exposed. ${paceLine(v)}`,
  },
  {
    id: "nuclei",
    icon: Bug,
    label: "Nuclei scan",
    desc: "Template-based vuln scan",
    targetField: "target",
    next: ["vuln-triage", "report"],
    fields: [
      {
        id: "target",
        type: "text",
        label: "Target",
        placeholder: "http://testphp.vulnweb.com",
        mono: true,
        required: true,
        icon: TargetIcon,
        validate: validateUrl,
      },
      {
        id: "severity",
        type: "segment",
        label: "Min severity",
        options: [
          { value: "info", label: "Info+" },
          { value: "low", label: "Low+" },
          { value: "medium", label: "Medium+" },
          { value: "high", label: "High+" },
        ],
        defaultValue: "low",
      },
    ],
    build: (v) =>
      `Run nuclei templates against ${str(v.target)} (minimum severity: ${str(v.severity)}) and triage the results by severity and exploitability.`,
  },
  {
    id: "vuln-triage",
    icon: ShieldAlert,
    label: "Vuln triage",
    desc: "Prioritize findings",
    fields: [
      {
        id: "findings",
        type: "textarea",
        label: "Findings / scan output",
        placeholder: "Paste tool output or findings here…",
        mono: true,
        required: true,
      },
    ],
    next: ["exploit", "report"],
    build: (v) =>
      `Triage the vulnerabilities below by severity and exploitability and propose an attack path:\n\n${str(v.findings)}`,
  },
  {
    id: "cred-test",
    icon: KeyRound,
    label: "Cred testing",
    desc: "Safe brute-force plan",
    targetField: "target",
    fields: [
      {
        id: "service",
        type: "text",
        label: "Service",
        placeholder: "ssh, http-form, smb…",
        required: true,
      },
      {
        id: "target",
        type: "text",
        label: "Target",
        placeholder: "testphp.vulnweb.com",
        mono: true,
        required: true,
        icon: TargetIcon,
        validate: validateTarget,
      },
    ],
    next: ["exploit"],
    build: (v) =>
      `Suggest a safe credential-attack plan against ${str(v.service)} at ${str(v.target)} — include wordlist choice, rate-limit / lockout considerations, and how to avoid disruption.`,
  },
  {
    id: "exploit",
    icon: Crosshair,
    label: "Exploit assist",
    desc: "PoC step by step",
    targetField: "target",
    fields: [
      {
        id: "vuln",
        type: "text",
        label: "Vulnerability",
        placeholder: "CVE-2024-1234 or 'SQLi on /login'",
        required: true,
      },
      {
        id: "target",
        type: "text",
        label: "Target",
        placeholder: "http://testphp.vulnweb.com",
        mono: true,
        required: true,
        icon: TargetIcon,
      },
    ],
    next: ["report"],
    build: (v) =>
      `Help me build and validate a proof-of-concept for ${str(v.vuln)} on ${str(v.target)}, step by step. Confirm impact safely without causing damage.`,
  },
  {
    id: "osint",
    icon: Search,
    label: "OSINT recon",
    desc: "Passive intel, no active scanning",
    targetField: "target",
    next: ["recon", "phishing"],
    fields: [
      {
        id: "target",
        type: "text",
        label: "Target (org / domain / person)",
        placeholder: "vulnweb.com",
        mono: true,
        required: true,
        icon: Search,
      },
      {
        id: "sources",
        type: "chips",
        label: "Sources",
        options: [
          { value: "dns", label: "DNS / WHOIS" },
          { value: "github", label: "GitHub" },
          { value: "linkedin", label: "LinkedIn" },
          { value: "shodan", label: "Shodan" },
          { value: "docs", label: "Exposed docs" },
        ],
        defaultValue: ["dns", "github", "shodan"],
      },
    ],
    build: (v) => {
      const s = list(v.sources);
      const src = s.length ? ` Use: ${s.join(", ")}.` : "";
      return `Run passive OSINT on ${str(v.target)} — gather public intel only, no active scanning.${src} Summarise the exposed footprint.`;
    },
  },
  {
    id: "explain-cve",
    icon: BookOpen,
    label: "Explain a CVE",
    desc: "Impact and how to test for it",
    ask: true,
    fields: [
      {
        id: "cve",
        type: "text",
        label: "CVE id",
        placeholder: "CVE-2024-1234",
        mono: true,
        required: true,
        icon: BookOpen,
      },
    ],
    build: (v) =>
      `Explain ${str(v.cve)}: how it works, real-world impact, affected versions, and how to safely test for it.`,
  },
  {
    id: "phishing",
    icon: Mail,
    label: "Phishing sim",
    desc: "Pretext for awareness training",
    ask: true,
    fields: [
      {
        id: "org",
        type: "text",
        label: "Organisation",
        placeholder: "Acme Corp",
        required: true,
      },
      {
        id: "role",
        type: "text",
        label: "Target role",
        placeholder: "Finance team",
        required: true,
      },
    ],
    build: (v) =>
      `Design a phishing simulation for ${str(v.org)} targeting ${str(v.role)}. Include a pretext, landing-page concept, and detection / awareness recommendations.`,
  },
  {
    id: "report",
    icon: FileText,
    label: "Write report",
    desc: "Executive summary + remediation",
    fields: [],
    build: () =>
      `Generate a professional penetration-test report from the findings in this session — executive summary, risk ratings (CVSS), technical detail with evidence, and prioritised remediation steps.`,
  },
];

export const getOperation = (id: string): OperationDef | undefined =>
  OPERATIONS.find((o) => o.id === id);

/** The operation a chat is currently "in" (operation mode). */
export interface ActiveOperation {
  id: string;
  label: string;
  target?: string;
}
