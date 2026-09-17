import type { UIMessage } from "ai";
import { validateDownloadUrl } from "@/lib/ai/tools/utils/path-validation";

const MAX_REFERENCE_URL_LENGTH = 8_192;
const REFERENCE_IMAGE_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

/**
 * Reference URLs are resolved server-side from owner-checked file ids before
 * reaching this helper. Keep a second, narrow allowlist here because the URL
 * is subsequently fetched by a billable third-party media provider.
 */
export function sanitizeMediaReferenceUrls(
  urls: readonly string[] | undefined,
  maxReferences: number,
): string[] {
  if (!urls?.length || maxReferences <= 0) return [];

  const safe: string[] = [];
  const seen = new Set<string>();
  const limit = Math.min(Math.floor(maxReferences), 20);

  for (const candidate of urls) {
    if (
      typeof candidate !== "string" ||
      candidate.length === 0 ||
      candidate.length > MAX_REFERENCE_URL_LENGTH
    ) {
      continue;
    }

    try {
      const parsed = new URL(candidate);
      if (
        parsed.protocol !== "https:" ||
        parsed.username.length > 0 ||
        parsed.password.length > 0
      ) {
        continue;
      }
      validateDownloadUrl(candidate);
    } catch {
      continue;
    }

    if (seen.has(candidate)) continue;
    seen.add(candidate);
    safe.push(candidate);
    if (safe.length >= limit) break;
  }

  return safe;
}

/**
 * Return only images attached to the current user turn. Reusing an older
 * turn's image implicitly would make unrelated generations surprising.
 */
export function extractLatestUserImageReferenceUrls(
  messages: readonly UIMessage[],
): string[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;

    const candidates = (message.parts ?? []).flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const fields = part as unknown as Record<string, unknown>;
      const mediaType =
        typeof fields.mediaType === "string"
          ? fields.mediaType.toLowerCase()
          : "";
      return fields.type === "file" &&
        REFERENCE_IMAGE_MEDIA_TYPES.has(mediaType) &&
        typeof fields.url === "string"
        ? [fields.url]
        : [];
    });

    return sanitizeMediaReferenceUrls(candidates, 20);
  }

  return [];
}
