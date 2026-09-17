"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useInputApi, useInputValue } from "@/app/contexts/InputContext";
import {
  getDraftContentById,
  getDraftEpoch,
  removeDraft,
  upsertDraft,
} from "@/lib/utils/client-storage";
import { isNewChatDraft } from "@/lib/composer/draft-id";

function persist(id: string, value: string, epoch: number) {
  if (getDraftEpoch() !== epoch) return;
  const stored = getDraftContentById(id);
  if (value.trim()) {
    if (stored !== value) upsertDraft(id, value);
  } else if (stored !== null) removeDraft(id);
}

/** Restore before paint and flush synchronously when leaving the composer. */
export function useComposerDraft(draftId: string, conversationId?: string) {
  const input = useInputValue();
  const { inputRef, setInput } = useInputApi();
  const epoch = useRef(getDraftEpoch());
  const previous = useRef<{ draftId: string; conversationId?: string } | null>(
    null,
  );

  useLayoutEffect(() => {
    epoch.current = getDraftEpoch();
    const ownerEpoch = epoch.current;
    // Capture the ref object, not its value: flush the latest text on navigation.
    const ownedInput = inputRef;
    const prior = previous.current;
    // Preserve a follow-up typed during the first response only when that
    // same conversation becomes durable, never when navigating to another one.
    const promoted =
      prior &&
      isNewChatDraft(prior.draftId) &&
      prior.conversationId === draftId &&
      !isNewChatDraft(draftId);
    if (promoted) {
      persist(draftId, inputRef.current, ownerEpoch);
      removeDraft(prior.draftId);
    } else {
      setInput(getDraftContentById(draftId) || "");
    }
    previous.current = { draftId, conversationId };
    return () => persist(draftId, ownedInput.current, ownerEpoch);
  }, [draftId, conversationId, inputRef, setInput]);

  useEffect(() => {
    // Read the synchronous API ref: restoration may have occurred in the
    // layout effect after this render captured the previous screen's input.
    const handle = window.setTimeout(
      () => persist(draftId, inputRef.current, epoch.current),
      500,
    );
    const flush = () => persist(draftId, inputRef.current, epoch.current);
    window.addEventListener("pagehide", flush);
    return () => {
      window.clearTimeout(handle);
      window.removeEventListener("pagehide", flush);
    };
  }, [input, draftId, inputRef]);
}
