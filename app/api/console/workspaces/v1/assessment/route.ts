import type { NextRequest } from "next/server";
import { readAssessment } from "@/lib/console/workspaces-assessment";
import { json, route } from "@/lib/console/workspaces-server";
export async function GET(req: NextRequest) {
  return route(async () => json(await readAssessment(req)));
}
