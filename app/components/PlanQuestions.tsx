"use client";

import { createContext, useId, useRef, useState } from "react";
import {
  Check,
  ArrowRight,
  MessageCircleQuestion,
  Pencil,
  X,
  ChevronDown,
} from "lucide-react";
import styles from "./PlanQuestions.module.css";
import { submitChatMessage } from "@/lib/utils/submit-message";

/** Clarifying questions use the normal message path; selections require explicit Send. */
import type { PlanQuestionsData } from "@/lib/chat/plan-questions";

// Re-exported so existing call sites keep importing these from the component
// they belong to, while the logic itself stays testable without React.
export {
  parsePlanQuestions,
  type PlanQuestion,
  type PlanQuestionOption,
  type PlanQuestionsData,
} from "@/lib/chat/plan-questions";

export const DockedQuestionContext = createContext<string | null>(null);

export function PlanQuestions({
  data,
  readOnly = false,
}: {
  data: PlanQuestionsData;
  readOnly?: boolean;
}) {
  const id = useId();
  const sentRef = useRef(false);
  const [collapsed, setCollapsed] = useState(readOnly);
  const [skipped, setSkipped] = useState(false);
  const OTHER_VALUE = "__rift_other__";
  // selections[qIndex] = set of chosen option labels
  const [selections, setSelections] = useState<Record<number, string[]>>({});
  const [otherAnswers, setOtherAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);

  const sendAnswer = async (text: string, skipAnswer = false) => {
    if (sentRef.current) return;
    sentRef.current = true;
    setSending(true);
    setSendFailed(false);
    try {
      const accepted = await submitChatMessage(text);
      if (accepted) {
        setSubmitted(true);
        setSkipped(skipAnswer);
      } else {
        sentRef.current = false;
        setSendFailed(true);
      }
    } catch {
      sentRef.current = false;
      setSendFailed(true);
    } finally {
      setSending(false);
    }
  };

  const toggle = (qi: number, label: string, multi: boolean) => {
    if (submitted || sending) return;
    setSelections((prev) => {
      const cur = prev[qi] ?? [];
      if (multi) {
        return {
          ...prev,
          [qi]: cur.includes(label)
            ? cur.filter((l) => l !== label)
            : [...cur, label],
        };
      }
      return { ...prev, [qi]: cur.includes(label) ? [] : [label] };
    });
  };

  const selectOther = (qi: number, multi: boolean) => {
    if (submitted || sending) return;
    setSelections((prev) => {
      const current = prev[qi] ?? [];
      if (multi) {
        return current.includes(OTHER_VALUE)
          ? prev
          : { ...prev, [qi]: [...current, OTHER_VALUE] };
      }
      return { ...prev, [qi]: [OTHER_VALUE] };
    });
  };

  const updateOther = (qi: number, value: string, multi: boolean) => {
    setOtherAnswers((prev) => ({ ...prev, [qi]: value }));
    if (value.trim()) selectOther(qi, multi);
  };

  const answeredCount = data.questions.filter((_, qi) => {
    const selected = selections[qi] ?? [];
    return selected.some(
      (value) => value !== OTHER_VALUE || Boolean(otherAnswers[qi]?.trim()),
    );
  }).length;
  const canSubmit =
    data.questions.length > 0 &&
    answeredCount === data.questions.length &&
    !submitted &&
    !sending &&
    !readOnly;

  const handleSubmit = () => {
    if (!canSubmit || sentRef.current) return;
    const lines = data.questions
      .map((q, qi) => {
        const chosen = (selections[qi] ?? []).flatMap((value) =>
          value === OTHER_VALUE
            ? otherAnswers[qi]?.trim()
              ? [`Custom answer: ${otherAnswers[qi].trim()}`]
              : []
            : [value],
        );
        if (chosen.length === 0) return null;
        return `- ${q.question} → ${chosen.join(", ")}`;
      })
      .filter(Boolean);
    if (lines.length === 0) return;
    void sendAnswer(`Here are my choices:\n${lines.join("\n")}`);
  };

  const skip = () => {
    if (sentRef.current || readOnly) return;
    void sendAnswer(
      `I skipped these questions without choosing an answer:
${data.questions.map((q) => `- ${q.question}`).join("\n")}
Do not treat this as approval or assume a selection. Continue only with work that does not depend on these answers.`,
      true,
    );
  };
  const locked = submitted || sending || readOnly;
  return (
    <section
      className={styles.card}
      aria-label="Agent question"
      aria-busy={sending}
    >
      <header className={styles.header}>
        <MessageCircleQuestion size={15} strokeWidth={1.7} aria-hidden="true" />
        <span>{data.questions.length > 1 ? "Questions" : "Question"}</span>
        {(submitted || readOnly) && (
          <span className={styles.state} role="status">
            {readOnly
              ? "Previous question"
              : skipped
                ? "Skipped"
                : "Answer sent"}
          </span>
        )}
        <button
          type="button"
          aria-label={collapsed ? "Show question" : "Collapse question"}
          aria-expanded={!collapsed}
          aria-controls={id}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <ChevronDown size={15} /> : <X size={15} />}
        </button>
      </header>
      {!collapsed && (
        <div id={id}>
          <div className={styles.questions}>
            {data.questions.map((q, qi) => {
              const chosen = selections[qi] ?? [];
              return (
                <div className={styles.question} key={q.id ?? qi}>
                  <p className={styles.prompt}>{q.question}</p>
                  {q.multi && (
                    <p className={styles.hint}>Select any that apply</p>
                  )}
                  <div
                    className={styles.options}
                    role={q.multi ? "group" : "radiogroup"}
                    aria-label={q.question}
                  >
                    {q.options.map((opt, optionIndex) => {
                      const active = chosen.includes(opt.label);
                      return (
                        <button
                          key={`${optionIndex}:${opt.label}`}
                          type="button"
                          disabled={locked}
                          role={q.multi ? "checkbox" : "radio"}
                          aria-checked={active}
                          className={styles.option}
                          onClick={() => toggle(qi, opt.label, !!q.multi)}
                          onKeyDown={(event) => {
                            if (
                              q.multi ||
                              ![
                                "ArrowDown",
                                "ArrowUp",
                                "ArrowLeft",
                                "ArrowRight",
                              ].includes(event.key)
                            )
                              return;
                            event.preventDefault();
                            const direction =
                              event.key === "ArrowDown" ||
                              event.key === "ArrowRight"
                                ? 1
                                : -1;
                            const next =
                              (optionIndex + direction + q.options.length) %
                              q.options.length;
                            setSelections((prev) => ({
                              ...prev,
                              [qi]: [q.options[next].label],
                            }));
                            (
                              event.currentTarget.parentElement?.children[
                                next
                              ] as HTMLButtonElement
                            )?.focus();
                          }}
                        >
                          <span className={styles.number} aria-hidden="true">
                            {q.multi && active ? (
                              <Check size={13} />
                            ) : (
                              optionIndex + 1
                            )}
                          </span>
                          <span className={styles.optionCopy}>
                            <span className={styles.label}>
                              {opt.label}
                              {opt.recommended && (
                                <span className={styles.recommended}>
                                  Recommended
                                </span>
                              )}
                            </span>
                            {opt.detail && (
                              <span className={styles.detail}>
                                {opt.detail}
                              </span>
                            )}
                          </span>
                          <ArrowRight
                            size={15}
                            className={styles.arrow}
                            aria-hidden="true"
                          />
                        </button>
                      );
                    })}
                  </div>
                  {q.allowOther !== false && (
                    <label
                      className={styles.custom}
                      data-selected={chosen.includes(OTHER_VALUE)}
                    >
                      <span className={styles.number}>
                        <Pencil size={13} aria-hidden="true" />
                      </span>
                      <textarea
                        rows={1}
                        value={otherAnswers[qi] ?? ""}
                        disabled={locked}
                        onFocus={() => {
                          if (otherAnswers[qi]?.trim())
                            selectOther(qi, !!q.multi);
                        }}
                        onChange={(event) =>
                          updateOther(qi, event.target.value, !!q.multi)
                        }
                        placeholder={
                          q.placeholder ?? "Or write your own response"
                        }
                        aria-label={`Custom answer: ${q.question}`}
                      />
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          {sendFailed && (
            <p className={styles.hint} role="alert">
              Your answer was not confirmed. Your choices are kept. Check the
              chat status before trying again.
            </p>
          )}
          {!readOnly && (
            <footer className={styles.footer}>
              <span className={styles.hint} role="status">
                {submitted
                  ? skipped
                    ? "No answer selected."
                    : "Choices sent."
                  : data.questions.length > 1
                    ? `${answeredCount}/${data.questions.length} answered`
                    : ""}
              </span>
              <button
                className={styles.skip}
                type="button"
                disabled={locked}
                onClick={skip}
              >
                Skip
              </button>
              <button
                className={styles.send}
                type="button"
                disabled={!canSubmit}
                onClick={handleSubmit}
              >
                {sending ? "Sending…" : submitted ? "Sent" : "Send"}
              </button>
            </footer>
          )}
        </div>
      )}
    </section>
  );
}
