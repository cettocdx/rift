import { NextRequest, NextResponse } from "next/server";
import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import {
  MEDIA_MODELS,
  BUILD_MODELS,
  DEFAULT_BUILD_MODEL,
  REASONING_EFFORT_LABELS,
} from "@/types/chat";
import { APPROVAL_LABELS, APPROVAL_MODES } from "@/lib/ai/approval/policy";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/db/convex-client";
export async function GET(req: NextRequest) {
  try {
    const { userId } = await getUserIDAndPro(req);
    const connections = await getConvexClient().query(
      api.localSandbox.listConnectionsForBackend,
      { serviceKey: process.env.CONVEX_SERVICE_ROLE_KEY!, userId },
    );
    return NextResponse.json(
      {
        model: DEFAULT_BUILD_MODEL,
        // Security currently uses the fixed Grok canary route; do not advertise
        // Build choices that this workbench will silently ignore.
        securityModels: BUILD_MODELS.filter((m) => m.id === "build-grok").map(
          (m) => ({ value: m.id, label: m.model }),
        ),
        mediaModels: MEDIA_MODELS.map((m) => ({ value: m.id, label: m.name })),
        models: BUILD_MODELS.map((m) => ({
          value: m.id,
          label: m.model,
          description: m.desc,
        })),
        modelEfforts: Object.fromEntries(
          BUILD_MODELS.map((m) => [
            m.id,
            m.reasoning.supportedEfforts.map((e) => ({
              value: e,
              label: REASONING_EFFORT_LABELS[e],
            })),
          ]),
        ),
        permissions: APPROVAL_MODES.map((value) => ({
          value,
          label: APPROVAL_LABELS[value],
        })),
        targets: [
          { value: "e2b", label: "Cloud" },
          ...connections.map((c) => ({ value: c.connectionId, label: c.name })),
        ],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return new Response("Sign in to RIFT or configure a personal API key.", {
      status: 401,
    });
  }
}
