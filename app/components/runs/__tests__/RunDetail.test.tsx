import { render, screen, fireEvent } from "@testing-library/react";

const mockUseQuery = jest.fn();
jest.mock("convex/react", () => ({
  useQuery: (...a: unknown[]) => mockUseQuery(...a),
}));
jest.mock("@/convex/_generated/api", () => ({
  api: {
    runs: { getRunLog: "runs.getRunLog", getEvidence: "runs.getEvidence" },
  },
}));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

import { RunDetail } from "../RunDetail";

const baseRun = {
  id: "run-1",
  chat_id: "chat-9",
  status: "completed",
  surface: "hack",
  goal: "Scan the authorized host",
  model: "RIFT",
  started_at: Date.now() - 60_000,
  ended_at: Date.now(),
};

/** Answers getRunLog first, then getEvidence. */
function wire(log: unknown, evidence?: unknown) {
  mockUseQuery.mockImplementation((ref: string) =>
    ref === "runs.getRunLog" ? log : evidence,
  );
}

describe("Run detail", () => {
  beforeEach(() => jest.clearAllMocks());

  it("says a run is missing rather than rendering an empty shell", () => {
    wire({ run: null, events: [] });
    render(<RunDetail runId="nope" />);
    expect(screen.getByText("Run not found")).toBeInTheDocument();
  });

  it("renders the event log in server order", () => {
    wire({
      run: baseRun,
      events: [
        {
          seq: 1,
          type: "terminal_command",
          at: Date.now(),
          summary: "nmap -sV",
        },
        {
          seq: 2,
          type: "finding",
          at: Date.now(),
          summary: "[high] Open panel",
          severity: "high",
        },
      ],
    });
    render(<RunDetail runId="run-1" />);

    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("nmap -sV");
    expect(rows[1]).toHaveTextContent("[high] Open panel");
  });

  it("shows a failing command's exit code on its event", () => {
    wire({
      run: baseRun,
      events: [
        {
          seq: 1,
          type: "terminal_command",
          at: Date.now(),
          summary: "npm run build",
          exit_code: 1,
        },
      ],
    });
    render(<RunDetail runId="run-1" />);
    expect(screen.getByText("exit 1")).toBeInTheDocument();
  });

  it("opens the evidence behind an event on demand", () => {
    // Evidence is the point of the log: an event that claims something must be
    // able to show what it was based on.
    wire(
      {
        run: baseRun,
        events: [
          {
            seq: 1,
            type: "terminal_command",
            at: Date.now(),
            summary: "curl -I https://target",
            evidence_id: "ev1",
          },
        ],
      },
      {
        kind: "terminal_output",
        content: "HTTP/1.1 200 OK",
        byte_size: 15,
        command: "curl -I https://target",
      },
    );
    render(<RunDetail runId="run-1" />);

    expect(screen.queryByText("HTTP/1.1 200 OK")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
    expect(screen.getByText("HTTP/1.1 200 OK")).toBeInTheDocument();
  });

  it("offers no evidence control for an event that has none", () => {
    wire({
      run: baseRun,
      events: [
        { seq: 1, type: "run_started", at: Date.now(), summary: "started" },
      ],
    });
    render(<RunDetail runId="run-1" />);
    expect(
      screen.queryByRole("button", { name: "Evidence" }),
    ).not.toBeInTheDocument();
  });

  it("admits when stored evidence was truncated", () => {
    wire(
      {
        run: baseRun,
        events: [
          {
            seq: 1,
            type: "terminal_command",
            at: Date.now(),
            summary: "big",
            evidence_id: "ev1",
          },
        ],
      },
      {
        kind: "terminal_output",
        content: "partial…",
        byte_size: 900_000,
        truncated: true,
      },
    );
    render(<RunDetail runId="run-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));

    // Letting a reader believe they have the whole thing is the lie this avoids.
    expect(screen.getByText(/Truncated for storage/)).toBeInTheDocument();
  });

  it("links back to the conversation that produced the run", () => {
    wire({ run: { ...baseRun, surface: "build" }, events: [] });
    render(<RunDetail runId="run-1" />);
    expect(
      screen.getByRole("link", { name: /Open conversation/ }),
    ).toHaveAttribute("href", "/c/chat-9");
  });

  it.each([
    ["studio", "chat-9", "Open conversation", "/studio/c/chat-9"],
    [
      "hack",
      "e8c9216b-e03d-49d6-b5f5-03b9fc93c20b",
      "Open Hack session",
      "/hack?session=e8c9216b-e03d-49d6-b5f5-03b9fc93c20b",
    ],
    ["task", "chat-9", "Open conversation", "/c/chat-9"],
  ])(
    "opens a %s run in the surface that produced it",
    (surface, chatId, label, href) => {
      wire({ run: { ...baseRun, surface, chat_id: chatId }, events: [] });
      render(<RunDetail runId="run-1" />);
      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href,
      );
    },
  );

  it.each([
    ["build", undefined],
    ["studio", ""],
    ["build", "   "],
    ["hack", "not-a-session"],
  ])(
    "does not offer a %s destination without a usable identifier (%s)",
    (surface, chatId) => {
      wire({ run: { ...baseRun, surface, chat_id: chatId }, events: [] });
      render(<RunDetail runId="run-1" />);
      expect(
        screen.queryByRole("link", {
          name: /Open (conversation|Hack session)/,
        }),
      ).not.toBeInTheDocument();
    },
  );

  it("explains an empty log instead of showing a blank page", () => {
    wire({ run: baseRun, events: [] });
    render(<RunDetail runId="run-1" />);
    expect(screen.getByText("No recorded events")).toBeInTheDocument();
  });
});

describe("Run detail timing claims", () => {
  const now = 1_800_000_000_000;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, "now").mockReturnValue(now);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(["disconnected", "unknown-provider-status"])(
    "uses the latest recorded event instead of claiming %s is still running",
    (status) => {
      wire({
        run: {
          ...baseRun,
          status,
          started_at: now - 38 * 3_600_000,
          ended_at: undefined,
        },
        events: [
          {
            seq: 1,
            type: "tool",
            at: now - 30 * 60_000,
            summary: "Read files",
          },
          {
            seq: 2,
            type: "tool",
            at: now - 20 * 60_000,
            summary: "Checked files",
          },
        ],
      });
      render(<RunDetail runId="run-1" />);
      expect(screen.getByText("last active 20m 0s ago")).toBeVisible();
      expect(screen.queryByText(/running for/)).not.toBeInTheDocument();
    },
  );

  it("falls back to start time when no activity timestamp exists", () => {
    wire({
      run: {
        ...baseRun,
        status: "disconnected",
        started_at: now - 38 * 3_600_000,
        ended_at: undefined,
      },
      events: [],
    });
    render(<RunDetail runId="run-1" />);
    expect(screen.getByText("started 38h 0m ago")).toBeVisible();
    expect(screen.queryByText(/running for/)).not.toBeInTheDocument();
  });

  it("does not call the end of a possibly truncated event page the last activity", () => {
    wire({
      run: {
        ...baseRun,
        status: "disconnected",
        started_at: now - 38 * 3_600_000,
        ended_at: undefined,
      },
      events: Array.from({ length: 500 }, (_, index) => ({
        seq: index + 1,
        type: "tool",
        at: now - 20 * 60_000,
        summary: `Event ${index + 1}`,
      })),
    });
    render(<RunDetail runId="run-1" />);
    expect(screen.getByText("started 38h 0m ago")).toBeVisible();
    expect(screen.queryByText(/last active/)).not.toBeInTheDocument();
  });

  it("does not turn a completed duration into time since its final event", () => {
    wire({
      run: {
        ...baseRun,
        started_at: now - 3_600_000,
        ended_at: now - 3_535_000,
      },
      events: [{ seq: 1, type: "tool", at: now - 3_535_000, summary: "Done" }],
    });
    render(<RunDetail runId="run-1" />);
    expect(screen.getByText("took 1m 5s")).toBeVisible();
  });
});
