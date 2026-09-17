import { fireEvent, render, screen } from "@testing-library/react";
import { QueuedMessagesPanel } from "../QueuedMessagesPanel";

describe("queue delivery feedback", () => {
  it("keeps the pending message visible and prevents dispatch or deletion while sending", () => {
    const send = jest.fn();
    const remove = jest.fn();
    render(
      <QueuedMessagesPanel
        messages={[
          {
            id: "one",
            text: "Keep this instruction",
            timestamp: 1,
            dispatchState: "sending",
          },
        ]}
        onSendNow={send}
        onDelete={remove}
        isStreaming
      />,
    );
    expect(screen.getByText("Keep this instruction")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Sending");
    fireEvent.click(screen.getByRole("button", { name: /Send now/i }));
    fireEvent.click(screen.getByTitle("Remove from queue"));
    expect(send).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
  it("explains uncertain delivery and blocks another send while allowing explicit removal", () => {
    const send = jest.fn();
    const remove = jest.fn();
    render(
      <QueuedMessagesPanel
        messages={[
          {
            id: "one",
            text: "Review first",
            timestamp: 1,
            dispatchState: "unconfirmed",
          },
          { id: "two", text: "Next", timestamp: 2 },
        ]}
        onSendNow={send}
        onDelete={remove}
        isStreaming
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Check the conversation",
    );
    for (const button of screen.getAllByRole("button", { name: /Send now/i }))
      expect(button).toBeDisabled();
    fireEvent.click(screen.getAllByTitle("Remove from queue")[0]);
    expect(remove).toHaveBeenCalledWith("one");
  });
});
