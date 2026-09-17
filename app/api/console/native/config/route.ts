import { NextRequest } from "next/server";
import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import { assertUserCanMakeCostIncurringRequest } from "@/lib/suspensions";
import {
  NATIVE_MODELS,
  nativeAccess,
  NativeRequestError,
} from "@/lib/ai/native-responses";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  let identity;
  try {
    identity = await getUserIDAndPro(req);
  } catch {
    return new Response("Sign in with rift login.", { status: 401 });
  }
  try {
    await assertUserCanMakeCostIncurringRequest(identity.userId);
  } catch {
    return new Response("Account access is unavailable.", { status: 403 });
  }
  try {
    await nativeAccess(identity);
    return Response.json(
      {
        ownerId: identity.userId,
        models: NATIVE_MODELS.map((m) => ({
          id: m.id,
          label: m.model,
          providerModel: m.providerModel,
          efforts: m.reasoning.supportedEfforts,
        })),
        defaultModel: "build-codex",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return new Response(
      error instanceof NativeRequestError
        ? error.message
        : "Native console is unavailable.",
      { status: error instanceof NativeRequestError ? error.status : 503 },
    );
  }
}
