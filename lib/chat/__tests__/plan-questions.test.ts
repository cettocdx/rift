import {
  findOpenQuestionsFence,
  findQuestionsBlock,
  parsePlanQuestions,
} from "@/lib/chat/plan-questions";

const PAYLOAD = JSON.stringify({
  questions: [
    {
      id: "type",
      question: "Nasıl bir 3D deneyim istiyorsunuz?",
      options: [{ label: "Ürün görselleştirme" }, { label: "Oyun sahnesi" }],
    },
  ],
});

const fenced = (lang: string, body = PAYLOAD) =>
  "```" + lang + "\n" + body + "\n```";

describe("findQuestionsBlock", () => {
  // The reported bug, exactly: the model labelled the block ```rift instead of
  // ```rift-questions, the label-matching detector missed it, and the user was
  // shown raw JSON in a code block where clickable cards belonged.
  it.each(["rift-questions", "rift", "json", "questions", ""])(
    "promotes a questions payload fenced as %p",
    (lang) => {
      const match = findQuestionsBlock(
        `Önce bir soru:\n\n${fenced(lang)}\n\nSonra.`,
      );
      expect(match?.data.questions[0].question).toBe(
        "Nasıl bir 3D deneyim istiyorsunuz?",
      );
    },
  );

  it("returns the surrounding prose boundaries so nothing is swallowed", () => {
    const text = `Before.\n\n${fenced("rift")}\n\nAfter.`;
    const match = findQuestionsBlock(text);
    expect(text.slice(0, match!.start).trim()).toBe("Before.");
    expect(text.slice(match!.end).trim()).toBe("After.");
  });

  // The label is a filter, not the decision — so the shape has to be the thing
  // that rejects, or any JSON the agent prints would turn into option cards.
  it("leaves ordinary JSON and code blocks alone", () => {
    expect(
      findQuestionsBlock(fenced("json", '{"user":{"name":"a"}}')),
    ).toBeNull();
    expect(findQuestionsBlock(fenced("json", '{"questions":[]}'))).toBeNull();
    // Right key, no options to click: not a card, so not promoted.
    expect(
      findQuestionsBlock(fenced("json", '{"questions":[{"question":"hi"}]}')),
    ).toBeNull();
    expect(
      findQuestionsBlock(fenced("ts", "const questions = [];")),
    ).toBeNull();
  });

  it("does not treat a real code fence as questions just for saying the word", () => {
    expect(
      findQuestionsBlock(fenced("python", 'questions = {"questions": []}')),
    ).toBeNull();
  });

  it("finds the payload when an unrelated block comes first", () => {
    const text = `${fenced("ts", "const a = 1;")}\n\n${fenced("rift")}`;
    expect(findQuestionsBlock(text)?.data.questions).toHaveLength(1);
  });

  // The fence regex is module-level and /g is stateful: without resetting
  // lastIndex, the second call would resume mid-string and find nothing.
  it("is not stateful across calls", () => {
    const text = fenced("rift");
    expect(findQuestionsBlock(text)).not.toBeNull();
    expect(findQuestionsBlock(text)).not.toBeNull();
  });

  it("ignores a block whose closing fence has not arrived", () => {
    expect(findQuestionsBlock("```rift\n" + PAYLOAD)).toBeNull();
  });
});

describe("findOpenQuestionsFence", () => {
  it("reports where a half-streamed questions payload begins", () => {
    const text = 'Düşünüyorum...\n\n```rift\n{"questions":[{"id":"ty';
    const at = findOpenQuestionsFence(text);
    expect(at).not.toBeNull();
    expect(text.slice(0, at!).trim()).toBe("Düşünüyorum...");
  });

  // Widening the accepted labels to include `json` would otherwise blank any
  // reply still streaming an ordinary JSON block.
  it("does not hide an ordinary JSON block that is still streaming", () => {
    expect(findOpenQuestionsFence('```json\n{"user":{"na')).toBeNull();
  });

  it("does not hide a normal code block that is still streaming", () => {
    expect(findOpenQuestionsFence('```ts\nconst q = {"questions":')).toBeNull();
  });

  it("reports nothing once the fence is closed", () => {
    expect(findOpenQuestionsFence(fenced("rift"))).toBeNull();
  });
});

describe("parsePlanQuestions", () => {
  it("keeps only entries that can actually be rendered as a card", () => {
    const data = parsePlanQuestions(
      JSON.stringify({
        questions: [
          { question: "ok", options: [{ label: "a" }] },
          { question: "no options" },
          { options: [{ label: "no question" }] },
        ],
      }),
    );
    expect(data?.questions).toHaveLength(1);
    expect(data?.questions[0].question).toBe("ok");
  });

  it("returns null on malformed JSON rather than throwing", () => {
    expect(parsePlanQuestions("{not json")).toBeNull();
  });
});

describe("pendingPlanQuestion", () => {
  const { pendingPlanQuestion } = require("../plan-questions");
  const assistant = {
    id: "answer",
    role: "assistant",
    parts: [{ type: "text", text: fenced("rift-questions") }],
  };
  it("docks only the newest unanswered assistant question", () => {
    expect(pendingPlanQuestion([assistant])).toMatchObject({
      key: "answer:0:0",
    });
    expect(
      pendingPlanQuestion([
        assistant,
        { id: "reply", role: "user", parts: [] },
      ]),
    ).toBeNull();
    expect(
      pendingPlanQuestion([
        assistant,
        {
          id: "next",
          role: "assistant",
          parts: [{ type: "text", text: "Done" }],
        },
      ]),
    ).toBeNull();
  });
  it("ignores incomplete question JSON and preserves identity as text streams after it", () => {
    expect(
      pendingPlanQuestion([
        {
          ...assistant,
          parts: [{ type: "text", text: '```rift-questions\n{"questions": [' }],
        },
      ]),
    ).toBeNull();
    const completed = pendingPlanQuestion([assistant]);
    const streamed = pendingPlanQuestion([
      {
        ...assistant,
        parts: [
          { type: "text", text: fenced("rift-questions") + "\nMore context" },
        ],
      },
    ]);
    expect(streamed.key).toBe(completed.key);
  });
});
