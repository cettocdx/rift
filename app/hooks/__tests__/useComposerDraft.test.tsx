import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  InputProvider,
  useInputApi,
  useInputValue,
} from "@/app/contexts/InputContext";
import { useComposerDraft } from "../useComposerDraft";
import { newChatDraftId } from "@/lib/composer/draft-id";

let mockEpoch = 0;
const mockDrafts = new Map<string, string>();
jest.mock("@/lib/utils/client-storage", () => ({
  getDraftEpoch: () => mockEpoch,
  getDraftContentById: (id: string) => mockDrafts.get(id) ?? null,
  upsertDraft: (id: string, value: string) => mockDrafts.set(id, value),
  removeDraft: (id: string) => mockDrafts.delete(id),
}));
function Composer({
  id,
  conversationId,
}: {
  id: string;
  conversationId?: string;
}) {
  useComposerDraft(id, conversationId);
  const value = useInputValue();
  const { setInput, clearInput } = useInputApi();
  return (
    <>
      <textarea
        aria-label="Draft"
        value={value}
        onChange={(e) => setInput(e.target.value)}
      />
      <button onClick={clearInput}>Send</button>
    </>
  );
}
function View({
  id,
  visible = true,
  conversationId,
}: {
  id: string;
  visible?: boolean;
  conversationId?: string;
}) {
  return (
    <InputProvider>
      {visible && <Composer id={id} conversationId={conversationId} />}
    </InputProvider>
  );
}
beforeEach(() => {
  mockDrafts.clear();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});
test("separates Build and Studio drafts without leaking text after a fast navigation", () => {
  const build = newChatDraftId("app");
  const studio = newChatDraftId("image");
  mockDrafts.set(build, "Build this app");
  const view = render(<View id={build} />);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Latest Build character!" },
  });
  view.rerender(<View id={studio} />);
  expect(screen.getByRole("textbox")).toHaveValue("");
  expect(mockDrafts.get(build)).toBe("Latest Build character!");
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Draw this" },
  });
  view.rerender(<View id={build} />);
  expect(screen.getByRole("textbox")).toHaveValue("Latest Build character!");
  act(() => jest.advanceTimersByTime(600));
  expect(mockDrafts.get(studio)).toBe("Draw this");
});
test("flushes the last character on unmount before the debounce fires", () => {
  const view = render(<View id="new" />);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Not lost" },
  });
  view.rerender(<View id="new" visible={false} />);
  expect(mockDrafts.get("new")).toBe("Not lost");
  view.rerender(<View id="new" />);
  expect(screen.getByRole("textbox")).toHaveValue("Not lost");
});
test("restores an existing conversation's draft instead of overwriting it", () => {
  mockDrafts.set("older-chat", "Existing draft");
  const view = render(<View id="new" conversationId="new-chat" />);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "New draft" },
  });
  view.rerender(<View id="older-chat" conversationId="older-chat" />);
  expect(screen.getByRole("textbox")).toHaveValue("Existing draft");
});
test("preserves a follow-up when its own new conversation is promoted", () => {
  const view = render(<View id="new" conversationId="same-chat" />);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Follow up" },
  });
  view.rerender(<View id="same-chat" conversationId="same-chat" />);
  expect(screen.getByRole("textbox")).toHaveValue("Follow up");
  expect(mockDrafts.get("same-chat")).toBe("Follow up");
  expect(mockDrafts.has("new")).toBe(false);
});
test("does not resurrect a submitted draft on unmount", () => {
  mockDrafts.set("new", "Send this");
  const view = render(<View id="new" />);
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  view.unmount();
  expect(mockDrafts.has("new")).toBe(false);
});

test("does not restore drafts cleared during sign-out", () => {
  const view = render(<View id="new" />);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Private draft" },
  });
  mockDrafts.clear();
  mockEpoch += 1;
  act(() => jest.advanceTimersByTime(600));
  view.unmount();
  expect(mockDrafts.size).toBe(0);
});
