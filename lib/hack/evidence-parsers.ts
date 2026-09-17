import { extractFindingRecommendation } from "./finding-recommendation";
export type Port = {
  port: string;
  proto: string;
  service: string;
  sev: string;
};
export type Sev = "C" | "H" | "M" | "L";
export type Finding = {
  id: string;
  sev: Sev;
  title: string;
  evidence: string;
  rec: string;
};
const SEV_ORDER: Record<Sev, number> = { C: 0, H: 1, M: 2, L: 3 };
function recFor(title: string): string {
  const t = title.toLowerCase();
  if (/sql|sqli/.test(t))
    return "Use parameterised queries / prepared statements; validate and encode all user input before it reaches the query layer.";
  if (/xss|cross.site/.test(t))
    return "Apply context-aware output encoding and a strict Content-Security-Policy; sanitise HTML sinks.";
  if (/rce|remote code|command inj/.test(t))
    return "Eliminate shell interpolation of user input; use allow-lists and run the service with least privilege.";
  if (/ssrf/.test(t))
    return "Enforce an egress allow-list and block requests to internal/metadata ranges (169.254.0.0/16, RFC1918).";
  if (/\.git|\.env|expos|disclosure|backup|listing/.test(t))
    return "Remove the exposed artefact from the web root and rotate any leaked secrets immediately.";
  if (/cve-/.test(t))
    return "Upgrade the affected component to a patched release; track the CVE advisory for the fixed version.";
  if (/auth|login|credential|default pass|weak/.test(t))
    return "Enforce MFA, rate-limit authentication, and remove default / weak credentials.";
  if (/tls|ssl|cert|cipher/.test(t))
    return "Disable legacy protocols/ciphers; deploy a valid certificate and enable HSTS.";
  return "Validate exposure, confirm exploitability, and remediate according to the assigned severity.";
}

export function extractFindings(text: string): Finding[] {
  const res: Finding[] = [];
  const findingIndexByKey = new Map<string, number>();
  const push = (sev: Sev, title: string, evidence: string) => {
    const key = title.toLowerCase().slice(0, 40);
    if (!title) return;
    const evidencePreview = evidence.trim().slice(0, 400);
    const existingIndex = findingIndexByKey.get(key);
    if (existingIndex !== undefined) {
      const existing = res[existingIndex];
      res[existingIndex] = {
        ...existing,
        evidence:
          evidencePreview.length > existing.evidence.length
            ? evidencePreview
            : existing.evidence,
        rec: extractFindingRecommendation(evidence, existing.rec),
      };
      return;
    }
    findingIndexByKey.set(key, res.length);
    res.push({
      id: key,
      sev,
      title: title.slice(0, 72),
      evidence: evidencePreview,
      rec: extractFindingRecommendation(evidence, recFor(title)),
    });
  };
  const lines = text.split(/\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const raw = lines[lineIndex];
    const ln = raw.trim();
    if (!ln) continue;
    // nuclei text: [severity] tags
    let m = ln.match(/\[(critical|high|medium|low)\]\s*(.+)/i);
    if (m) {
      const sev = m[1][0].toUpperCase() as Sev;
      const findingLines = [ln];
      let continuationIndex = lineIndex + 1;
      while (continuationIndex < lines.length) {
        const continuation = lines[continuationIndex].trim();
        if (!continuation) {
          findingLines.push(continuation);
          continuationIndex += 1;
          continue;
        }
        if (!/^(?:cvss|evidence|remediation)\s*:/i.test(continuation)) break;
        findingLines.push(continuation);
        continuationIndex += 1;
      }
      lineIndex = continuationIndex - 1;
      push(sev, m[2].replace(/\s+/g, " ").trim(), findingLines.join("\n"));
      continue;
    }
    // nuclei JSONL: {"severity":"high",...,"template-id":"...","matched-at":"..."}
    m = ln.match(/"severity"\s*:\s*"(critical|high|medium|low)"/i);
    if (m) {
      const sev = m[1][0].toUpperCase() as Sev;
      const t = ln.match(
        /"(?:template-id|templateID|template|name|matched-at)"\s*:\s*"([^"]+)"/i,
      );
      push(sev, (t?.[1] ?? "nuclei finding").slice(0, 60), ln);
      continue;
    }
    // bare CVE references
    m = ln.match(/(CVE-\d{4}-\d{3,7})/i);
    if (m) {
      const sev: Sev = /critical/i.test(ln)
        ? "C"
        : /high/i.test(ln)
          ? "H"
          : "H";
      push(
        sev,
        m[1].toUpperCase() +
          (ln.length < 90
            ? " — " +
              ln
                .replace(m[1], "")
                .replace(/[|:•\-]/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 44)
            : ""),
        ln,
      );
      continue;
    }
    // sqlmap: "parameter 'id' is vulnerable" / "is injectable" / injection point
    m = ln.match(
      /parameter\s+'?([\w[\]-]+)'?.*(?:is vulnerable|is injectable|appears to be injectable)/i,
    );
    if (
      m ||
      /sqlmap identified the following injection point|the back-end DBMS is/i.test(
        ln,
      )
    ) {
      push("C", "SQL injection" + (m ? ` — parameter '${m[1]}'` : ""), ln);
      continue;
    }
    // dalfox: [POC]/[VULN] reflected/triggered XSS
    if (
      /\[POC\]|\[VULN\]|triggered\s+.*xss|reflected\s+.*xss|found\s+xss/i.test(
        ln,
      )
    ) {
      push("H", "Cross-site scripting (dalfox)", ln);
      continue;
    }
    // wpscan / generic scanner: "[!] Title: <vuln>"
    m = ln.match(/\[!\]\s*Title:\s*(.+)/i);
    if (m) {
      push(
        /critical/i.test(ln) ? "C" : "H",
        m[1].replace(/\s+/g, " ").trim(),
        ln,
      );
      continue;
    }
    // nikto: "+ OSVDB-####: <finding>"
    m = ln.match(/\+\s*OSVDB-\d+:\s*(.+)/i);
    if (m) {
      push("M", m[1].replace(/\s+/g, " ").trim(), ln);
      continue;
    }
    // narrative vulnerability lines (still tool stdout only)
    m = ln.match(
      /\b(SQL injection|SQLi|XSS|cross-site scripting|RCE|remote code execution|command injection|SSRF|open redirect|IDOR|path traversal|directory traversal|exposed \.git|exposed \.env|information disclosure|default credentials|weak (?:password|credential)s?|misconfigur\w+)\b/i,
    );
    if (m) {
      const sev: Sev =
        /(rce|remote code|sql inj|command inj|\.env|critical)/i.test(ln)
          ? "C"
          : /(xss|ssrf|idor|traversal|\.git|high)/i.test(ln)
            ? "H"
            : "M";
      push(sev, m[1].replace(/\s+/g, " ").trim(), ln);
    }
  }
  return res.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev]);
}

export function extractSubdomains(text: string, target: string): string[] {
  const root = (
    target.match(/([a-z0-9-]+\.[a-z]{2,})$/i)?.[1] ?? ""
  ).toLowerCase();
  if (!root) return [];
  const re = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/gi;
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const h = m[1].toLowerCase();
    if (h.endsWith("." + root) || h === root) set.add(h);
  }
  return Array.from(set).slice(0, 40);
}

export function extractEndpoints(text: string): string[] {
  const set = new Set<string>();
  const url = /\bhttps?:\/\/[^\s"'<>)\]]+/gi;
  let m: RegExpExecArray | null;
  while ((m = url.exec(text)))
    set.add(m[0].replace(/[.,)]+$/, "").slice(0, 80));
  const path =
    /(^|\s)(\/(?:api|v\d|admin|login|auth|graphql|wp-admin|\.git|\.env|dashboard|internal|debug)[^\s"'<>)\]]*)/gi;
  while ((m = path.exec(text))) set.add(m[2].slice(0, 80));
  return Array.from(set).slice(0, 40);
}

export function extractPorts(evidence: string): Port[] {
  const seen = new Set<string>();
  const res: Port[] = [];
  let m: RegExpExecArray | null;
  // nmap: "22/tcp open ssh"
  const nmapRe = /(\d{1,5})\/(tcp|udp)\s+open\s+([A-Za-z0-9_.-]+)/g;
  while ((m = nmapRe.exec(evidence))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    res.push({
      port: m[1],
      proto: m[2].toUpperCase(),
      service: m[3],
      sev: /apache|2\.4\.7|telnet|ftp|rdp|smb/i.test(m[0]) ? "c" : "h",
    });
  }
  // masscan: "Discovered open port 443/tcp on 1.2.3.4"
  const massRe = /Discovered open port (\d{1,5})\/(tcp|udp)/gi;
  while ((m = massRe.exec(evidence))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    res.push({
      port: m[1],
      proto: m[2].toUpperCase(),
      service: "—",
      sev: "h",
    });
  }
  // naabu: "host:port" one per line (only when a host with that exact port isn't already known)
  const naabuRe = /^[a-z0-9.-]+\.[a-z]{2,}:(\d{1,5})$/gim;
  while ((m = naabuRe.exec(evidence))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    res.push({ port: m[1], proto: "TCP", service: "—", sev: "h" });
  }
  return res;
}
