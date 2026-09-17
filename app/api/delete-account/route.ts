import { NextRequest, NextResponse } from "next/server";
import { getUserID } from "@/lib/auth/get-user-id";
import { deleteUserRateLimitKeys } from "@/lib/rate-limit/token-bucket";
import { ChatSDKError } from "@/lib/errors";
import { deleteUserSandboxes } from "@/lib/workbench/delete-sandboxes";

/**
 * Account deletion. The user's Convex data is removed client-side (via the
 * deleteAllUserData mutation) before this route runs; here we purge server-side
 * rate-limit state. org/Stripe-customer teardown was removed with the
 * auth migration; billing teardown will return with the billing rework.
 */
export const POST = async (req: NextRequest) => {
  try {
    const userId = await getUserID(req);

    await deleteUserRateLimitKeys(userId).catch((err) => {
      console.warn(
        "Failed to clear rate-limit keys during account deletion:",
        err,
      );
    });
    await deleteUserSandboxes(userId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
    console.error("Account deletion failed:", error);
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 },
    );
  }
};
