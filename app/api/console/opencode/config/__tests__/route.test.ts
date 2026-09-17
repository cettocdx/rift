/** @jest-environment node */
import { NextRequest } from "next/server";
import { GET } from "../route";
import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import { assertUserCanMakeCostIncurringRequest } from "@/lib/suspensions";
import { buildExtraUsageConfig } from "@/lib/api/chat-stream-helpers";

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/auth/get-user-id", () => ({ getUserIDAndPro: jest.fn() }));
jest.mock("@/lib/suspensions", () => ({
  assertUserCanMakeCostIncurringRequest: jest.fn(),
}));
jest.mock("@/lib/db/actions", () => ({ getUserCustomization: jest.fn() }));
jest.mock("@/lib/api/chat-stream-helpers", () => ({
  buildExtraUsageConfig: jest.fn(),
}));

const request = () =>
  new NextRequest("http://localhost/api/console/opencode/config");

beforeEach(() => {
  jest.clearAllMocks();
  process.env.RIFT_CONSOLE_KEYED_CREDITS_ENABLED = "true";
  process.env.OPENROUTER_API_KEY = "server-secret";
  jest.mocked(getUserIDAndPro).mockResolvedValue({
    userId: "owner",
    subscription: "pro",
  } as any);
  jest
    .mocked(assertUserCanMakeCostIncurringRequest)
    .mockResolvedValue(undefined);
  jest.mocked(buildExtraUsageConfig).mockResolvedValue(undefined);
});

test("returns GPT and non-GPT models together with launcher metadata", async () => {
  const response = await GET(request());

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    ownerId: "owner",
    defaultModel: "build-fable",
    models: expect.arrayContaining([
      expect.objectContaining({
        id: "build-codex",
        label: "GPT-5.6 Sol",
        providerModel: "openai/gpt-5.6-sol",
        maxInputTokens: 922_000,
        maxOutputTokens: 16_384,
      }),
      expect.objectContaining({
        id: "build-astra",
        label: "GPT-6 Astra",
        providerModel: "openai/gpt-6-astra",
        maxInputTokens: 922_000,
        maxOutputTokens: 16_384,
      }),
      expect.objectContaining({
        id: "build-fable",
        label: "Claude Fable 5.1",
        providerModel: "anthropic/claude-fable-5.1",
        contextTokens: 1_000_000,
        maxInputTokens: 983_616,
        maxOutputTokens: 16_384,
      }),
    ]),
  });
  const body = await GET(request()).then((result) => result.json());
  expect(body.models.map((model: { id: string }) => model.id).sort()).toEqual([
    "build-astra",
    "build-codex",
    "build-fable",
    "build-gemini",
    "build-glm",
    "build-grok",
    "build-hunyuan",
    "build-kimi",
    "build-max",
  ]);
  expect(JSON.stringify(body)).not.toContain("server-secret");
  expect(
    body.models.every((model: { reasoning: unknown }) => model.reasoning),
  ).toBe(true);
});

test("uses the same authentication, suspension, and keyed-credit gates", async () => {
  jest.mocked(getUserIDAndPro).mockRejectedValueOnce(new Error("signed out"));
  expect((await GET(request())).status).toBe(401);

  jest
    .mocked(assertUserCanMakeCostIncurringRequest)
    .mockRejectedValueOnce(new Error("suspended"));
  expect((await GET(request())).status).toBe(403);

  process.env.RIFT_CONSOLE_KEYED_CREDITS_ENABLED = "false";
  expect((await GET(request())).status).toBe(403);
});
