import {
  IMAGE_MODELS,
  VIDEO_MODELS,
  coerceSelectedModel,
  resolveChatModeForPurpose,
  resolveMediaModel,
} from "@/types/chat";
import { getImageModelPolicy, getVideoModelPolicy } from "../../media-models";

describe("Media Studio catalog", () => {
  it("keeps every image picker entry backed by the server allowlist", () => {
    for (const entry of IMAGE_MODELS) {
      expect(resolveMediaModel(entry.id)).toEqual({
        kind: "image",
        model: entry.model,
      });
      expect(getImageModelPolicy(entry.model)?.model).toBe(entry.model);
    }
  });

  it("keeps every video picker entry backed by the server allowlist", () => {
    for (const entry of VIDEO_MODELS) {
      expect(resolveMediaModel(entry.id)).toEqual({
        kind: "video",
        model: entry.model,
      });
      expect(getVideoModelPolicy(entry.model)?.model).toBe(entry.model);
    }
  });

  it("upgrades the retired Nano Banana picker id without accepting garbage", () => {
    expect(coerceSelectedModel("image-nano")).toBe("image-lite");
    expect(coerceSelectedModel("vendor/arbitrary-model")).toBeNull();
  });

  it("uses the top-tier FLUX.2 Max route", () => {
    expect(
      IMAGE_MODELS.find((entry) => entry.id === "image-flux"),
    ).toMatchObject({
      name: "FLUX.2 Max",
      model: "black-forest-labs/flux.2-max",
    });
  });

  it("derives a durable execution mode from the selected Studio model", () => {
    expect(
      resolveChatModeForPurpose({
        purpose: "image",
        selectedModel: "video-veo-fast",
        fallbackMode: "ask",
      }),
    ).toBe("agent");
    expect(
      resolveChatModeForPurpose({
        purpose: "image",
        selectedModel: "image-gemini",
        fallbackMode: "agent",
      }),
    ).toBe("ask");
    expect(
      resolveChatModeForPurpose({
        purpose: "app",
        selectedModel: "video-veo-fast",
        fallbackMode: "ask",
      }),
    ).toBe("ask");
  });
});
