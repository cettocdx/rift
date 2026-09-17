export type TaskPreset = {
  id: string;
  label: string;
  detail: string;
  prompt: string;
};

const task = (
  id: string,
  label: string,
  detail: string,
  prompt: string,
): TaskPreset => ({ id, label, detail, prompt });

// Capability catalog for the terminal sidebar. A click prepares the command
// instead of firing it immediately: several assessments need a CVE, service,
// role, or attached evidence that cannot be safely guessed for the operator.
export const HACK_TASK_GROUPS: { title: string; ops: TaskPreset[] }[] = [
  {
    title: "DISCOVER",
    ops: [
      task(
        "recon",
        "Full target recon",
        "Map the public attack surface",
        "Map the full authorized attack surface of {target}. Enumerate assets, probe live hosts, fingerprint services, and summarize the highest-signal next steps.",
      ),
      task(
        "osint",
        "Passive OSINT",
        "Public intelligence only",
        "Collect passive OSINT for {target} using public sources only. Correlate DNS, registration, code, document, and exposure signals without active scanning.",
      ),
      task(
        "subdomains",
        "Subdomain discovery",
        "Enumerate and resolve hosts",
        "Enumerate subdomains for {target}, resolve them, probe which hosts are live, and flag unusual or exposed assets.",
      ),
      task(
        "dns-enum",
        "DNS enumeration",
        "Records, zones, mail and nameservers",
        "Audit DNS for {target}: enumerate records, nameservers, mail configuration, dangling records, transfer exposure, and takeover candidates.",
      ),
      task(
        "http-probe",
        "Live HTTP probing",
        "Status, titles and redirects",
        "Probe the authorized hosts for {target} over HTTP and HTTPS. Capture status, title, redirect chain, server headers, and reachable web services.",
      ),
      task(
        "tech-fingerprint",
        "Technology fingerprint",
        "Frameworks, servers and versions",
        "Fingerprint the technology stack for {target}, including servers, frameworks, CMS, libraries, versions, CDN, and hosting signals.",
      ),
      task(
        "waf-detect",
        "WAF detection",
        "Identify filtering and edge controls",
        "Detect WAF, CDN, bot protection, and reverse-proxy controls in front of {target}. Record evidence and likely testing constraints.",
      ),
      task(
        "content-discovery",
        "Content discovery",
        "Directories, files and backups",
        "Perform scoped content discovery on {target}. Look for hidden paths, backups, admin surfaces, exposed configuration, and high-value files with conservative rate limits.",
      ),
      task(
        "endpoint-crawl",
        "Endpoint crawling",
        "Routes, forms and parameters",
        "Crawl {target} and build an endpoint inventory with methods, forms, parameters, scripts, and API references. Deduplicate and prioritize attack surface.",
      ),
      task(
        "visual-recon",
        "Visual recon",
        "Screenshot reachable applications",
        "Create a visual reconnaissance pass for reachable web applications under {target}. Group screenshots by host and highlight unusual login, admin, or error surfaces.",
      ),
    ],
  },
  {
    title: "SCAN",
    ops: [
      task(
        "network-scan",
        "Port & service scan",
        "Ports, banners and versions",
        "Run authorized port and service discovery against {target}. Identify exposed ports, banners, versions, and immediately relevant follow-up checks.",
      ),
      task(
        "quick-health",
        "Quick health check",
        "Fast high-signal baseline",
        "Run a fast security health check for {target}: common ports, HTTP headers, TLS, exposed files, and high-confidence vulnerability templates.",
      ),
      task(
        "deep-audit",
        "Deep security audit",
        "Broad multi-tool assessment",
        "Perform a thorough authorized security audit of {target}. Build a plan, run complementary tools, validate signals, and preserve evidence for the final report.",
      ),
      task(
        "nuclei",
        "Nuclei template scan",
        "Template-based vulnerability checks",
        "Run an appropriately scoped nuclei scan against {target}. Triage results by severity, confidence, exploitability, and false-positive risk.",
      ),
      task(
        "cve-scan",
        "CVE exposure scan",
        "Match versions to known flaws",
        "Identify software versions exposed by {target}, research applicable CVEs, and safely validate the highest-confidence matches.",
      ),
      task(
        "tls-audit",
        "TLS & certificate audit",
        "Protocols, ciphers and trust chain",
        "Audit TLS for {target}: protocols, ciphers, certificate chain, hostname coverage, expiry, HSTS, and downgrade or trust issues.",
      ),
      task(
        "web-vulns",
        "OWASP web assessment",
        "Top 10 and application controls",
        "Assess the web application at {target} against the OWASP Top 10. Use evidence-backed checks and report severity, affected route, proof, and remediation.",
      ),
      task(
        "cms-scan",
        "CMS security scan",
        "WordPress and common platforms",
        "Detect any CMS on {target} and assess its core, themes, plugins, users, configuration, and known vulnerability exposure.",
      ),
      task(
        "api-audit",
        "API & GraphQL audit",
        "Schema, routes and authorization",
        "Assess APIs exposed by {target}. Discover routes or schema, inspect authentication, authorization, input handling, rate limits, and sensitive data exposure.",
      ),
      task(
        "secret-scan",
        "Secret scanning",
        "Keys, tokens and credentials",
        "Scan the authorized target and attached project evidence for exposed secrets, tokens, private keys, credentials, and sensitive configuration. Redact values in the summary.",
      ),
      task(
        "dependency-scan",
        "Dependency & container scan",
        "Packages, images and SBOM risk",
        "Audit attached source, manifests, lockfiles, images, or SBOM evidence for vulnerable dependencies, risky base images, and actionable upgrade paths.",
      ),
      task(
        "compliance-check",
        "CIS / PCI checks",
        "Control-oriented baseline",
        "Run an evidence-based CIS or PCI-DSS oriented check for {target} where applicable. Clearly separate verified controls, gaps, and items that require manual evidence.",
      ),
    ],
  },
  {
    title: "VALIDATE",
    ops: [
      task(
        "sql-injection",
        "SQL injection",
        "Parameters and database behavior",
        "Safely test the authorized application at {target} for SQL injection. Start non-destructively, validate only credible signals, and capture minimal reproducible evidence.",
      ),
      task(
        "xss",
        "Cross-site scripting",
        "Reflected, stored and DOM sinks",
        "Assess {target} for reflected, stored, and DOM-based XSS. Identify source-to-sink paths and validate impact with a harmless proof.",
      ),
      task(
        "ssrf",
        "SSRF & OOB validation",
        "Server-side fetch behavior",
        "Assess {target} for SSRF using safe endpoints and out-of-band validation where available. Avoid access to unrelated internal systems and record exact evidence.",
      ),
      task(
        "command-injection",
        "Command injection",
        "Shell metacharacters and execution",
        "Safely assess {target} for command injection. Use non-destructive timing or marker proofs and stop after impact is established.",
      ),
      task(
        "auth-bypass",
        "Authentication bypass",
        "Login and recovery controls",
        "Review authentication on {target} for bypass, weak recovery, enumeration, MFA gaps, and session transition flaws. Validate safely with authorized test accounts.",
      ),
      task(
        "access-control",
        "IDOR & access control",
        "Object and role boundaries",
        "Assess object-level and function-level authorization on {target}. Compare authorized roles, identify boundary failures, and preserve reproducible request evidence.",
      ),
      task(
        "jwt-session",
        "JWT & session security",
        "Tokens, cookies and lifecycle",
        "Audit JWT and session handling on {target}: algorithms, claims, rotation, fixation, cookie flags, logout, expiry, and privilege transitions.",
      ),
      task(
        "file-upload",
        "File upload testing",
        "Type, storage and execution controls",
        "Assess file-upload surfaces on {target} using harmless test files. Validate type checks, storage isolation, retrieval behavior, metadata, and execution risk.",
      ),
      task(
        "path-traversal",
        "Path traversal",
        "File read and path normalization",
        "Safely test {target} for path traversal and local file inclusion. Use minimal non-sensitive proof and document normalization or encoding bypasses.",
      ),
      task(
        "cred-test",
        "Credential testing",
        "Lockout-aware authentication checks",
        "Plan and run a tightly rate-limited credential audit for the authorized service on {target}. First identify the service and lockout policy; stop on signs of disruption.",
      ),
      task(
        "hash-audit",
        "Password hash audit",
        "Strength and cracking resistance",
        "Analyze attached authorized password hashes, identify formats, assess policy strength, and run a bounded audit that reports rates and remediation without exposing recovered secrets.",
      ),
      task(
        "exploit",
        "PoC validation",
        "Safe proof of impact",
        "Build a safe, minimal proof of concept for [finding or CVE] on {target}. Confirm prerequisites, avoid persistence or damage, and stop once impact is demonstrated.",
      ),
    ],
  },
  {
    title: "PLATFORM",
    ops: [
      task(
        "smb-enum",
        "SMB / Windows enum",
        "Shares, services and policy",
        "Enumerate the authorized Windows or SMB surface at {target}. Review dialects, signing, shares, users, services, and exposure without modifying the host.",
      ),
      task(
        "ad-mapping",
        "Active Directory mapping",
        "Relationships and privilege paths",
        "Map the authorized Active Directory evidence for {target}. Enumerate identities, trusts, groups, delegation, and likely privilege paths using available access only.",
      ),
      task(
        "kerberos",
        "Kerberos & AD CS",
        "Tickets and certificate services",
        "Assess authorized Kerberos and AD CS evidence for {target}. Check configuration and attack paths conservatively and document prerequisites before validation.",
      ),
      task(
        "cloud-posture",
        "Cloud posture review",
        "AWS, Azure or GCP configuration",
        "Review the authorized cloud configuration or attached evidence for {target}. Identify identity, network, storage, logging, and public-exposure risks with provider-specific remediation.",
      ),
      task(
        "mobile-assessment",
        "Mobile app assessment",
        "Static and dynamic application review",
        "Assess the attached authorized mobile application for insecure storage, transport, secrets, exported components, WebViews, and runtime weaknesses. Separate static and dynamic evidence.",
      ),
    ],
  },
  {
    title: "ANALYZE",
    ops: [
      task(
        "explain-cve",
        "Explain a CVE",
        "Impact, versions and safe checks",
        "Explain [CVE-ID]: root cause, affected versions, real impact, detection, safe validation steps, and remediation. Cite authoritative security sources.",
      ),
      task(
        "vuln-triage",
        "Triage findings",
        "Confidence, severity and priority",
        "Triage all findings and attached scan output in this session. Remove duplicates, challenge false positives, rate severity and confidence, and prioritize remediation.",
      ),
      task(
        "attack-path",
        "Attack-path analysis",
        "Connect findings into scenarios",
        "Analyze the verified findings for {target} as connected attack paths. State prerequisites, blast radius, detection opportunities, and the shortest remediation breakpoints.",
      ),
      task(
        "threat-intel",
        "Threat intelligence",
        "CVE, IOC and campaign context",
        "Research the supplied CVE, IOC, technology, or threat signal for {target}. Correlate authoritative sources, recency, exploitation status, and defensive actions.",
      ),
      task(
        "file-forensics",
        "File & malware forensics",
        "Static evidence review",
        "Analyze the attached authorized files as potentially hostile evidence. Work in isolation, extract metadata and indicators, avoid execution unless explicitly needed, and summarize confidence.",
      ),
    ],
  },
  {
    title: "DELIVER",
    ops: [
      task(
        "evidence-bundle",
        "Evidence bundle",
        "Organize commands and proof",
        "Compile the verified evidence from this session into a clean bundle: command, timestamp, target, raw proof, interpretation, and finding linkage.",
      ),
      task(
        "report",
        "Technical pentest report",
        "Full findings and remediation",
        "Generate a professional penetration-test report from this session with scope, methodology, executive summary, verified findings, evidence, risk ratings, and prioritized remediation.",
      ),
      task(
        "executive-summary",
        "Executive summary",
        "Concise business risk narrative",
        "Write a concise executive summary for the assessment of {target}. Explain business impact, overall posture, top risks, and the first remediation decisions without tool jargon.",
      ),
      task(
        "remediation-plan",
        "Remediation plan",
        "Prioritized ownership and effort",
        "Turn the verified findings for {target} into a prioritized remediation plan with owners, effort, dependencies, compensating controls, and measurable acceptance criteria.",
      ),
      task(
        "remediation-retest",
        "Remediation retest",
        "Verify fixes and residual risk",
        "Retest the previously verified findings for {target}. Reproduce the original checks safely, mark fixed or remaining, capture new evidence, and state residual risk.",
      ),
      task(
        "phishing",
        "Phishing simulation",
        "Authorized awareness exercise",
        "Design an authorized phishing simulation for [organization] and [target role]. Include objectives, safe pretext, landing concept, guardrails, telemetry, and awareness follow-up.",
      ),
    ],
  },
];

export const HACK_TASKS = HACK_TASK_GROUPS.flatMap((group) => group.ops);
