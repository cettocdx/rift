import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";

/**
 * A real reconnaissance pass, for the landing page's Workbench frame.
 *
 * The scan in that frame was prepared: a fixed list of lines replayed on a
 * timer. This runs the real thing — DNS resolution, TCP connects, a TLS
 * certificate inspection and an HTTP header review — so the addresses, the
 * banners, the certificate dates and the findings on the marketing page are
 * the ones that were true when the visitor pressed the button.
 *
 * ── Why this is safe to expose to anonymous visitors ──
 *
 * The target is a constant in this file and there is no parameter anywhere in
 * the call chain that can change it. `scanme.nmap.org` is the host the Nmap
 * project runs specifically to be scanned; permission to scan it is published
 * by its operator, which is the only reason a public button may start one at
 * all. Pointing this at anything else would be unauthorised scanning of a
 * third party from our address, so the target is not configurable, not
 * overridable by environment, and not accepted from the request body.
 *
 * Every technique used here is passive or connect-only: a DNS lookup, a TCP
 * handshake, a TLS handshake, and one HTTP HEAD. No packet crafting, no raw
 * sockets, no payloads, nothing that needs privilege and nothing that could
 * damage the host. It is the honest subset of an assessment that a Node
 * process can actually perform, and the findings are derived from what came
 * back rather than asserted in advance — if the operator patches the host, the
 * output on this page changes with it.
 */

/** Not configurable. See the note above. */
export const PROBE_HOST = "scanme.nmap.org";

/**
 * The ports Nmap's own documentation says are open on this host. Four
 * connects, not a sweep: the point is to show real results, and a port range
 * driven from a web request is both slow and a much worse thing to have on a
 * public endpoint.
 */
const PROBE_PORTS = [
  { port: 22, service: "ssh" },
  { port: 80, service: "http" },
  { port: 443, service: "https" },
  { port: 9929, service: "nping-echo" },
] as const;

/**
 * The headers a reviewer looks for first, and what their absence means.
 *
 * Reported as findings only when actually missing from the response, so this
 * list is a checklist rather than a claim.
 */
const SECURITY_HEADERS = [
  {
    header: "strict-transport-security",
    missing: "no HSTS · downgrade to plaintext not prevented",
  },
  {
    header: "content-security-policy",
    missing: "no CSP · no defence-in-depth against injected script",
  },
  {
    header: "x-content-type-options",
    missing: "no nosniff · MIME confusion possible",
  },
  { header: "x-frame-options", missing: "no frame policy · clickjacking" },
] as const;

const CONNECT_TIMEOUT_MS = 2500;
const TLS_TIMEOUT_MS = 4000;
const HTTP_TIMEOUT_MS = 4000;

export type ProbeLine = {
  text: string;
  /** Milliseconds from the start of the probe, so the frame can pace itself. */
  at: number;
};

export type ProbeFinding = {
  title: string;
  detail: string;
};

export type ProbeResult = {
  host: string;
  lines: ProbeLine[];
  findings: ProbeFinding[];
  openPorts: number[];
  /** Total wall time, milliseconds. */
  elapsed: number;
};

/** One TCP connect. Resolves to the time taken, or null if it did not open. */
function connect(host: string, port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once("connect", () => finish(Date.now() - started));
    socket.once("timeout", () => finish(null));
    socket.once("error", () => finish(null));
    socket.connect(port, host);
  });
}

type CertificateSummary = {
  issuer: string;
  validTo: string;
  daysLeft: number;
  altNames: string;
};

/**
 * The certificate the host presents on 443.
 *
 * `rejectUnauthorized: false` so an expired or mismatched certificate is
 * *reported* rather than throwing — that is the finding, and refusing to look
 * at it is the one thing an assessment must not do.
 */
function inspectCertificate(host: string): Promise<CertificateSummary | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: CertificateSummary | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    const socket = tls.connect(
      {
        host,
        port: 443,
        servername: host,
        rejectUnauthorized: false,
        timeout: TLS_TIMEOUT_MS,
      },
      () => {
        const cert = socket.getPeerCertificate();
        if (!cert || !cert.valid_to) return finish(null);
        const expires = new Date(cert.valid_to);
        // Node types these as `string | string[]` because a DN may repeat an
        // attribute; take the first when it does rather than rendering
        // "Let's Encrypt,ISRG" into the panel.
        const first = (value: string | string[] | undefined) =>
          Array.isArray(value) ? value[0] : value;
        finish({
          issuer:
            first(cert.issuer?.O) || first(cert.issuer?.CN) || "unknown",
          validTo: cert.valid_to,
          daysLeft: Math.round(
            (expires.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
          ),
          altNames: cert.subjectaltname || "",
        });
      },
    );

    socket.once("timeout", () => finish(null));
    socket.once("error", () => finish(null));
  });
}

type HttpSummary = {
  status: number;
  server: string | null;
  poweredBy: string | null;
  missing: string[];
};

async function inspectHttp(host: string): Promise<HttpSummary | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(`http://${host}/`, {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "RIFT-landing-probe/1.0 (+https://riftsys.app)" },
    });
    return {
      status: response.status,
      server: response.headers.get("server"),
      poweredBy: response.headers.get("x-powered-by"),
      missing: SECURITY_HEADERS.filter(
        (entry) => !response.headers.get(entry.header),
      ).map((entry) => entry.missing),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function runDemoProbe(): Promise<ProbeResult> {
  const started = Date.now();
  const lines: ProbeLine[] = [];
  const findings: ProbeFinding[] = [];
  const push = (text: string) => lines.push({ text, at: Date.now() - started });

  push(`scope declared · ${PROBE_HOST} · authorised by operator`);

  /* ── Resolve ── */
  const [v4, v6] = await Promise.all([
    dns.resolve4(PROBE_HOST).catch(() => [] as string[]),
    dns.resolve6(PROBE_HOST).catch(() => [] as string[]),
  ]);
  if (v4.length) push(`A ${v4.join(", ")}`);
  if (v6.length) push(`AAAA ${v6.join(", ")}`);
  if (!v4.length && !v6.length) push("dns · no address records returned");

  /* ── Connect ── */
  // Concurrently, because four sequential 2.5s timeouts is ten seconds of a
  // visitor watching nothing happen.
  const results = await Promise.all(
    PROBE_PORTS.map(async (entry) => ({
      ...entry,
      ms: await connect(PROBE_HOST, entry.port),
    })),
  );

  const openPorts: number[] = [];
  for (const result of results) {
    if (result.ms === null) {
      push(`${result.port}/tcp filtered ${result.service}`);
      continue;
    }
    openPorts.push(result.port);
    push(`${result.port}/tcp open ${result.service} · ${result.ms}ms`);
  }

  /* ── Inspect ── */
  const [certificate, http] = await Promise.all([
    openPorts.includes(443) ? inspectCertificate(PROBE_HOST) : null,
    openPorts.includes(80) ? inspectHttp(PROBE_HOST) : null,
  ]);

  if (certificate) {
    push(`tls · issued by ${certificate.issuer}`);
    push(
      `tls · expires ${certificate.validTo} · ${certificate.daysLeft} days left`,
    );
    if (certificate.daysLeft < 30) {
      findings.push({
        title:
          certificate.daysLeft < 0
            ? "Certificate expired"
            : "Certificate expires soon",
        detail: `${certificate.daysLeft} days · issued by ${certificate.issuer}`,
      });
    }
  }

  if (http) {
    push(`http · ${http.status} ${http.server ?? "no Server header"}`);
    if (http.server) {
      findings.push({
        title: "Service version disclosed",
        detail: `Server: ${http.server}`,
      });
    }
    if (http.poweredBy) {
      findings.push({
        title: "Stack disclosed",
        detail: `X-Powered-By: ${http.poweredBy}`,
      });
    }
    for (const missing of http.missing) {
      push(`header · ${missing}`);
      findings.push({ title: "Missing security header", detail: missing });
    }
  }

  push(
    `${openPorts.length} of ${PROBE_PORTS.length} ports reachable · ${findings.length} findings`,
  );

  return {
    host: PROBE_HOST,
    lines,
    findings,
    openPorts,
    elapsed: Date.now() - started,
  };
}
