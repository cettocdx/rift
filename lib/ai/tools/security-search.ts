import { getProviderContext } from "@/lib/ai/provider-context";
import { tool } from "ai";
import { z } from "zod";

/**
 * Security RAG search tool backed by the preview.is hybrid-search API.
 * Indexes curated web-security articles / write-ups (XSS, CSRF, CORS, SSRF,
 * auth vulns, CVEs …) and fuses exact keyword matching with semantic
 * embeddings, returning ranked article sections with source citations.
 *
 * Gated on PREVIEW_RAG_API_KEY (an `rk_`-prefixed key). Read-only, so it is
 * exposed in both ask and agent modes — same as web_search.
 *
 * Docs: https://rag.preview.is/docs · API: https://api.preview.is/search
 */

type MatchedSection = { heading?: string; score?: number; text?: string };
type RagResult = {
  rank?: number;
  score?: number;
  title?: string;
  url?: string;
  file?: string;
  matched_sections?: MatchedSection[];
  content?: string | null;
};
type RagResponse = { query?: string; count?: number; results?: RagResult[] };

function formatResults(data: RagResponse, fullContent: boolean): string {
  const results = data.results ?? [];
  if (results.length === 0) {
    return "No relevant security articles found. Try broader terms, exact CVE ids, header names, or lower min_score.";
  }
  const blocks = results.map((r, i) => {
    const head = `### ${r.rank ?? i + 1}. ${r.title ?? "Untitled"}${
      typeof r.score === "number" ? `  (score ${r.score.toFixed(3)})` : ""
    }`;
    const src = r.url ? `Source: ${r.url}` : "";
    let body: string;
    if (fullContent && r.content) {
      body = r.content.trim().slice(0, 4000);
    } else {
      const secs = (r.matched_sections ?? [])
        .slice(0, 4)
        .map((s) => {
          const h = s.heading ? `**${s.heading}**\n` : "";
          const t = (s.text ?? "").trim().slice(0, 900);
          return `${h}${t}`;
        })
        .filter(Boolean)
        .join("\n\n");
      body = secs || "(no matched section text returned)";
    }
    return [head, src, "", body].filter(Boolean).join("\n");
  });
  return `Security RAG — ${results.length} result(s) for "${data.query ?? ""}":\n\n${blocks.join("\n\n---\n\n")}`;
}

export const createSecuritySearch = (origin = getProviderContext()) => {
  return tool({
    description: `Search a curated corpus of web-security research and write-ups (hybrid keyword + semantic RAG). Returns ranked article sections with source citations.

<instructions>
- Use this FIRST for web-security knowledge: XSS, CSRF, CORS, SSRF, IDOR, auth/session flaws, deserialization, SSTI, specific CVEs, header/config misconfigurations, and exploitation or remediation techniques.
- Prefer this over general web_search when the question is about a known vulnerability class or a documented technique — results are curated and cited, so citations are trustworthy.
- Exact tokens work well: CVE ids, header names (e.g. Content-Security-Policy), tags, and parameter names.
- Raise \`min_score\` (~0.5+) to keep only strong matches; set \`full_content\` true when you need the complete article to reproduce an exploit or write a remediation.
- Cite the returned Source URLs in your findings/report.
</instructions>`,
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Natural-language security question or exact tokens (CVE id, header, tag).",
        ),
      k: z
        .number()
        .int()
        .min(1)
        .max(5)
        .optional()
        .describe("Number of parent articles to return (1-5, default 5)."),
      min_score: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Relevance threshold 0-1. ~0.5+ keeps only strong matches."),
      full_content: z
        .boolean()
        .optional()
        .describe("Include the full markdown article body when true."),
      brief: z
        .string()
        .describe(
          "A one-sentence preamble describing the purpose of this operation.",
        ),
    }),
    execute: async (
      {
        query,
        k,
        min_score,
        full_content,
      }: {
        brief: string;
        query: string;
        k?: number;
        min_score?: number;
        full_content?: boolean;
      },
      { abortSignal },
    ) => {
      const apiKey = origin.previewRagApiKey;
      if (!apiKey) {
        return "Error: security search is not configured (PREVIEW_RAG_API_KEY missing).";
      }
      try {
        const response = await fetch(`${origin.previewRagBaseUrl}/search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
          },
          body: JSON.stringify({
            query,
            k: Math.min(k ?? 5, 5),
            min_score: min_score ?? 0,
            full_content: full_content ?? false,
          }),
          signal: abortSignal,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          if (response.status === 429)
            return "Error: security search rate limit reached (429). Wait and retry, or fall back to web_search.";
          if (response.status === 401)
            return "Error: security search auth failed (401) — check PREVIEW_RAG_API_KEY.";
          return `Error: security search API ${response.status} — ${errText.slice(0, 300)}`;
        }

        const data = (await response.json()) as RagResponse;
        return formatResults(data, full_content ?? false);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return "Error: Operation aborted";
        }
        console.error("Security search tool error:", error);
        const msg = error instanceof Error ? error.message : "Unknown error";
        return `Error performing security search: ${msg}`;
      }
    },
  });
};
