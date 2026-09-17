import type { NextRequest } from "next/server";
import { readAssessment } from "@/lib/console/workspaces-assessment";
import { route } from "@/lib/console/workspaces-server";
import { renderHackReport } from "@/lib/hack/report-html";
export async function GET(req: NextRequest) {
  return route(
    async () =>
      new Response(renderHackReport(await readAssessment(req)), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, no-store",
          "Content-Disposition": "attachment; filename=rift-assessment.html",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
        },
      }),
  );
}
