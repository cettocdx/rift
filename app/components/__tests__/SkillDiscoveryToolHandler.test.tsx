import { render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { MessagePartHandler } from "../MessagePartHandler";
import { SkillDiscoveryToolHandler } from "../tools/SkillDiscoveryToolHandler";

describe("SkillDiscoveryToolHandler", () => {
  it("shows quiet progress without pretending to run a terminal command", () => {
    render(
      <SkillDiscoveryToolHandler
        part={{ state: "input-available" }}
        status="streaming"
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Project skills");
    expect(screen.getByRole("status")).toHaveTextContent("Loading skills");
    expect(screen.queryByText(/running command/i)).not.toBeInTheDocument();
  });

  it("reports only that skills loaded — never which ones", () => {
    // Loading playbooks is automatic. Naming the packs turned routine plumbing
    // into jargon the reader was invited to evaluate, so the row carries the
    // count and nothing else.
    const part = {
      type: "tool-find_skills",
      state: "output-available",
      toolCallId: "skills-1",
      output: {
        matched: true,
        count: 2,
        activeSkills: [
          {
            id: "react-best-practices",
            name: "React / Next Best Practices",
            reason: "The request uses Next.js components.",
          },
          { id: "landing-page", name: "Landing Page Craft" },
        ],
      },
    };
    const message = {
      id: "assistant-1",
      role: "assistant",
      parts: [part],
    } as unknown as UIMessage;

    render(
      <MessagePartHandler
        message={message}
        part={part}
        partIndex={0}
        status="ready"
      />,
    );

    const row = screen.getByRole("status");
    expect(row).toHaveTextContent("Loaded 2 skills");
    expect(row).toHaveTextContent("2 loaded");
    expect(row).not.toHaveTextContent("React / Next Best Practices");
    expect(row).not.toHaveTextContent("The request uses Next.js components.");
    expect(row).not.toHaveTextContent("Landing Page Craft");
  });
});
