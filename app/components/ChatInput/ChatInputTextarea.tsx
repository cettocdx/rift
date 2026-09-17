"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { useInputValue, useInputApi } from "@/app/contexts/InputContext";
import { useFileUpload } from "@/app/hooks/useFileUpload";
import { useComposerDraft } from "@/app/hooks/useComposerDraft";
import { countInputTokens } from "@/lib/client-token-estimate";
import { getMessageTokenBudget } from "@/lib/token-limits";
import { toast } from "sonner";
import type { ChatMode } from "@/types/chat";
import { ComposerPalette } from "./ComposerPalette";
import {
  ComposerCommandPaint,
  COMPOSER_TEXT_METRICS_CLASS,
} from "./ComposerCommandPaint";
import { splitComposerCommand } from "@/lib/composer/command-highlight";
import { useProShell } from "@/app/components/pro/ProShellContext";
import { useIsMobile } from "@/hooks/use-mobile";
import commandPaintStyles from "./ComposerCommandPaint.module.css";

export interface ChatInputTextareaProps {
  draftId: string;
  conversationId?: string;
  chatMode: ChatMode;
  onEnterSubmit: (e: React.FormEvent) => void;
  disabled?: boolean;
  minRows?: number;
  placeholder?: string;
  autoFocus?: boolean;
  isCentered?: boolean;
}

export function ChatInputTextarea({
  draftId,
  conversationId,
  chatMode,
  onEnterSubmit,
  disabled = false,
  minRows = 1,
  placeholder,
  autoFocus = true,
  isCentered = false,
}: ChatInputTextareaProps) {
  const { chatPurpose, subscription, selectedModel, hasPaidContext } =
    useGlobalState();
  const { enabled: proShell } = useProShell();
  const isMobile = useIsMobile();
  const input = useInputValue();
  const { setInput, clearInput } = useInputApi();
  const { handlePasteEvent } = useFileUpload(chatMode);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoFocusAttemptedRef = useRef(false);
  const [cursorAt, setCursorAt] = useState(input.length);
  const [inputRevision, setInputRevision] = useState(0);
  useComposerDraft(draftId, conversationId);

  useEffect(() => {
    // The mobile breakpoint resolves after mount. React's autoFocus only runs
    // at mount, so complete deferred desktop focus without taking focus from
    // navigation or a control the user has already chosen.
    if (!autoFocus || disabled || autoFocusAttemptedRef.current) return;
    autoFocusAttemptedRef.current = true;
    if (document.activeElement === document.body) {
      textareaRef.current?.focus({ preventScroll: true });
    }
  }, [autoFocus, disabled]);

  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (textareaRef.current !== document.activeElement) return;
      const clipboardData = e.clipboardData;
      if (!clipboardData) {
        await handlePasteEvent(e);
        return;
      }
      const pastedText = clipboardData.getData("text");
      if (!pastedText) {
        await handlePasteEvent(e);
        return;
      }
      const tokenCount = countInputTokens(pastedText, []);
      const maxTokens = getMessageTokenBudget(subscription, {
        mode: chatMode,
        model: selectedModel,
        purpose: chatPurpose,
        hasPaidContext,
      });
      if (tokenCount > maxTokens) {
        e.preventDefault();
        const planText = subscription !== "free" ? "" : " (Free plan limit)";
        toast.error("Content is too long to paste", {
          description: `The content you're trying to paste is too large (${tokenCount.toLocaleString()} tokens). Please copy a smaller amount${planText}.`,
        });
        return;
      }
      await handlePasteEvent(e);
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [
    handlePasteEvent,
    subscription,
    chatMode,
    selectedModel,
    chatPurpose,
    hasPaidContext,
  ]);

  const applyInput = useCallback(
    (next: string, cursorAt?: number) => {
      setInput(next);
      setInputRevision((revision) => revision + 1);
      const nextCursor = cursorAt ?? next.length;
      setCursorAt(nextCursor);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(nextCursor, nextCursor);
      });
    },
    [setInput],
  );
  const commandPainted = splitComposerCommand(input).some(
    (segment) => segment.kind === "command",
  );

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-col overflow-visible"
      data-ui="composer-textarea"
      data-layout={isCentered ? "hero" : "follow-up"}
    >
      <ComposerPalette
        input={input}
        inputRef={textareaRef}
        cursorAt={cursorAt}
        inputRevision={inputRevision}
        onApply={applyInput}
        onClear={clearInput}
        proShell={proShell}
        purpose={chatPurpose}
      />
      {/* Neutral recognition paint; the native textarea owns all input,
          selection and caret behavior. */}
      <ComposerCommandPaint input={input} textareaRef={textareaRef} />
      <TextareaAutosize
        ref={textareaRef}
        name="message"
        aria-label="Message RIFT"
        aria-keyshortcuts={isMobile ? undefined : "Enter"}
        enterKeyHint={isMobile ? "enter" : "send"}
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setInputRevision((revision) => revision + 1);
          setCursorAt(e.target.selectionStart ?? e.target.value.length);
        }}
        onSelect={(e) =>
          setCursorAt(e.currentTarget.selectionStart ?? input.length)
        }
        placeholder={
          placeholder !== undefined
            ? placeholder
            : "Plan, Build, / for commands, @ for context"
        }
        className={`relative flex min-h-9 max-h-[200px] w-full flex-auto resize-none overflow-y-auto border-0 bg-transparent ${COMPOSER_TEXT_METRICS_CLASS} shadow-none placeholder:text-[var(--cursor-text-tertiary)] focus-visible:outline-none disabled:cursor-not-allowed disabled:text-muted-foreground [scrollbar-color:var(--scrollbar-thumb)_transparent] [scrollbar-width:thin] ${
          commandPainted ? commandPaintStyles.paintedInput : "text-foreground"
        }`}
        minRows={minRows}
        autoFocus={autoFocus}
        disabled={disabled}
        data-testid="chat-input"
        onKeyDown={(e) => {
          if (e.defaultPrevented) return;
          /*
           * Never submit while an IME is composing.
           *
           * Turkish, Japanese, Korean and Chinese input all confirm a
           * candidate with Enter. Without this guard that first Enter
           * submitted the half-finished word instead of completing it, so the
           * message went out mid-composition and the composer cleared. There
           * was no `isComposing`, `keyCode === 229` or `compositionstart`
           * anywhere in the repo — the whole app assumed a Latin keyboard.
           *
           * `nativeEvent.isComposing` is the modern signal; `keyCode === 229`
           * is the long-standing fallback for browsers that fire keydown for
           * the composition without setting the flag.
           */
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          // A phone keyboard needs a normal Return key for multiline prompts.
          // Sending remains explicit through the visible send button.
          if (isMobile && !e.metaKey && !e.ctrlKey) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onEnterSubmit(e);
          }
        }}
      />
    </div>
  );
}
