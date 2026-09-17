import type { UIMessage } from "ai";
import {
  extractLatestUserImageReferenceUrls,
  sanitizeMediaReferenceUrls,
} from "../media-references";

describe("Media Studio reference URLs", () => {
  it("keeps only unique public HTTPS URLs inside the requested limit", () => {
    expect(
      sanitizeMediaReferenceUrls(
        [
          "https://files.example.com/a.png?token=one",
          "https://files.example.com/a.png?token=one",
          "http://files.example.com/b.png",
          "https://user:pass@files.example.com/c.png",
          "https://127.0.0.1/private.png",
          "https://files.example.com/d.webp",
        ],
        2,
      ),
    ).toEqual([
      "https://files.example.com/a.png?token=one",
      "https://files.example.com/d.webp",
    ]);
  });

  it("uses image attachments from the latest user turn only", () => {
    const messages = [
      {
        id: "old-user",
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "image/png",
            url: "https://files.example.com/old.png",
          },
        ],
      },
      {
        id: "assistant",
        role: "assistant",
        parts: [{ type: "text", text: "Done" }],
      },
      {
        id: "latest-user",
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "image/webp",
            url: "https://files.example.com/current.webp",
          },
          {
            type: "file",
            mediaType: "image/gif",
            url: "https://files.example.com/animated.gif",
          },
          {
            type: "file",
            mediaType: "application/pdf",
            url: "https://files.example.com/brief.pdf",
          },
        ],
      },
    ] as UIMessage[];

    expect(extractLatestUserImageReferenceUrls(messages)).toEqual([
      "https://files.example.com/current.webp",
    ]);
  });

  it("does not silently fall back to an older image when the new turn has none", () => {
    const messages = [
      {
        id: "old-user",
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "image/png",
            url: "https://files.example.com/old.png",
          },
        ],
      },
      {
        id: "latest-user",
        role: "user",
        parts: [{ type: "text", text: "Make a completely new poster" }],
      },
    ] as UIMessage[];

    expect(extractLatestUserImageReferenceUrls(messages)).toEqual([]);
  });
});
