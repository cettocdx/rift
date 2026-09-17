import { sanitizeOpenRouterEncryptedReasoning } from "@/lib/ai/providers";

describe("sanitizeOpenRouterEncryptedReasoning", () => {
  it("sheds an unattributed blob on an xAI turn, keeping the sibling text detail", () => {
    // A non-xAI entry in the fallback chain does not soften the shed: the
    // request is served by `model`, and xAI rejects every replayed payload.
    const body = {
      model: "x-ai/grok-4.3",
      models: ["google/gemini-3-flash-preview"],
      messages: [
        {
          role: "assistant",
          content: "Here is the answer.",
          reasoning_details: [
            { type: "text", text: "plain reasoning detail" },
            {
              type: "encrypted",
              encrypted_content: "provider-private-gemini-blob",
            },
          ],
        },
      ],
    };

    const result = sanitizeOpenRouterEncryptedReasoning(body);

    expect(result.changed).toBe(true);
    expect(result.body).toEqual({
      ...body,
      messages: [
        {
          role: "assistant",
          content: "Here is the answer.",
          reasoning_details: [{ type: "text", text: "plain reasoning detail" }],
        },
      ],
    });
    expect(JSON.stringify(result.body)).not.toContain("encrypted_content");
    expect(JSON.stringify(body)).toContain("encrypted_content");
  });

  it("removes reasoning_details when every detail is encrypted", () => {
    const body = {
      model: "x-ai/grok-4.3",
      messages: [
        {
          role: "assistant",
          content: "Visible text stays.",
          reasoning_details: [
            { type: "encrypted", encrypted_content: "x-provider-blob" },
          ],
        },
      ],
    };

    const result = sanitizeOpenRouterEncryptedReasoning(body);

    expect(result.changed).toBe(true);
    expect(result.body).toEqual({
      model: "x-ai/grok-4.3",
      messages: [
        {
          role: "assistant",
          content: "Visible text stays.",
        },
      ],
    });
  });

  it("strips the OpenRouter-normalised encrypted detail shape on an xAI route", () => {
    // OpenRouter's own wire shape puts the sealed payload in `data`, not in the
    // OpenAI-Responses `encrypted_content` field.
    const body = {
      model: "x-ai/grok-4.3",
      messages: [
        {
          role: "assistant",
          content: "Visible text stays.",
          reasoning_details: [
            {
              type: "reasoning.encrypted",
              data: "sealed-blob",
              format: "anthropic-claude-v1",
            },
          ],
        },
      ],
    };

    const result = sanitizeOpenRouterEncryptedReasoning(body);

    expect(result.changed).toBe(true);
    expect(JSON.stringify(result.body)).not.toContain("sealed-blob");
  });

  it("leaves a same-provider route unchanged", () => {
    const body = {
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "assistant",
          content: "Here is the answer.",
          reasoning_details: [
            {
              type: "reasoning.encrypted",
              data: "gemini-blob",
              format: "google-gemini-v1",
            },
          ],
        },
      ],
    };

    const result = sanitizeOpenRouterEncryptedReasoning(body);

    expect(result.changed).toBe(false);
    expect(result.body).toBe(body);
  });

  it("preserves encrypted_content outside provider reasoning metadata", () => {
    const body = {
      model: "x-ai/grok-4.3",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Please inspect this payload.",
            },
            {
              type: "input_json",
              encrypted_content: "user-owned-data",
            },
          ],
        },
        {
          role: "assistant",
          content: "Visible text stays.",
          tool_calls: [
            {
              id: "call_1",
              function: {
                name: "decrypt",
                arguments: JSON.stringify({
                  encrypted_content: "tool-owned-data",
                }),
              },
            },
          ],
        },
      ],
    };

    const result = sanitizeOpenRouterEncryptedReasoning(body);

    expect(result.changed).toBe(false);
    expect(result.body).toBe(body);
    expect(JSON.stringify(result.body)).toContain("user-owned-data");
    expect(JSON.stringify(result.body)).toContain("tool-owned-data");
  });

  describe("cross-model history", () => {
    it("strips a Gemini blob replayed to Anthropic", () => {
      const body = {
        model: "anthropic/claude-opus-5",
        messages: [
          {
            role: "assistant",
            content: "Answered under Gemini.",
            reasoning_details: [
              {
                type: "reasoning.text",
                text: "visible reasoning",
                format: "google-gemini-v1",
              },
              {
                type: "reasoning.encrypted",
                data: "gemini-sealed-blob",
                format: "google-gemini-v1",
              },
            ],
          },
        ],
      };

      const result = sanitizeOpenRouterEncryptedReasoning(body);

      expect(result.changed).toBe(true);
      expect(result.body).toEqual({
        model: "anthropic/claude-opus-5",
        messages: [
          {
            role: "assistant",
            content: "Answered under Gemini.",
            reasoning_details: [
              {
                type: "reasoning.text",
                text: "visible reasoning",
                format: "google-gemini-v1",
              },
            ],
          },
        ],
      });
    });

    it("strips an Anthropic blob replayed to a vendor with no shared dialect", () => {
      const body = {
        model: "deepseek/deepseek-v4-flash",
        messages: [
          {
            role: "assistant",
            content: "Answered under Claude.",
            reasoning_details: [
              {
                type: "reasoning.encrypted",
                data: "claude-sealed-blob",
                format: "anthropic-claude-v1",
              },
            ],
          },
        ],
      };

      const result = sanitizeOpenRouterEncryptedReasoning(body);

      expect(result.changed).toBe(true);
      expect(JSON.stringify(result.body)).not.toContain("claude-sealed-blob");
    });

    it("treats Azure and OpenAI as one dialect", () => {
      const body = {
        model: "openai/gpt-5.6-sol",
        messages: [
          {
            role: "assistant",
            content: "Answered under Azure OpenAI.",
            reasoning_details: [
              {
                type: "reasoning",
                encrypted_content: "azure-sealed-blob",
                format: "azure-openai-responses-v1",
              },
            ],
          },
        ],
      };

      const result = sanitizeOpenRouterEncryptedReasoning(body);

      expect(result.changed).toBe(false);
      expect(result.body).toBe(body);
    });

    it("drops a blob only a fallback could read", () => {
      // `models` is tried only after the addressed model errors. Keeping a
      // payload that just the fallback understands guarantees the primary
      // rejects the turn, so attribution is judged against `model` alone.
      const body = {
        model: "openai/gpt-5.6-sol",
        models: ["anthropic/claude-opus-5"],
        messages: [
          {
            role: "assistant",
            content: "Answered under Claude.",
            reasoning_details: [
              {
                type: "reasoning.encrypted",
                data: "claude-sealed-blob",
                format: "anthropic-claude-v1",
              },
            ],
          },
        ],
      };

      const result = sanitizeOpenRouterEncryptedReasoning(body);

      expect(result.changed).toBe(true);
      expect(JSON.stringify(result.body)).not.toContain("claude-sealed-blob");
    });

    it("keeps the addressed model's own blob when the chain ends in Grok", () => {
      // Every Anthropic fallback chain in this app ends in a Grok slug. The
      // redacted thinking block belongs to the model actually serving the turn,
      // and Anthropic 400s a tool-call turn that arrives without it.
      const body = {
        model: "anthropic/claude-opus-4.6",
        models: ["openai/gpt-5.6-sol", "x-ai/grok-4.6", "x-ai/grok-4.3"],
        messages: [
          {
            role: "assistant",
            content: "Calling a tool.",
            tool_calls: [
              { id: "call_1", function: { name: "read", arguments: "{}" } },
            ],
            reasoning_details: [
              {
                type: "reasoning.encrypted",
                data: "claude-redacted-thinking",
                format: "anthropic-claude-v1",
              },
            ],
          },
        ],
      };

      const result = sanitizeOpenRouterEncryptedReasoning(body);

      expect(result.changed).toBe(false);
      expect(result.body).toBe(body);
    });

    it("addresses the first fallback when the body carries no model", () => {
      const body = {
        models: ["anthropic/claude-opus-5", "x-ai/grok-4.3"],
        messages: [
          {
            role: "assistant",
            content: "Answered under Gemini.",
            reasoning_details: [
              {
                type: "reasoning.encrypted",
                data: "gemini-sealed-blob",
                format: "google-gemini-v1",
              },
            ],
          },
        ],
      };

      const result = sanitizeOpenRouterEncryptedReasoning(body);

      expect(result.changed).toBe(true);
      expect(JSON.stringify(result.body)).not.toContain("gemini-sealed-blob");
    });

    it("keeps every blob when the slug names no vendor", () => {
      const body = {
        model: "grok-4.3",
        messages: [
          {
            role: "assistant",
            content: "Answered under Claude.",
            reasoning_details: [
              {
                type: "reasoning.encrypted",
                data: "claude-sealed-blob",
                format: "anthropic-claude-v1",
              },
            ],
          },
        ],
      };

      const result = sanitizeOpenRouterEncryptedReasoning(body);

      expect(result.changed).toBe(false);
      expect(result.body).toBe(body);
    });

    it("rewrites only the message holding the foreign blob", () => {
      const clean = {
        role: "assistant",
        content: "Answered under Claude.",
        reasoning_details: [
          {
            type: "reasoning.encrypted",
            data: "claude-sealed-blob",
            format: "anthropic-claude-v1",
          },
        ],
      };
      const foreign = {
        role: "assistant",
        content: "Answered under Gemini.",
        reasoning_details: [
          {
            type: "reasoning.encrypted",
            data: "gemini-sealed-blob",
            format: "google-gemini-v1",
          },
        ],
      };
      const body = {
        model: "anthropic/claude-opus-5",
        messages: [clean, foreign],
      };

      const result = sanitizeOpenRouterEncryptedReasoning(body) as {
        changed: boolean;
        body: { messages: unknown[] };
      };

      expect(result.changed).toBe(true);
      expect(result.body.messages[0]).toBe(clean);
      expect(result.body.messages[1]).not.toBe(foreign);
      expect(JSON.stringify(result.body)).toContain("claude-sealed-blob");
      expect(JSON.stringify(result.body)).not.toContain("gemini-sealed-blob");
    });

    it("keeps a reasoning summary on a cross-model replay", () => {
      // Summaries carry no sealed payload, so no dialect can refuse them.
      const body = {
        model: "anthropic/claude-opus-5",
        messages: [
          {
            role: "assistant",
            content: "Answered under Gemini.",
            reasoning_details: [
              {
                type: "reasoning.summary",
                summary: "Weighed two options.",
                format: "google-gemini-v1",
              },
            ],
          },
        ],
      };

      const result = sanitizeOpenRouterEncryptedReasoning(body);

      expect(result.changed).toBe(false);
      expect(result.body).toBe(body);
    });

    it("keeps an unattributed blob rather than guess at its origin", () => {
      // Without `format` there is no proof of provenance, and Anthropic rejects
      // a tool-call turn whose redacted thinking block has gone missing.
      const body = {
        model: "anthropic/claude-opus-5",
        messages: [
          {
            role: "assistant",
            content: "Answered earlier.",
            reasoning_details: [
              { type: "reasoning.encrypted", data: "unlabelled-blob" },
              {
                type: "reasoning.encrypted",
                data: "unknown-format-blob",
                format: "unknown",
              },
            ],
          },
        ],
      };

      const result = sanitizeOpenRouterEncryptedReasoning(body);

      expect(result.changed).toBe(false);
      expect(result.body).toBe(body);
    });

    it("keeps every blob when the router hides the target endpoint", () => {
      const body = {
        model: "openrouter/auto",
        messages: [
          {
            role: "assistant",
            content: "Answered under Claude.",
            reasoning_details: [
              {
                type: "reasoning.encrypted",
                data: "claude-sealed-blob",
                format: "anthropic-claude-v1",
              },
            ],
          },
        ],
      };

      const result = sanitizeOpenRouterEncryptedReasoning(body);

      expect(result.changed).toBe(false);
      expect(result.body).toBe(body);
    });

    it("keeps a Gemini thought signature on a cross-model replay", () => {
      // The signature rides a `reasoning.text` detail and in providerMetadata;
      // dropping it breaks Gemini function calling (lib/utils/message-processor.ts).
      const body = {
        model: "anthropic/claude-opus-5",
        messages: [
          {
            role: "assistant",
            content: "Answered under Gemini.",
            reasoning_details: [
              {
                type: "reasoning.text",
                text: "visible reasoning",
                signature: "gemini-thought-signature",
                format: "google-gemini-v1",
              },
            ],
          },
        ],
      };

      const result = sanitizeOpenRouterEncryptedReasoning(body);

      expect(result.changed).toBe(false);
      expect(JSON.stringify(result.body)).toContain("gemini-thought-signature");
    });
  });
});
