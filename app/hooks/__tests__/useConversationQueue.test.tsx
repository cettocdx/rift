import { useLayoutEffect } from "react";
import { act, render, renderHook, screen } from "@testing-library/react";
import type { FileMessagePart } from "@/types/file";
import { useConversationQueue } from "../useConversationQueue";

describe("conversation queue lifetime", () => {
  it("retains each chat's queue while another page or chat is active", () => {
    const { result } = renderHook(() => useConversationQueue("user-a"));
    act(() => result.current.setActiveQueueChat("chat-a"));
    act(() => result.current.queueMessage("Follow up A"));
    const original = result.current.messageQueue[0];

    act(() => result.current.setActiveQueueChat(null));
    expect(result.current.activeQueueChatId).toBeNull();
    expect(result.current.messageQueue).toEqual([]);

    act(() => result.current.setActiveQueueChat("chat-b"));
    expect(result.current.messageQueue).toEqual([]);
    act(() => result.current.queueMessage("Follow up B"));
    expect(result.current.messageQueue.map((message) => message.text)).toEqual([
      "Follow up B",
    ]);

    act(() => result.current.setActiveQueueChat("chat-a"));
    expect(result.current.messageQueue).toEqual([original]);
    act(() => result.current.setActiveQueueChat("chat-b"));
    expect(result.current.messageQueue.map((message) => message.text)).toEqual([
      "Follow up B",
    ]);
  });

  it("never creates or clears hidden queue data without a chat binding", () => {
    const { result } = renderHook(() => useConversationQueue("user-a"));
    act(() => result.current.setActiveQueueChat("chat-a"));
    act(() => result.current.queueMessage("Keep me"));
    act(() => result.current.setActiveQueueChat(null));
    act(() => {
      result.current.queueMessage("Unbound message");
      result.current.clearQueue();
    });
    act(() => result.current.setActiveQueueChat("chat-a"));
    expect(result.current.messageQueue.map((message) => message.text)).toEqual([
      "Keep me",
    ]);
  });

  it("keeps delayed remove and clear callbacks scoped to the originating conversation", () => {
    const { result } = renderHook(() => useConversationQueue("user-a"));
    act(() => result.current.setActiveQueueChat("chat-a"));
    act(() => {
      result.current.queueMessage("A1");
      result.current.queueMessage("A2");
    });
    const removeFromA = result.current.removeQueuedMessage;
    const clearA = result.current.clearQueue;
    const firstId = result.current.messageQueue[0].id;
    act(() => result.current.setActiveQueueChat("chat-b"));
    act(() => result.current.queueMessage("B1"));
    act(() => removeFromA(firstId));
    expect(result.current.messageQueue.map((message) => message.text)).toEqual([
      "B1",
    ]);
    act(() => result.current.setActiveQueueChat("chat-a"));
    expect(result.current.messageQueue.map((message) => message.text)).toEqual([
      "A2",
    ]);
    act(() => result.current.setActiveQueueChat("chat-b"));
    act(() => clearA());
    expect(result.current.messageQueue.map((message) => message.text)).toEqual([
      "B1",
    ]);
    act(() => result.current.setActiveQueueChat("chat-a"));
    expect(result.current.messageQueue).toEqual([]);
  });

  it("preserves FIFO ordering and attachments with a ten-message limit per chat", () => {
    const { result } = renderHook(() => useConversationQueue("user-a"));
    const files: FileMessagePart[] = [
      {
        type: "file",
        mediaType: "text/plain",
        name: "notes.txt",
        size: 25,
        fileId: "notes-file-id",
      },
    ];
    act(() => result.current.setActiveQueueChat("chat-a"));
    act(() => {
      for (let index = 0; index < 12; index += 1) {
        result.current.queueMessage(
          `A${index}`,
          index === 0 ? files : undefined,
        );
      }
    });
    expect(result.current.messageQueue.map((message) => message.text)).toEqual(
      Array.from({ length: 10 }, (_, index) => `A${index}`),
    );
    expect(result.current.messageQueue[0].files).toEqual(files);
    expect(
      new Set(result.current.messageQueue.map((message) => message.id)).size,
    ).toBe(10);
    act(() => result.current.setActiveQueueChat("chat-b"));
    act(() => result.current.queueMessage("B0"));
    expect(result.current.messageQueue).toHaveLength(1);
  });

  it("retains queues during a transient auth refresh", () => {
    const { result, rerender } = renderHook(
      ({ owner }: { owner: string | undefined }) => useConversationQueue(owner),
      { initialProps: { owner: "user-a" as string | undefined } },
    );
    act(() => result.current.setActiveQueueChat("chat-a"));
    act(() => result.current.queueMessage("Pending instruction"));
    rerender({ owner: undefined });
    expect(result.current.messageQueue).toHaveLength(1);
    rerender({ owner: "user-a" });
    expect(result.current.messageQueue[0].text).toBe("Pending instruction");
  });

  it("clears all conversations on logout and prevents old callbacks resurrecting them after login", () => {
    const { result, rerender } = renderHook(
      ({ owner }: { owner: string | null }) => useConversationQueue(owner),
      { initialProps: { owner: "user-a" as string | null } },
    );
    act(() => result.current.setActiveQueueChat("chat-a"));
    act(() => result.current.queueMessage("Old A"));
    const oldQueueMessage = result.current.queueMessage;
    act(() => result.current.setActiveQueueChat("chat-b"));
    act(() => result.current.queueMessage("Old B"));
    rerender({ owner: null });
    expect(result.current.activeQueueChatId).toBeNull();
    expect(result.current.messageQueue).toEqual([]);
    rerender({ owner: "user-a" });
    act(() => result.current.setActiveQueueChat("chat-a"));
    act(() => oldQueueMessage("Late previous-session callback"));
    expect(result.current.messageQueue).toEqual([]);
    act(() => result.current.setActiveQueueChat("chat-b"));
    expect(result.current.messageQueue).toEqual([]);
  });

  it("does not expose another account's queues when accounts switch directly", () => {
    const { result, rerender } = renderHook(
      ({ owner }) => useConversationQueue(owner),
      { initialProps: { owner: "user-a" } },
    );
    act(() => result.current.setActiveQueueChat("shared-chat-id"));
    act(() => result.current.queueMessage("Account A instruction"));
    rerender({ owner: "user-b" });
    expect(result.current.activeQueueChatId).toBeNull();
    act(() => result.current.setActiveQueueChat("shared-chat-id"));
    expect(result.current.messageQueue).toEqual([]);
  });

  it("keeps the binding callback stable across queue and chat changes", () => {
    const { result } = renderHook(() => useConversationQueue("user-a"));
    const bind = result.current.setActiveQueueChat;
    act(() => bind("chat-a"));
    act(() => result.current.queueMessage("Instruction"));
    act(() => bind("chat-b"));
    expect(result.current.setActiveQueueChat).toBe(bind);
  });
});

describe("explicit queue acceptance", () => {
  it("reports exactly ten synchronous accepts for a batched burst and reopens capacity after removal", () => {
    const { result } = renderHook(() => useConversationQueue("owner"));
    act(() => result.current.setActiveQueueChat("chat"));
    let receipts: unknown[] = [];
    act(() => {
      receipts = Array.from({ length: 11 }, (_, i) =>
        result.current.queueMessage(`item-${i}`),
      );
    });
    expect(receipts.slice(0, 10)).toEqual(
      result.current.messageQueue.map((message) => ({
        accepted: true,
        id: message.id,
      })),
    );
    expect(receipts[10]).toEqual({ accepted: false, reason: "full" });
    let next: unknown;
    act(() => {
      result.current.removeQueuedMessage(result.current.messageQueue[0].id);
      next = result.current.queueMessage("replacement");
    });
    expect(next).toEqual({
      accepted: true,
      id: result.current.messageQueue[9].id,
    });
    expect(result.current.messageQueue).toHaveLength(10);
  });
  it("rejects unbound and retired account callbacks explicitly", () => {
    const { result, rerender } = renderHook(
      ({ owner }) => useConversationQueue(owner),
      { initialProps: { owner: "a" } },
    );
    expect(result.current.queueMessage("unbound")).toEqual({
      accepted: false,
      reason: "unbound",
    });
    act(() => result.current.setActiveQueueChat("chat"));
    const old = result.current.queueMessage;
    rerender({ owner: "b" });
    act(() => result.current.setActiveQueueChat("chat"));
    expect(old("late")).toEqual({ accepted: false, reason: "stale-owner" });
    expect(result.current.messageQueue).toEqual([]);
  });
});

it("binds a new account from a child layout effect before the provider layout effect", () => {
  function Binding({ bind }: { bind: (id: string) => void }) {
    useLayoutEffect(() => bind("chat"), [bind]);
    return null;
  }
  function Parent({ owner }: { owner: string }) {
    const queue = useConversationQueue(owner);
    return (
      <>
        <Binding bind={queue.setActiveQueueChat} />
        <output>{queue.activeQueueChatId ?? "unbound"}</output>
      </>
    );
  }
  const view = render(<Parent owner="a" />);
  expect(screen.getByText("chat")).toBeInTheDocument();
  view.rerender(<Parent owner="b" />);
  expect(screen.getByText("chat")).toBeInTheDocument();
});

describe("queued dispatch ownership", () => {
  it("claims synchronously once, keeps attachments until acceptance, and blocks a second dispatch", () => {
    const { result } = renderHook(() => useConversationQueue("owner"));
    act(() => result.current.setActiveQueueChat("chat"));
    act(() => {
      result.current.queueMessage("first");
      result.current.queueMessage("second");
    });
    let attempt: ReturnType<typeof result.current.claimQueuedMessage>;
    act(() => {
      attempt = result.current.claimQueuedMessage(
        result.current.messageQueue[0].id,
      );
      expect(
        result.current.claimQueuedMessage(result.current.messageQueue[0].id),
      ).toBeNull();
      expect(
        result.current.claimQueuedMessage(result.current.messageQueue[1].id),
      ).toBeNull();
    });
    expect(result.current.messageQueue).toHaveLength(2);
    expect(result.current.messageQueue[0].dispatchState).toBe("sending");
    act(() => attempt!.accepted());
    expect(result.current.messageQueue.map((m) => m.text)).toEqual(["second"]);
    act(() => attempt!.failed());
    expect(result.current.messageQueue.map((m) => m.text)).toEqual(["second"]);
  });

  it("retains uncertain delivery and never automatically reclaims it", () => {
    const { result } = renderHook(() => useConversationQueue("owner"));
    act(() => result.current.setActiveQueueChat("chat"));
    act(() => result.current.queueMessage("keep me"));
    let attempt: ReturnType<typeof result.current.claimQueuedMessage>;
    act(() => {
      attempt = result.current.claimQueuedMessage(
        result.current.messageQueue[0].id,
      );
    });
    act(() => attempt!.failed());
    expect(result.current.messageQueue[0].dispatchState).toBe("unconfirmed");
    expect(
      result.current.claimQueuedMessage(result.current.messageQueue[0].id),
    ).toBeNull();
    act(() => attempt!.accepted());
    expect(result.current.messageQueue).toHaveLength(1);
    // Reviewing/removing an uncertain entry is explicit; no timer unlocks it.
    act(() =>
      result.current.removeQueuedMessage(result.current.messageQueue[0].id),
    );
    expect(result.current.messageQueue).toEqual([]);
  });

  it("settles the originating chat after navigation and rejects retired account callbacks", () => {
    const { result, rerender } = renderHook(
      ({ owner }) => useConversationQueue(owner),
      { initialProps: { owner: "a" } },
    );
    act(() => result.current.setActiveQueueChat("chat-a"));
    act(() => result.current.queueMessage("A"));
    let attempt: ReturnType<typeof result.current.claimQueuedMessage>;
    act(() => {
      attempt = result.current.claimQueuedMessage(
        result.current.messageQueue[0].id,
      );
    });
    act(() => result.current.setActiveQueueChat("chat-b"));
    act(() => result.current.queueMessage("B"));
    act(() => attempt!.accepted());
    expect(result.current.messageQueue[0].text).toBe("B");
    act(() => result.current.setActiveQueueChat("chat-a"));
    expect(result.current.messageQueue).toEqual([]);
    act(() => result.current.queueMessage("old"));
    const oldClaim = result.current.claimQueuedMessage;
    const oldId = result.current.messageQueue[0].id;
    rerender({ owner: "b" });
    expect(oldClaim(oldId)).toBeNull();
  });

  it("restores a cancelled-before-dispatch entry and ignores later acceptance", () => {
    const { result } = renderHook(() => useConversationQueue("owner"));
    act(() => result.current.setActiveQueueChat("chat"));
    act(() => result.current.queueMessage("keep"));
    let attempt: ReturnType<typeof result.current.claimQueuedMessage>;
    act(() => {
      attempt = result.current.claimQueuedMessage(
        result.current.messageQueue[0].id,
      );
    });
    act(() => attempt!.restore());
    expect(result.current.messageQueue[0].dispatchState).toBeUndefined();
    act(() => attempt!.accepted());
    expect(result.current.messageQueue).toHaveLength(1);
  });
});

describe("queue dispatch authentication", () => {
  it("retains drafts but blocks new and retained dispatch callbacks while auth resolves", () => {
    const { result, rerender } = renderHook(
      ({ owner }: { owner: string | null | undefined }) =>
        useConversationQueue(owner),
      {
        initialProps: { owner: "user-a" } as {
          owner: string | null | undefined;
        },
      },
    );
    act(() => result.current.setActiveQueueChat("chat-a"));
    act(() => result.current.queueMessage("Wait for verified authentication"));
    const id = result.current.messageQueue[0].id;
    const retainedClaim = result.current.claimQueuedMessage;
    rerender({ owner: undefined });
    expect(result.current.messageQueue).toHaveLength(1);
    let currentAttempt: unknown;
    let retainedAttempt: unknown;
    act(() => {
      currentAttempt = result.current.claimQueuedMessage(id);
      retainedAttempt = retainedClaim(id);
    });
    expect(currentAttempt).toBeNull();
    expect(retainedAttempt).toBeNull();
    expect(result.current.messageQueue[0].dispatchState).toBeUndefined();
    rerender({ owner: "user-a" });
    let resumed: ReturnType<typeof result.current.claimQueuedMessage>;
    act(() => {
      resumed = result.current.claimQueuedMessage(id);
    });
    expect(resumed!).not.toBeNull();
  });

  it("revokes permission to send after cancellation when auth becomes unresolved", () => {
    const { result, rerender } = renderHook(
      ({ owner }: { owner: string | undefined }) => useConversationQueue(owner),
      { initialProps: { owner: "user-a" } as { owner: string | undefined } },
    );
    act(() => result.current.setActiveQueueChat("chat-a"));
    act(() =>
      result.current.queueMessage("Do not dispatch during auth transition"),
    );
    let attempt: ReturnType<typeof result.current.claimQueuedMessage>;
    act(() => {
      attempt = result.current.claimQueuedMessage(
        result.current.messageQueue[0].id,
      );
    });
    expect(attempt!.isCurrent()).toBe(true);
    rerender({ owner: undefined });
    expect(attempt!.isCurrent()).toBe(false);
    act(() => attempt!.restore());
    expect(result.current.messageQueue[0].dispatchState).toBeUndefined();
  });
});
