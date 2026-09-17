import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MonthlyUsageSummary } from "../MonthlyUsageSummary";

const mockUseIsMobile = jest.fn<boolean, []>();
const mockFetch = jest.fn();
const mockExtraUsageQuery = jest.fn();

jest.mock("@/lib/rate-limit/token-bucket", () => ({
  POINTS_PER_DOLLAR: 10_000,
}));

const EXTRA_USAGE_SETTINGS = {
  balanceDollars: 12.5,
  balancePoints: 125_000,
  autoReloadEnabled: false,
  monthlySpentDollars: 0,
  includedCredits: {
    remaining: 750,
    total: 1_000,
    used: 250,
    resetAt: "2026-08-01T00:00:00.000Z" as string | null,
  },
};

jest.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mockUseIsMobile(),
}));

jest.mock("convex/react", () => ({
  useAction: () => jest.fn(),
  useQuery: (_query: unknown, args: unknown) =>
    args === "skip" ? undefined : mockExtraUsageQuery(),
}));

const originalResizeObserver = global.ResizeObserver;
const originalFetch = global.fetch;

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(global, "fetch", {
    configurable: true,
    writable: true,
    value: mockFetch,
  });
});

afterAll(() => {
  global.ResizeObserver = originalResizeObserver;
  Object.defineProperty(global, "fetch", {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

beforeEach(() => {
  mockExtraUsageQuery.mockReturnValue(EXTRA_USAGE_SETTINGS);
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      ok: true,
      periodStart: Date.UTC(2026, 6, 1),
      periodEnd: Date.UTC(2026, 7, 1) - 1,
      requestCount: 12,
      inputTokens: 1_000,
      outputTokens: 250,
      cacheReadTokens: 300,
      cacheWriteTokens: 100,
      totalTokens: 1_250,
    }),
  });
});

describe("MonthlyUsageSummary trigger", () => {
  it("opens the desktop popover through the forwarded trigger props", async () => {
    mockUseIsMobile.mockReturnValue(false);
    const user = userEvent.setup();

    render(<MonthlyUsageSummary subscription="pro" />);

    const trigger = screen.getByRole("button", {
      name: "Open monthly usage",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(mockFetch).not.toHaveBeenCalled();

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/usage/monthly",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        signal: expect.any(Object),
      }),
    );
    expect(await screen.findByText("Included credits")).toBeInTheDocument();
    expect(screen.getByLabelText("750 credits remaining")).toHaveAccessibleName(
      "750 credits remaining",
    );
    expect(screen.getByText("250 used / 1K total")).toBeInTheDocument();
    expect(screen.getByText("Resets Aug 1")).toBeInTheDocument();
    expect(screen.getByText("125K credits")).toBeInTheDocument();
  });

  it("opens the mobile sheet through the forwarded trigger props", async () => {
    mockUseIsMobile.mockReturnValue(true);
    const user = userEvent.setup();

    render(<MonthlyUsageSummary subscription="pro" />);

    const trigger = screen.getByRole("button", {
      name: "Open monthly usage",
    });
    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("Included credits")).toBeInTheDocument();
  });

  it("opens the shared add-on checkout from monthly usage", async () => {
    mockUseIsMobile.mockReturnValue(false);
    const user = userEvent.setup();

    render(<MonthlyUsageSummary subscription="pro" />);
    await user.click(
      screen.getByRole("button", { name: "Open monthly usage" }),
    );

    expect(
      await screen.findByRole("region", { name: "Add-on credits" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Add credits" }));

    expect(
      await screen.findByRole("dialog", { name: "Add-on credits" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /^Starter:/ })).toBeVisible();
  });

  it("shows an urgent checkout action when all paid credits are exhausted", async () => {
    mockUseIsMobile.mockReturnValue(false);
    mockExtraUsageQuery.mockReturnValue({
      ...EXTRA_USAGE_SETTINGS,
      balanceDollars: 0,
      balancePoints: 0,
      includedCredits: {
        remaining: 0,
        total: 1_000,
        used: 1_000,
        resetAt: "2026-08-01T00:00:00.000Z",
      },
    });
    const user = userEvent.setup();

    render(<MonthlyUsageSummary subscription="pro" />);
    await user.click(
      screen.getByRole("button", { name: "Open monthly usage" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Credits exhausted" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Add credits" })).toBeEnabled();
  });

  it("warns a paid account before its final credits run out", async () => {
    mockUseIsMobile.mockReturnValue(false);
    mockExtraUsageQuery.mockReturnValue({
      ...EXTRA_USAGE_SETTINGS,
      balanceDollars: 2,
      balancePoints: 20_000,
      includedCredits: {
        remaining: 50,
        total: 1_000,
        used: 950,
        resetAt: "2026-08-01T00:00:00.000Z",
      },
    });
    const user = userEvent.setup();

    render(<MonthlyUsageSummary subscription="pro" />);
    await user.click(
      screen.getByRole("button", { name: "Open monthly usage" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Credits running low" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Add credits" })).toBeEnabled();
  });

  it("routes free accounts to plans instead of exposing paid checkout", async () => {
    mockUseIsMobile.mockReturnValue(false);
    mockExtraUsageQuery.mockReturnValue({
      ...EXTRA_USAGE_SETTINGS,
      balanceDollars: 0,
      balancePoints: 0,
      includedCredits: {
        remaining: 0,
        total: 0,
        used: 0,
        resetAt: null,
      },
    });
    const user = userEvent.setup();

    render(<MonthlyUsageSummary subscription="free" />);
    await user.click(
      screen.getByRole("button", { name: "Open monthly usage" }),
    );

    const plansLink = await screen.findByRole("link", { name: "View plans" });
    expect(plansLink).toHaveAttribute("href", "/upgrade");
    expect(
      screen.getByText(
        "One-time credit packs are available with an active Pro or Max plan.",
      ),
    ).toBeVisible();
  });

  it("keeps valid account credits visible when reset metadata is unavailable", async () => {
    mockUseIsMobile.mockReturnValue(false);
    mockExtraUsageQuery.mockReturnValue({
      ...EXTRA_USAGE_SETTINGS,
      includedCredits: {
        ...EXTRA_USAGE_SETTINGS.includedCredits,
        resetAt: "invalid-reset-date",
      },
    });
    const user = userEvent.setup();

    render(<MonthlyUsageSummary subscription="pro" />);
    await user.click(
      screen.getByRole("button", { name: "Open monthly usage" }),
    );

    expect(
      await screen.findByLabelText("750 credits remaining"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Included with your current plan"),
    ).toBeInTheDocument();
  });

  it("shows an unused allowance without inventing a reset date", async () => {
    mockUseIsMobile.mockReturnValue(false);
    mockExtraUsageQuery.mockReturnValue({
      ...EXTRA_USAGE_SETTINGS,
      includedCredits: {
        remaining: 1_000,
        total: 1_000,
        used: 0,
        resetAt: null,
      },
    });
    const user = userEvent.setup();

    render(<MonthlyUsageSummary subscription="pro" />);
    await user.click(
      screen.getByRole("button", { name: "Open monthly usage" }),
    );

    expect(
      await screen.findByLabelText("1,000 credits remaining"),
    ).toBeInTheDocument();
    expect(screen.getByText("0 used / 1K total")).toBeInTheDocument();
    expect(
      screen.getByText("Included with your current plan"),
    ).toBeInTheDocument();
  });

  it("shows a zero included-credit balance for a signed-in free account", async () => {
    mockUseIsMobile.mockReturnValue(false);
    mockExtraUsageQuery.mockReturnValue({
      ...EXTRA_USAGE_SETTINGS,
      includedCredits: {
        remaining: 0,
        total: 0,
        used: 0,
        resetAt: null,
      },
    });
    const user = userEvent.setup();

    render(<MonthlyUsageSummary subscription="free" />);
    await user.click(
      screen.getByRole("button", { name: "Open monthly usage" }),
    );

    expect(
      await screen.findByLabelText("0 credits remaining"),
    ).toBeInTheDocument();
    expect(screen.getByText("0 used / 0 total")).toBeInTheDocument();
    expect(
      screen.getByText("No credits included with your current plan"),
    ).toBeInTheDocument();
  });

  it("announces included-credit loading while the account query resolves", async () => {
    mockUseIsMobile.mockReturnValue(false);
    mockExtraUsageQuery.mockReturnValue(undefined);
    const user = userEvent.setup();

    render(<MonthlyUsageSummary subscription="pro" />);
    await user.click(
      screen.getByRole("button", { name: "Open monthly usage" }),
    );

    expect(await screen.findByText("Checking…")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("hides unsupported attribution instead of repeating unavailable rows", async () => {
    mockUseIsMobile.mockReturnValue(false);
    const user = userEvent.setup();

    render(<MonthlyUsageSummary subscription="pro" />);
    await user.click(
      screen.getByRole("button", { name: "Open monthly usage" }),
    );
    expect(await screen.findByText("12 requests")).toBeInTheDocument();

    expect(screen.queryByText("Not available")).not.toBeInTheDocument();
    expect(screen.queryByText("Activity")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /expanded/i }));
    expect(screen.queryByText("Models")).not.toBeInTheDocument();
    expect(screen.queryByText("Subagents")).not.toBeInTheDocument();
  });

  it("keeps breakdown details optional and opens each visit in the compact view", async () => {
    mockUseIsMobile.mockReturnValue(false);
    const user = userEvent.setup();
    render(<MonthlyUsageSummary subscription="pro" />);
    const trigger = screen.getByRole("button", { name: "Open monthly usage" });
    await user.click(trigger);

    const disclosure = await screen.findByRole("button", {
      name: "Show expanded usage details",
    });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Cache read")).not.toBeInTheDocument();
    await user.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Cache read")).toBeVisible();

    await user.click(trigger);
    await user.click(trigger);
    expect(
      await screen.findByRole("button", {
        name: "Show expanded usage details",
      }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Cache read")).not.toBeInTheDocument();
  });

  it("cancels an in-flight monthly fetch when the panel closes", async () => {
    mockUseIsMobile.mockReturnValue(false);
    let requestSignal: AbortSignal | undefined;
    mockFetch.mockImplementationOnce(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          requestSignal = init?.signal ?? undefined;
          requestSignal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const user = userEvent.setup();

    render(<MonthlyUsageSummary subscription="pro" />);
    const trigger = screen.getByRole("button", {
      name: "Open monthly usage",
    });
    await user.click(trigger);
    await waitFor(() => expect(requestSignal).toBeDefined());
    await user.click(trigger);

    expect(requestSignal?.aborted).toBe(true);
  });

  it("keeps account credits visible when the activity endpoint is unavailable", async () => {
    mockUseIsMobile.mockReturnValue(false);
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ ok: false }),
    });
    const user = userEvent.setup();

    render(<MonthlyUsageSummary subscription="pro" />);
    const trigger = screen.getByRole("button", {
      name: "Open monthly usage",
    });
    await user.click(trigger);

    expect(
      await screen.findByLabelText("750 credits remaining"),
    ).toBeInTheDocument();
    expect(
      (await screen.findAllByText("Usage data unavailable")).length,
    ).toBeGreaterThan(0);
  });
});
