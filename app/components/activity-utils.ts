import {
  isSidebarFile,
  isSidebarTerminal,
  isSidebarProxy,
  isSidebarWebSearch,
  isSidebarNotes,
  isSidebarSharedFiles,
  type SidebarContent,
} from "@/types/chat";

/**
 * Engagement phases for the Activity Timeline. Ordered by typical pentest flow.
 */
export type ActivityPhase =
  | "recon"
  | "scanning"
  | "exploitation"
  | "reporting"
  | "general";

export const PHASE_ORDER: ActivityPhase[] = [
  "recon",
  "scanning",
  "exploitation",
  "reporting",
  "general",
];

export const PHASE_META: Record<
  ActivityPhase,
  { label: string; color: string; dot: string }
> = {
  recon: {
    label: "Recon",
    color: "text-primary",
    dot: "bg-primary",
  },
  scanning: {
    label: "Scanning",
    color: "text-amber-400",
    dot: "bg-amber-400",
  },
  exploitation: {
    label: "Exploitation",
    color: "text-red-400",
    dot: "bg-red-400",
  },
  reporting: {
    label: "Reporting",
    color: "text-emerald-400",
    dot: "bg-emerald-400",
  },
  general: {
    label: "General",
    color: "text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

// Keyword buckets for terminal command classification. Order of checks in
// classifyPhase matters: exploitation > scanning > recon.
const RECON_KEYWORDS = [
  "whois",
  "dig",
  "nslookup",
  "host ",
  "subfinder",
  "amass",
  "assetfinder",
  "theharvester",
  "gobuster",
  "dirb",
  "dirbuster",
  "ffuf",
  "feroxbuster",
  "wfuzz",
  "gospider",
  "hakrawler",
  "waybackurls",
  "katana",
  "ping ",
  "traceroute",
  "curl -i",
  "curl --head",
  "enum4linux",
  "dnsrecon",
  "dnsenum",
  "fierce",
];

const SCANNING_KEYWORDS = [
  "nmap",
  "masscan",
  "rustscan",
  "nikto",
  "nuclei",
  "wpscan",
  "joomscan",
  "sslscan",
  "testssl",
  "sslyze",
  "arachni",
  "openvas",
  "zaproxy",
  "whatweb",
  "wafw00f",
];

const EXPLOIT_KEYWORDS = [
  "sqlmap",
  "msfconsole",
  "msfvenom",
  "metasploit",
  "hydra",
  "medusa",
  "patator",
  "john",
  "hashcat",
  "searchsploit",
  "ncat",
  "netcat",
  "nc -",
  "socat",
  "reverse shell",
  "/bin/sh",
  "/bin/bash -i",
  "bash -i",
  "evil-winrm",
  "crackmapexec",
  "impacket",
  "responder",
  "exploit",
  "payload",
];

const matchesAny = (haystack: string, needles: string[]): boolean =>
  needles.some((n) => haystack.includes(n));

const looksLikeReport = (path: string): boolean => {
  const lower = path.toLowerCase();
  return (
    lower.includes("report") ||
    lower.includes("finding") ||
    lower.endsWith(".md") ||
    lower.endsWith(".pdf")
  );
};

/**
 * Best-effort classification of a single tool execution into a pentest phase.
 * Heuristic only — favours usefulness over perfect accuracy.
 */
export function classifyPhase(content: SidebarContent): ActivityPhase {
  if (isSidebarNotes(content)) return "reporting";
  if (isSidebarSharedFiles(content)) return "reporting";
  if (isSidebarWebSearch(content)) return "recon";

  if (isSidebarProxy(content)) {
    const action = content.proxyAction;
    if (action === "send_request" || action === "view_request") {
      return "exploitation";
    }
    return "recon";
  }

  if (isSidebarFile(content)) {
    if (content.action === "searching") return "recon";
    if (looksLikeReport(content.path)) return "reporting";
    return "general";
  }

  if (isSidebarTerminal(content)) {
    const cmd = (content.command || "").toLowerCase();
    if (!cmd) return "general";
    if (matchesAny(cmd, EXPLOIT_KEYWORDS)) return "exploitation";
    if (matchesAny(cmd, SCANNING_KEYWORDS)) return "scanning";
    if (matchesAny(cmd, RECON_KEYWORDS)) return "recon";
    return "general";
  }

  return "general";
}

export type ActivityStatus = "running" | "error" | "done";

/**
 * Derive a coarse status for an execution. `isLastWhileStreaming` lets the
 * caller flag the final step as running while the chat is streaming.
 */
export function getActivityStatus(
  content: SidebarContent,
  isLastWhileStreaming: boolean,
): ActivityStatus {
  if (isSidebarFile(content) && content.error) return "error";
  if (isSidebarTerminal(content) && content.toolOutcome === "failed")
    return "error";

  const executing =
    (isSidebarWebSearch(content) && content.isSearching) ||
    (!isSidebarWebSearch(content) &&
      "isExecuting" in content &&
      content.isExecuting);

  if (executing || isLastWhileStreaming) return "running";
  return "done";
}
