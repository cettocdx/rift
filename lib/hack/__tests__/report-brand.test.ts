import { RIFT_SYMBOL_PATH, RIFT_WORDMARK_PATHS } from "@/lib/brand/logo";
import { HACK_REPORT_BRAND_SVG } from "../report-brand";
import { renderHackReport } from "../report-html";
import { summarizeCoverage } from "../report-coverage";

test("standalone report embeds accessible, self-contained canonical artwork", () => {
  const document = new DOMParser().parseFromString(
    HACK_REPORT_BRAND_SVG,
    "image/svg+xml",
  );
  expect(document.querySelector("parsererror")).toBeNull();
  const svg = document.documentElement;
  expect(svg.getAttribute("viewBox")).toBe("0 0 428 152");
  expect(svg.getAttribute("aria-label")).toBe("RIFT");
  expect(svg.getAttribute("role")).toBe("img");
  expect(
    [...svg.querySelectorAll("path")].map((node) => node.getAttribute("d")),
  ).toEqual([RIFT_SYMBOL_PATH, RIFT_SYMBOL_PATH, ...RIFT_WORDMARK_PATHS]);
  expect(svg.querySelectorAll("g")[1].getAttribute("fill-rule")).toBe(
    "evenodd",
  );
  expect(svg.querySelector("path[transform]")!.getAttribute("transform")).toBe(
    "rotate(180 50 50)",
  );
  expect(svg.querySelector("image, script, foreignObject, text")).toBeNull();
});

test("HTML report cover includes artwork instead of the former font wordmark", () => {
  const html = renderHackReport({
    coverage: summarizeCoverage({
      messages: [],
      allPhases: [],
      ranPhases: [],
      stoppedEarly: false,
      target: "example.test",
    }),
    findings: [],
    ports: [],
    subdomains: [],
    endpoints: [],
    target: "example.test",
    sevCounts: { C: 0, H: 0, M: 0, L: 0 },
    threat: "Unknown",
  });
  const document = new DOMParser().parseFromString(html, "text/html");
  expect(
    document.querySelector(".cover .brand svg")?.getAttribute("aria-label"),
  ).toBe("RIFT");
  expect(html).toContain(HACK_REPORT_BRAND_SVG);
  expect(document.querySelector(".cover .brand")?.textContent).toBe("");
});
