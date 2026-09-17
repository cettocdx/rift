import "@testing-library/jest-dom";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, jest } from "@jest/globals";

import {
  LiveSidebarContentProvider,
  useLiveSidebarContent,
  usePublishLiveSidebarContent,
} from "@/app/contexts/LiveSidebarContent";

const LIVE_CONTENT = {
  command: "pnpm test",
  output: "passed",
  isExecuting: false,
  toolCallId: "tool-live-1",
};

function PublisherProbe({ onCommit }: { onCommit: () => void }) {
  const publish = usePublishLiveSidebarContent();
  React.useEffect(() => {
    onCommit();
  });
  return (
    <button type="button" onClick={() => publish(LIVE_CONTENT)}>
      Publish
    </button>
  );
}

function SubscriberProbe({ onCommit }: { onCommit: () => void }) {
  const content = useLiveSidebarContent();
  React.useEffect(() => {
    onCommit();
  });
  return (
    <output>{content && "output" in content ? content.output : ""}</output>
  );
}

describe("LiveSidebarContentProvider", () => {
  it("rerenders state subscribers without rerendering dispatch-only publishers", () => {
    const publisherCommits = jest.fn();
    const subscriberCommits = jest.fn();
    render(
      <LiveSidebarContentProvider>
        <PublisherProbe onCommit={publisherCommits} />
        <SubscriberProbe onCommit={subscriberCommits} />
      </LiveSidebarContentProvider>,
    );

    expect(publisherCommits).toHaveBeenCalledTimes(1);
    expect(subscriberCommits).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    expect(screen.getByText("passed")).toBeInTheDocument();
    expect(publisherCommits).toHaveBeenCalledTimes(1);
    expect(subscriberCommits).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(publisherCommits).toHaveBeenCalledTimes(1);
    expect(subscriberCommits).toHaveBeenCalledTimes(2);
  });
});
