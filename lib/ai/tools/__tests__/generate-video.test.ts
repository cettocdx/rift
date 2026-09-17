import {
  buildOpenRouterVideoReferencePlan,
  sanitizeVideoSettings,
} from "../generate-video";
import {
  getProviderReportedCost,
  getVideoModelPolicy,
} from "../../media-models";

describe("Media Studio video generation policy", () => {
  it("keeps arbitrary browser model ids outside the server allowlist", () => {
    expect(getVideoModelPolicy("vendor/untrusted-video-model")).toBeNull();
    expect(getVideoModelPolicy("google/veo-3.1-fast")?.model).toBe(
      "google/veo-3.1-fast",
    );
  });

  it("falls back to supported settings and preserves supported Kling audio", () => {
    const policy = getVideoModelPolicy("kwaivgi/kling-v3.0-pro")!;
    const settings = sanitizeVideoSettings(policy, {
      prompt: "A slow dolly toward a product on a dark studio table",
      brief: "Generate a product film",
      duration: 8,
      aspectRatio: "1:1",
      resolution: "1080p",
      generateAudio: true,
    });

    expect(settings).toEqual({
      duration: 5,
      aspectRatio: "1:1",
      resolution: "720p",
      generateAudio: true,
    });
  });

  it("uses Veo 3.1's live duration and aspect-ratio contract", () => {
    const policy = getVideoModelPolicy("google/veo-3.1-fast")!;

    expect(
      sanitizeVideoSettings(policy, {
        prompt: "A continuous cinematic city shot at dawn",
        brief: "Generate a cinematic shot",
        duration: 6,
        aspectRatio: "9:16",
        resolution: "1080p",
      }),
    ).toEqual({
      duration: 6,
      aspectRatio: "9:16",
      resolution: "1080p",
      generateAudio: true,
    });

    expect(
      sanitizeVideoSettings(policy, {
        prompt: "A continuous cinematic city shot at dawn",
        brief: "Generate a cinematic shot",
        duration: 5,
        aspectRatio: "1:1",
      }),
    ).toMatchObject({ duration: 4, aspectRatio: "16:9" });
  });

  it("keeps Seedance audio enabled and clamps to its advertised 720p ceiling", () => {
    // Seedance 2.5 dropped 2.0's 1080p/4K tiers; a 1080p request must fall
    // back rather than be forwarded to an endpoint that would reject it.
    const policy = getVideoModelPolicy("bytedance/seedance-2.5")!;
    expect(policy.costPerSecondUsd).toBe(0.3402);
    expect(policy.resolutions).toEqual(["720p"]);
    expect(
      sanitizeVideoSettings(policy, {
        prompt: "A continuous fashion film with a slow orbiting camera",
        brief: "Generate a fashion film",
        duration: 10,
        aspectRatio: "9:16",
        resolution: "1080p",
        generateAudio: true,
      }),
    ).toEqual({
      duration: 10,
      aspectRatio: "9:16",
      resolution: "720p",
      generateAudio: true,
    });
  });

  it("uses model defaults and enables audio on an audio-capable model", () => {
    const policy = getVideoModelPolicy("google/veo-3.1-fast")!;
    expect(
      sanitizeVideoSettings(policy, {
        prompt: "A continuous cinematic city shot at dawn",
        brief: "Generate a cinematic shot",
      }),
    ).toEqual({
      duration: 4,
      aspectRatio: "16:9",
      resolution: "720p",
      generateAudio: true,
    });
  });

  it("accepts only finite non-negative provider-reported costs", () => {
    expect(getProviderReportedCost({ openrouter: { cost: 0.50445 } })).toBe(
      0.50445,
    );
    expect(getProviderReportedCost({ openrouter: { cost: -1 } })).toBeNull();
    expect(
      getProviderReportedCost({ openrouter: { cost: "0.50" } }),
    ).toBeNull();
    expect(getProviderReportedCost(undefined)).toBeNull();
  });

  it("uses two explicit attachments as Kling first and last frames", () => {
    const policy = getVideoModelPolicy("kwaivgi/kling-v3.0-pro")!;
    const plan = buildOpenRouterVideoReferencePlan(
      policy,
      [
        "https://files.example.com/start.png",
        "https://files.example.com/end.png",
      ],
      "first-last",
    );

    expect(plan).toEqual({
      mode: "first-last",
      referenceCount: 2,
      extraBody: {
        frame_images: [
          {
            type: "image_url",
            image_url: { url: "https://files.example.com/start.png" },
            frame_type: "first_frame",
          },
          {
            type: "image_url",
            image_url: { url: "https://files.example.com/end.png" },
            frame_type: "last_frame",
          },
        ],
      },
    });
  });

  it("clips Seedance style guidance to its reference-image limit", () => {
    const policy = getVideoModelPolicy("bytedance/seedance-2.5")!;
    const urls = Array.from(
      { length: 12 },
      (_, index) => `https://files.example.com/style-${index}.webp`,
    );
    const plan = buildOpenRouterVideoReferencePlan(policy, urls, "style");

    expect(plan.mode).toBe("style");
    expect(plan.referenceCount).toBe(9);
    expect(plan.extraBody.input_references).toHaveLength(9);
    expect(plan.extraBody).not.toHaveProperty("frame_images");
  });

  it("narrows unsupported style guidance to a safe first frame", () => {
    const policy = getVideoModelPolicy("google/veo-3.1-fast")!;
    const plan = buildOpenRouterVideoReferencePlan(
      policy,
      [
        "https://files.example.com/start.png",
        "http://files.example.com/not-public.png",
      ],
      "style",
    );

    expect(plan.mode).toBe("first-frame");
    expect(plan.referenceCount).toBe(1);
    expect(plan.extraBody).toEqual({
      frame_images: [
        {
          type: "image_url",
          image_url: { url: "https://files.example.com/start.png" },
          frame_type: "first_frame",
        },
      ],
    });
  });
});
