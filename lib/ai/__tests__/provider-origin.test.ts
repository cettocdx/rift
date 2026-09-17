/** @jest-environment node */
import { generateText } from "ai";
import { createTrackedProvider, myProvider } from "../providers";
import { getModerationResult } from "@/lib/moderation";
import {
  withConvexClientScope,
  bindConvexClientScope,
} from "@/lib/db/convex-client-scope";

const names = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT_ID",
  "OPENROUTER_API_KEY",
] as const;
const saved = Object.fromEntries(
  names.map((name) => [name, process.env[name]]),
);
const originalFetch = globalThis.fetch;
const calls: Array<{
  url: string;
  authorization: string | null;
  organization: string | null;
  project: string | null;
}> = [];
const messages = [
  {
    role: "user",
    parts: [
      {
        type: "text",
        text: "Explain the architecture of this local application.",
      },
    ],
  },
];
function config(origin: string) {
  process.env.OPENAI_API_KEY = `openai-${origin}`;
  process.env.OPENROUTER_API_KEY = `router-${origin}`;
  process.env.OPENAI_BASE_URL = `https://${origin}.example.test/v1`;
  process.env.OPENAI_ORG_ID = `org-${origin}`;
  process.env.OPENAI_PROJECT_ID = `project-${origin}`;
}
beforeEach(() => {
  calls.length = 0;
  globalThis.fetch = jest.fn(async (input, init) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      authorization: request.headers.get("authorization"),
      organization: request.headers.get("openai-organization"),
      project: request.headers.get("openai-project"),
    });
    return new Response(
      JSON.stringify(
        request.url.endsWith("moderations")
          ? {
              results: [{ category_scores: {}, categories: {} }],
            }
          : {
              id: "fixture",
              object: "chat.completion",
              created: 1,
              model: "fixture/model",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "Done." },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 5,
                completion_tokens: 2,
                total_tokens: 7,
              },
            },
      ),
      { headers: { "Content-Type": "application/json" } },
    );
  });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of names) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});
const generate = (model: ReturnType<typeof myProvider.languageModel>) =>
  generateText({ model, prompt: "Explain.", maxRetries: 0 });

it.each(["tracked", "untracked", "global"])(
  "binds %s models to A when invoked after B starts",
  async (kind) => {
    config("a");
    const model = withConvexClientScope(undefined, () => {
      const provider =
        kind === "global"
          ? myProvider
          : createTrackedProvider(kind === "tracked" ? () => {} : undefined);
      return provider.languageModel("ask-model");
    });
    config("b");
    await withConvexClientScope(undefined, async () => {
      await generate(model);
      await generate(myProvider.languageModel("ask-model"));
    });
    expect(calls.map((call) => call.authorization)).toEqual([
      "Bearer router-a",
      "Bearer router-b",
    ]);
  },
);

it("keeps scoped missing router configuration missing after B supplies a key", async () => {
  delete process.env.OPENROUTER_API_KEY;
  const provider = withConvexClientScope(undefined, () =>
    createTrackedProvider(),
  );
  config("b");
  await expect(generate(provider.languageModel("ask-model"))).rejects.toThrow(
    /key.*missing/i,
  );
  expect(calls).toEqual([]);
});

it("uses A and B moderation configuration without a module reset", async () => {
  for (const origin of ["a", "b"]) {
    config(origin);
    await withConvexClientScope(undefined, () =>
      getModerationResult(messages, true),
    );
  }
  expect(calls).toEqual(
    ["a", "b"].map((origin) => ({
      url: `https://${origin}.example.test/v1/moderations`,
      authorization: `Bearer openai-${origin}`,
      organization: `org-${origin}`,
      project: `project-${origin}`,
    })),
  );
});

it("restores provider configuration for a late bound callback", async () => {
  config("a");
  const callback = withConvexClientScope(undefined, () =>
    bindConvexClientScope(async () => {
      await getModerationResult(messages, true);
      await generate(myProvider.languageModel("ask-model"));
    }),
  );
  config("b");
  await withConvexClientScope(undefined, callback);
  expect(calls.map((call) => call.authorization)).toEqual([
    "Bearer openai-a",
    "Bearer router-a",
  ]);
});

it("does not borrow moderation configuration missing at scope entry", async () => {
  delete process.env.OPENAI_API_KEY;
  await withConvexClientScope(undefined, async () => {
    config("b");
    await expect(getModerationResult(messages, true)).resolves.toEqual({
      shouldUncensorResponse: false,
      moderationText: "",
    });
  });
  expect(calls).toEqual([]);
});

it("isolates overlapping A/B runs and their global provider selections", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  config("a");
  const a = withConvexClientScope(undefined, async () => {
    await gate;
    await generate(myProvider.languageModel("ask-model"));
    await getModerationResult(messages, true);
  });
  config("b");
  await withConvexClientScope(undefined, async () => {
    await generate(myProvider.languageModel("ask-model"));
    await getModerationResult(messages, true);
    release();
    await a;
  });
  expect(calls.map((call) => call.authorization)).toEqual([
    "Bearer router-b",
    "Bearer openai-b",
    "Bearer router-a",
    "Bearer openai-a",
  ]);
});

it("does not borrow default OpenAI routing headers missing in the originating scope", async () => {
  config("a");
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_ORG_ID;
  delete process.env.OPENAI_PROJECT_ID;
  await withConvexClientScope(undefined, async () => {
    config("b");
    await getModerationResult(messages, true);
  });
  expect(calls).toEqual([
    {
      url: "https://api.openai.com/v1/moderations",
      authorization: "Bearer openai-a",
      organization: null,
      project: null,
    },
  ]);
});
