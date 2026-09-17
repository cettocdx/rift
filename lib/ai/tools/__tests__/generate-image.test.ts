import {
  buildOpenRouterImageRequest,
  extractOpenRouterImage,
} from "../generate-image";
import { getImageModelPolicy } from "../../media-models";

describe("Media Studio image generation policy", () => {
  it("keeps arbitrary browser model ids outside the server allowlist", () => {
    expect(getImageModelPolicy("vendor/untrusted-image-model")).toBeNull();
    expect(getImageModelPolicy("google/gemini-3-pro-image")?.model).toBe(
      "google/gemini-3-pro-image",
    );
  });

  it("does not forward settings unsupported by the selected model", () => {
    const policy = getImageModelPolicy("google/gemini-3.1-flash-image")!;
    const request = buildOpenRouterImageRequest(policy, {
      prompt: "A quiet architectural editorial photograph",
      brief: "Generate an editorial photograph",
      aspectRatio: "16:9",
      resolution: "4K",
      outputFormat: "webp",
      quality: "high",
      background: "transparent",
    });

    expect(request).toMatchObject({
      model: "google/gemini-3.1-flash-image",
      aspect_ratio: "16:9",
      resolution: "4K",
    });
    expect(request).not.toHaveProperty("output_format");
    expect(request).not.toHaveProperty("quality");
    expect(request).not.toHaveProperty("background");
  });

  it("normalizes Gemini's unsupported auto ratio to its advertised default", () => {
    const policy = getImageModelPolicy("google/gemini-3.1-flash-image")!;
    const request = buildOpenRouterImageRequest(policy, {
      prompt: "A square editorial product photograph",
      brief: "Generate an editorial photograph",
      aspectRatio: "auto",
    });

    expect(request.aspect_ratio).toBe("1:1");
    expect(policy.aspectRatios).not.toContain("auto");
  });

  it("keeps the FLUX.2 Max payload inside its Images API capability contract", () => {
    const policy = getImageModelPolicy("black-forest-labs/flux.2-max")!;
    const request = buildOpenRouterImageRequest(policy, {
      prompt: "A precise editorial product photograph",
      brief: "Generate an editorial product photograph",
      aspectRatio: "16:9",
      resolution: "2K",
      outputFormat: "webp",
    });

    expect(request).toEqual({
      model: "black-forest-labs/flux.2-max",
      prompt: "A precise editorial product photograph",
      n: 1,
      output_format: "png",
    });
    expect(request).not.toHaveProperty("aspect_ratio");
    expect(request).not.toHaveProperty("resolution");
  });

  it("keeps GPT Image 2 inside its quality/background capability contract", () => {
    const policy = getImageModelPolicy("openai/gpt-image-2")!;
    const request = buildOpenRouterImageRequest(policy, {
      prompt: "A transparent glass logo mark",
      brief: "Generate a transparent logo",
      outputFormat: "jpeg",
      background: "transparent",
      quality: "medium",
    });

    expect(request).not.toHaveProperty("output_format");
    expect(request).not.toHaveProperty("aspect_ratio");
    expect(request).not.toHaveProperty("resolution");
    expect(request.background).toBe("auto");
    expect(request.quality).toBe("medium");

    expect(
      buildOpenRouterImageRequest(policy, {
        prompt: "A logo on an opaque white field",
        brief: "Generate a logo",
        background: "opaque",
      }).background,
    ).toBe("opaque");
  });

  it("adds only safe owner-resolved references up to the model limit", () => {
    const policy = getImageModelPolicy("bytedance-seed/seedream-5-0-pro")!;
    const urls = Array.from(
      { length: 16 },
      (_, index) => `https://files.example.com/reference-${index}.png`,
    );
    urls.splice(2, 0, "http://files.example.com/insecure.png");

    const request = buildOpenRouterImageRequest(
      policy,
      {
        prompt: "Keep the product identity and redesign the studio lighting",
        brief: "Create a product variation",
      },
      urls,
    );

    expect(request.input_references).toHaveLength(14);
    expect(request.input_references?.[0]).toEqual({
      type: "image_url",
      image_url: { url: "https://files.example.com/reference-0.png" },
    });
    expect(JSON.stringify(request)).not.toContain("insecure.png");
    expect(request).not.toHaveProperty("output_format");
  });

  it("falls back from aspect ratios outside Grok Imagine's advertised set", () => {
    const policy = getImageModelPolicy("x-ai/grok-imagine-image-2.0")!;
    const request = buildOpenRouterImageRequest(policy, {
      prompt: "A precise product portrait",
      brief: "Generate a product portrait",
      aspectRatio: "4:5",
    });

    expect(request.aspect_ratio).toBe("auto");
  });

  it("accepts only bounded raster responses and trusts valid provider cost", () => {
    const parsed = extractOpenRouterImage({
      data: [
        {
          b64_json: Buffer.from("image-bytes").toString("base64"),
          media_type: "image/webp",
        },
      ],
      usage: { cost: 0.047 },
    });

    expect(parsed).toMatchObject({
      mediaType: "image/webp",
      providerCostUsd: 0.047,
    });
    expect(
      extractOpenRouterImage({
        data: [{ b64_json: "PHN2Zz4=", media_type: "image/svg+xml" }],
      }),
    ).toBeNull();
    // The cap is a transport guard sized for a 4K PNG. It was 6MB, which a
    // 2K PNG of an ordinary brief exceeds — every 2K/4K request failed.
    expect(
      extractOpenRouterImage({
        data: [
          {
            b64_json: Buffer.alloc(32 * 1024 * 1024 + 1).toString("base64"),
            media_type: "image/png",
          },
        ],
      }),
    ).toBeNull();
    expect(
      extractOpenRouterImage({
        data: [
          {
            b64_json: Buffer.alloc(8 * 1024 * 1024).toString("base64"),
            media_type: "image/png",
          },
        ],
      }),
    ).not.toBeNull();
    // Providers spell subtypes loosely; image/jpg is image/jpeg.
    expect(
      extractOpenRouterImage({
        data: [{ b64_json: Buffer.from("x").toString("base64"), media_type: "image/jpg" }],
      }),
    ).toMatchObject({ mediaType: "image/jpeg" });
  });
});
