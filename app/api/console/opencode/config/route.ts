import { NextRequest } from "next/server";
import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import { assertUserCanMakeCostIncurringRequest } from "@/lib/suspensions";
import {
  ACCEPTED_RESPONSES_MODELS,
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
        models: ACCEPTED_RESPONSES_MODELS.map((model) => ({
          id: model.id,
          label: model.model,
          providerModel: model.providerModel,
          contextTokens: model.contextTokens,
          maxInputTokens: Math.min(
            model.contextTokens - 16_384,
            "maxInputTokens" in model
              ? model.maxInputTokens
              : model.contextTokens - 16_384,
          ),
          maxOutputTokens: 16_384,
          reasoning: model.reasoning,
        })),
        defaultModel: "build-fable",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return new Response(
      error instanceof NativeRequestError
        ? error.message
        : "OpenCode console is unavailable.",
      { status: error instanceof NativeRequestError ? error.status : 503 },
    );
  }
}
