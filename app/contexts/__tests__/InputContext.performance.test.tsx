import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  InputProvider,
  useInputApi,
  useInputHasText,
  useInputValue,
} from "@/app/contexts/InputContext";

const transcriptRowRender = jest.fn();
const apiOnlyRender = jest.fn();
const sendButtonRender = jest.fn();
const readLatestInput = jest.fn();

function TranscriptRow({ index }: { index: number }) {
  transcriptRowRender(index);
  return <div>Transcript row {index + 1}</div>;
}

function ComposerProbe() {
  const input = useInputValue();
  const { setInput } = useInputApi();

  return (
    <textarea
      aria-label="Composer"
      value={input}
      onChange={(event) => setInput(event.target.value)}
    />
  );
}

/** Stands in for the send button: needs "is there anything to send", not the text. */
function SendButtonProbe() {
  const hasText = useInputHasText();
  sendButtonRender(hasText);

  return (
    <button type="button" disabled={!hasText}>
      Send
    </button>
  );
}

function ApiOnlyProbe() {
  const { inputRef } = useInputApi();
  apiOnlyRender();

  return (
    <button type="button" onClick={() => readLatestInput(inputRef.current)}>
      Read latest input
    </button>
  );
}

describe("InputContext typing isolation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps a 200-row transcript and API-only consumers out of the keystroke render path", async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 200 }, (_, index) => (
      <TranscriptRow key={index} index={index} />
    ));

    render(
      <InputProvider>
        <div>{rows}</div>
        <ComposerProbe />
        <ApiOnlyProbe />
      </InputProvider>,
    );

    expect(transcriptRowRender).toHaveBeenCalledTimes(200);
    expect(apiOnlyRender).toHaveBeenCalledTimes(1);

    const typed = "Cursor-parity typing remains isolated from transcript rows.";
    await user.type(screen.getByRole("textbox", { name: "Composer" }), typed);

    expect(screen.getByRole("textbox", { name: "Composer" })).toHaveValue(
      typed,
    );
    expect(transcriptRowRender).toHaveBeenCalledTimes(200);
    expect(apiOnlyRender).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Read latest input" }));
    expect(readLatestInput).toHaveBeenCalledWith(typed);
  });

  it("re-renders the send button only when the composer flips empty ↔ sendable", async () => {
    const user = userEvent.setup();

    render(
      <InputProvider>
        <ComposerProbe />
        <SendButtonProbe />
      </InputProvider>,
    );

    const composer = screen.getByRole("textbox", { name: "Composer" });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(sendButtonRender).toHaveBeenCalledTimes(1);

    // Ten characters, one flip: the first one. The other nine must be free.
    await user.type(composer, "production");

    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
    expect(sendButtonRender).toHaveBeenCalledTimes(2);

    // Emptying it flips back exactly once, however many backspaces it takes.
    await user.clear(composer);

    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(sendButtonRender).toHaveBeenCalledTimes(3);
  });
});
