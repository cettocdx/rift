import { HACK_REPORT_BRAND_SVG } from "./report-brand";
import {
  canPresentCleanResult,
  type AssessmentCoverage,
} from "./report-coverage";
import type { Finding, Port, Sev } from "./evidence-parsers";
const SEV_LABEL: Record<Sev, string> = {
  C: "CRIT",
  H: "HIGH",
  M: "MED",
  L: "LOW",
};
export function renderHackReport({
  coverage,
  findings,
  ports,
  subdomains,
  endpoints,
  target,
  sevCounts,
  threat,
}: {
  coverage: AssessmentCoverage;
  findings: Finding[];
  ports: Port[];
  subdomains: string[];
  endpoints: string[];
  target: string;
  sevCounts: Record<Sev, number>;
  threat: string;
}) {
  const now = new Date();
  const esc = (s: string) =>
    s.replace(
      /[&<>]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string,
    );
  const findingRows = findings.length
    ? findings
        .map(
          (f, i) => `
        <div class="fblock ${f.sev}">
          <div class="fh"><span class="sev ${f.sev}">${SEV_LABEL[f.sev]}</span><span class="fid">F-${String(i + 1).padStart(3, "0")}</span><span class="ftitle">${esc(f.title)}</span></div>
          <div class="fmeta"><b>Evidence</b><pre>${esc(f.evidence)}</pre></div>
          <div class="fmeta"><b>Recommendation</b><p>${esc(f.rec)}</p></div>
        </div>`,
        )
        .join("")
    : `<p class="muted">No findings recorded in this session.</p>`;
  const portRows = ports.length
    ? `<table><thead><tr><th>Port</th><th>Proto</th><th>Service</th><th>Risk</th></tr></thead><tbody>${ports.map((p) => `<tr><td>${p.port}</td><td>${p.proto}</td><td>${esc(p.service)}</td><td>${p.sev === "c" ? "High" : "Info"}</td></tr>`).join("")}</tbody></table>`
    : `<p class="muted">No open services enumerated.</p>`;
  const subList = subdomains.length
    ? `<ul class="cols">${subdomains.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`
    : `<p class="muted">None discovered.</p>`;
  const epList = endpoints.length
    ? `<ul class="cols">${endpoints.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`
    : `<p class="muted">None discovered.</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>RIFT | Penetration Test Report | ${esc(target)}</title>
<style>
  @page{margin:22mm 18mm}
  *{box-sizing:border-box}
  body{font:12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;margin:0}
  .mono{font-family:"SF Mono",ui-monospace,Menlo,monospace}
  .cover{padding:60px 0 34px;border-bottom:3px solid #111;margin-bottom:28px}
  .cover .brand{line-height:0;color:#111}
  .cover .sub{color:#666;letter-spacing:.24em;font-size:11px;margin-top:8px}
  .cover h1{font-size:24px;margin:26px 0 4px}
  .cover .tgt{font-family:"SF Mono",ui-monospace,Menlo,monospace;font-size:15px;color:#000}
  .meta{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid #ddd;margin:22px 0}
  .meta div{padding:12px 14px;border-right:1px solid #eee}
  .meta div:last-child{border-right:0}
  .meta .k{font-size:9px;letter-spacing:.14em;color:#888;text-transform:uppercase}
  .meta .v{font-size:20px;font-weight:600;margin-top:4px}
  .meta .v.c{color:#c0362c}.meta .v.h{color:#c8791b}
  h2{font-size:14px;letter-spacing:.06em;border-bottom:1px solid #111;padding-bottom:6px;margin:30px 0 14px;text-transform:uppercase}
  .muted{color:#999}
  .sev{display:inline-block;font:700 9px/1.4 sans-serif;padding:3px 7px;border-radius:2px;color:#fff;letter-spacing:.06em}
  .sev.C{background:#c0362c}.sev.H{background:#c8791b}.sev.M{background:#b7a017}.sev.L{background:#5a5a5a}
  .fblock{border:1px solid #e2e2e2;border-left:4px solid #999;padding:14px 16px;margin:12px 0;break-inside:avoid}
  .fblock.C{border-left-color:#c0362c}.fblock.H{border-left-color:#c8791b}.fblock.M{border-left-color:#b7a017}.fblock.L{border-left-color:#888}
  .fh{display:flex;align-items:center;gap:10px}
  .fid{font-family:"SF Mono",ui-monospace,Menlo,monospace;color:#999;font-size:10px}
  .ftitle{font-weight:600;font-size:13px}
  .fmeta{margin-top:10px}.fmeta b{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#888;display:block;margin-bottom:4px}
  .fmeta pre{background:#f6f6f6;border:1px solid #eee;padding:9px 11px;font-family:"SF Mono",ui-monospace,Menlo,monospace;font-size:10.5px;white-space:pre-wrap;word-break:break-word;margin:0;border-radius:2px}
  .fmeta p{margin:0}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #eee}
  th{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#888;border-bottom:1px solid #ccc}
  ul.cols{columns:2;font-family:"SF Mono",ui-monospace,Menlo,monospace;font-size:11px;padding-left:16px;margin:0}
  ul.cols li{margin:2px 0}
  footer{margin-top:40px;border-top:1px solid #ddd;padding-top:12px;color:#999;font-size:10px;display:flex;justify-content:space-between}
  .exec{background:#fafafa;border:1px solid #eee;padding:16px 18px;font-size:12.5px;line-height:1.7}
</style></head><body>
  <div class="cover">
    <div class="brand">${HACK_REPORT_BRAND_SVG}</div>
    <div class="sub">OFFENSIVE SECURITY · AUTONOMOUS OPERATOR</div>
    <h1>Penetration Test Report</h1>
    <div class="tgt">${esc(target)}</div>
  </div>
  <div class="meta">
    <div><div class="k">Critical</div><div class="v c">${sevCounts.C}</div></div>
    <div><div class="k">High</div><div class="v h">${sevCounts.H}</div></div>
    <div><div class="k">Medium / Low</div><div class="v">${sevCounts.M + sevCounts.L}</div></div>
    <div><div class="k">Open Services</div><div class="v">${ports.length}</div></div>
  </div>
  <h2>Scope and Limitations</h2>
  <div class="exec">
    ${
      coverage.limitations.length > 0
        ? `<p><b>This assessment did not cover everything.</b></p><ul>${coverage.limitations
            .map((item) => `<li>${esc(item)}</li>`)
            .join("")}</ul>`
        : "<p>This assessment ran every offered phase against the declared scope, and no tool reported an error. The findings below reflect what was actually examined.</p>"
    }
    ${
      coverage.toolErrors.length > 0
        ? `<p><b>Tool errors</b></p><ul>${coverage.toolErrors
            .map(
              (item) =>
                `<li><span class="mono">${esc(item.command)}</span> — exit ${item.exitCode}</li>`,
            )
            .join("")}</ul>`
        : ""
    }
  </div>
  <h2>Executive Summary</h2>
  <div class="exec">
    RIFT captured tool evidence for the authorised target <b class="mono">${esc(target)}</b>.
    The available session evidence records <b>${findings.length}</b> finding${findings.length === 1 ? "" : "s"}
    (${sevCounts.C} critical, ${sevCounts.H} high, ${sevCounts.M} medium, ${sevCounts.L} low),
    <b>${ports.length}</b> open service${ports.length === 1 ? "" : "s"},
    <b>${subdomains.length}</b> subdomain${subdomains.length === 1 ? "" : "s"} and
    <b>${endpoints.length}</b> notable endpoint${endpoints.length === 1 ? "" : "s"}.
    Based on this recorded evidence, current threat posture is <b>${threat}</b>.
    ${
      findings.length === 0 && !canPresentCleanResult(coverage)
        ? "<p><b>No findings were recorded, but this is not a clean result.</b> The limitations above describe checks that did not run or did not complete. Absence of findings here means the assessment did not look, not that nothing is there.</p>"
        : ""
    }
  </div>
  <h2>Findings</h2>
  ${findingRows}
  <h2>Open Services</h2>
  ${portRows}
  <h2>Attack Surface: Subdomains</h2>
  ${subList}
  <h2>Attack Surface: Endpoints</h2>
  ${epList}
  <footer>
    <span>RIFT // Hacker Mode</span>
    <span>Generated ${now.toISOString().replace("T", " ").slice(0, 19)} UTC · Confidential</span>
  </footer>
</body></html>`;
}
