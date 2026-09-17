import { getSandboxContext } from "@/lib/ai/sandbox-context";
import { SignJWT } from "jose";

export async function generateCentrifugoToken(
  userId: string,
  expSeconds: number,
  origin = getSandboxContext().relay,
): Promise<string> {
  const secret = origin.tokenSecret;

  if (!secret) {
    throw new Error("CENTRIFUGO_TOKEN_SECRET environment variable is not set");
  }

  const encodedSecret = new TextEncoder().encode(secret);

  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(`${expSeconds}s`)
    .sign(encodedSecret);
}
