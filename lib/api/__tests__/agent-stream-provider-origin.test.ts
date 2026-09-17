/** @jest-environment node */
import {
  createAgentStream,
  makeCtx,
  scriptedModel,
} from "./helpers/scripted-model";
import {
  extractOpenRouterMetadata,
  fetchOpenRouterGenerationMetadata,
} from "../openrouter-metadata";
import { withConvexClientScope } from "@/lib/db/convex-client-scope";
const saved = process.env.OPENROUTER_API_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = saved;
  jest.mocked(extractOpenRouterMetadata).mockReturnValue({});
  jest.mocked(fetchOpenRouterGenerationMetadata).mockClear();
});
it.each(["router-a", undefined])(
  "captures the metadata key at stream creation (key=%s)",
  async (key) => {
    if (key === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = key;
    jest
      .mocked(extractOpenRouterMetadata)
      .mockReturnValue({ openrouter_generation_id: "generation-a" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const model = scriptedModel([{ text: "Done." }]);
    const original = model.doStream.bind(model);
    model.doStream = async (options) => {
      await gate;
      return original(options);
    };
    const made = makeCtx({
      model,
      chatLogger: { setStreamResponse: jest.fn() } as any,
    });
    const result = await withConvexClientScope(undefined, () =>
      createAgentStream("ask-model", made.ctx, made.state),
    );
    process.env.OPENROUTER_API_KEY = "router-b";
    await withConvexClientScope(undefined, async () => {
      release();
      await result.consumeStream();
    });
    expect(fetchOpenRouterGenerationMetadata).toHaveBeenCalledWith(
      "generation-a",
      { apiKey: key ?? "" },
    );
  },
);
