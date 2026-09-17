import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { McpMarketplace } from "../McpMarketplace";
import { GithubConnectButton } from "../GithubConnectButton";
import { MCP_CATALOG } from "../mcpCatalog";

jest.mock("convex/react", () => ({
  useMutation: jest.fn(),
  useQuery: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

const mockMutation = jest.fn(async () => ({ success: true }));
const mockPush = jest.fn();
const mockFetch = jest.fn();
const originalFetch = globalThis.fetch;

function catalogEntry(name: string) {
  const entry = MCP_CATALOG.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`Missing test catalog entry: ${name}`);
  return entry;
}

function apiResponse(
  body: Record<string, unknown>,
  ok = true,
): Pick<Response, "ok" | "json"> {
  return { ok, json: async () => body };
}

function successfulConnection(toolNames = ["search", "read"]) {
  mockFetch.mockResolvedValueOnce(
    apiResponse({
      ok: true,
      toolCount: toolNames.length,
      toolNames,
    }),
  );
}

function installedServer(overrides: Record<string, unknown> = {}) {
  return {
    _id: "server-1",
    catalogId: "deepwiki",
    name: "DeepWiki",
    url: "https://mcp.deepwiki.com/mcp",
    transport: "http",
    enabled: true,
    hasAuth: false,
    headerKeys: [],
    authKind: "none",
    connectionStatus: "verified",
    lastCheckedAt: Date.now() - 60_000,
    toolCount: 2,
    toolNames: ["mcp_deepwiki_search", "mcp_deepwiki_read"],
    created_at: 1,
    updated_at: 2,
    ...overrides,
  };
}

/**
 * The catalog card is now just a logo and a name; connecting happens in the
 * sheet the card opens. These walk that path so the tests exercise what a
 * person actually does rather than a button that no longer exists.
 */
function openPluginSheet(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function connectFromSheet(name: string) {
  openPluginSheet(name);
  // Providers with a hosted endpoint offer "Connect"; the rest offer
  // "Add endpoint", which opens the same wizard with a blank URL.
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: /^(Connect|Add endpoint)$/,
    }),
  );
}

describe("McpMarketplace connection UX", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: mockFetch,
    });
  });

  afterAll(() => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", "/plugins");
    jest.mocked(useQuery).mockReturnValue([] as never);
    jest.mocked(useMutation).mockReturnValue(mockMutation as never);
    jest.mocked(useRouter).mockReturnValue({ push: mockPush } as never);
  });

  it("closes portalled details and endpoint forms when its tab is deactivated", () => {
    const { rerender } = render(<McpMarketplace />);
    fireEvent.change(screen.getByLabelText("Search plugins"), {
      target: { value: "DeepWiki" },
    });
    openPluginSheet("DeepWiki");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    rerender(<McpMarketplace active={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<McpMarketplace />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Search plugins")).toHaveValue("DeepWiki");
    fireEvent.click(
      screen.getByRole("button", { name: "Add a custom MCP endpoint" }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    rerender(<McpMarketplace active={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<McpMarketplace />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("closes an inactive connection menu and clears its armed remove confirmation", async () => {
    jest.mocked(useQuery).mockReturnValue([installedServer()] as never);
    const { rerender } = render(<McpMarketplace />);
    const openMenu = () => {
      const trigger = screen.getByRole("button", {
        name: "More actions for DeepWiki",
      });
      trigger.focus();
      fireEvent.keyDown(trigger, { key: "Enter" });
    };
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));
    expect(
      screen.getByRole("menuitem", { name: "Confirm remove" }),
    ).toBeInTheDocument();
    rerender(<McpMarketplace active={false} />);
    expect(screen.queryByRole("menu")).toBeNull();
    rerender(<McpMarketplace />);
    expect(screen.queryByRole("menu")).toBeNull();
    openMenu();
    expect(
      await screen.findByRole("menuitem", { name: "Remove" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Confirm remove" }),
    ).toBeNull();
    expect(mockMutation).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "keeps GitHub plugin callback errors in Plugins regardless of sidebar mount order (%s)",
    (sidebarFirst) => {
      const navigationState = { __NA: true, tree: ["plugins"] };
      window.history.replaceState(
        navigationState,
        "",
        "/plugins?connect=github&github=configuration_error&workspace=acme#installed",
      );
      render(
        sidebarFirst ? (
          <>
            <GithubConnectButton variant="sidebar" />
            <McpMarketplace />
          </>
        ) : (
          <>
            <McpMarketplace />
            <GithubConnectButton variant="sidebar" />
          </>
        ),
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "GitHub rejected RIFT’s app configuration.",
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("alert")).not.toHaveTextContent(
        "Check the credential at the provider",
      );
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe("/plugins?workspace=acme#installed");
      expect(window.history.state).toEqual(navigationState);
    },
  );

  it.each([
    ["provider_unavailable", "GitHub could not be reached."],
    ["mcp_failed", "GitHub is connected, but its plugin could not be enabled."],
  ])(
    "uses the shared actionable GitHub callback message for %s",
    (status, message) => {
      window.history.replaceState(
        {},
        "",
        `/plugins?connect=github&github=${status}`,
      );
      render(<McpMarketplace />);
      expect(screen.getByRole("alert")).toHaveTextContent(message);
      expect(toast.error).toHaveBeenCalledTimes(1);
    },
  );

  it("handles a later GitHub plugin return and clears a previous callback error", () => {
    window.history.replaceState(
      {},
      "",
      "/plugins?connect=github&github=denied",
    );
    render(<McpMarketplace />);
    expect(screen.getByRole("alert")).toBeVisible();
    window.history.replaceState(
      {},
      "",
      "/plugins?connect=github&github=connected",
    );
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("reports a completed OAuth callback once and removes callback parameters", async () => {
    window.history.replaceState(
      {},
      "",
      "/plugins?oauth=connected&workspace=acme",
    );

    render(<McpMarketplace />);

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "OAuth plugin connected and verified.",
      ),
    );
    expect(window.location.pathname + window.location.search).toBe(
      "/plugins?workspace=acme",
    );
  });

  it("keeps an OAuth callback failure visible and removes its sensitive state", async () => {
    window.history.replaceState(
      {},
      "",
      "/plugins?oauth=error&reason=denied&workspace=acme",
    );

    render(<McpMarketplace />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "OAuth authorization was denied. No plugin was connected.",
    );
    expect(toast.error).toHaveBeenCalledWith(
      "OAuth authorization was denied. No plugin was connected.",
    );
    expect(window.location.pathname + window.location.search).toBe(
      "/plugins?workspace=acme",
    );
  });

  it("keeps every catalog listing actionable and removes the unsupported filter", () => {
    render(<McpMarketplace />);

    let showMore = screen.queryByRole("button", { name: "Show more plugins" });
    while (showMore) {
      fireEvent.click(showMore);
      showMore = screen.queryByRole("button", { name: "Show more plugins" });
    }

    // Every catalog entry is a single actionable card that opens its sheet.
    for (const entry of MCP_CATALOG) {
      expect(
        screen.getByRole("button", { name: entry.name }),
      ).toBeInTheDocument();
    }
    expect(
      screen.queryByRole("option", { name: "Unsupported" }),
    ).not.toBeInTheDocument();
  });

  it("connects a public provider in one click with the generic auth contract", async () => {
    const entry = catalogEntry("DeepWiki");
    successfulConnection(["ask_question", "read_repo"]);
    render(<McpMarketplace />);

    connectFromSheet(entry.name);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledWith("/api/mcp/connect", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        catalogId: entry.id,
        name: entry.name,
        url: entry.url,
        transport: entry.transport,
        auth: { kind: "none" },
      }),
    });
    // The sheet confirms in place rather than inviting a second attempt at
    // something that already worked.
    expect(
      await within(screen.getByRole("dialog")).findByText("Connected"),
    ).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Connected DeepWiki · 2 tools");
    expect(JSON.stringify(mockFetch.mock.calls)).not.toContain("secret");
  });

  it("keeps bearer-token fallback available for custom endpoints and reports field errors inline", async () => {
    successfulConnection(["get_issue"]);
    render(<McpMarketplace />);

    fireEvent.click(
      screen.getByRole("button", { name: "Add a custom MCP endpoint" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Add a custom MCP endpoint",
    });
    const form = dialog.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Connection name"), {
      target: { value: "Private GitHub" },
    });
    fireEvent.change(within(dialog).getByLabelText("MCP endpoint"), {
      target: { value: "https://mcp.example.com/github" },
    });
    fireEvent.change(within(dialog).getByLabelText("Authentication"), {
      target: { value: "bearer" },
    });

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Verify and connect" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Enter the credential supplied by the provider",
    );
    expect(mockFetch).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText("Bearer token"), {
      target: { value: "  ghp_test_token  " },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Verify and connect" }),
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(mockFetch.mock.calls[0][1].body))).toEqual({
      name: "Private GitHub",
      url: "https://mcp.example.com/github",
      transport: "http",
      auth: { kind: "bearer", secret: "ghp_test_token" },
    });
  });

  // The "provider listing without an endpoint" case is gone: the catalog now
  // only lists providers that publish a hosted MCP server. Bringing your own
  // endpoint goes through "Add a custom MCP endpoint", which the bearer-token
  // test below already covers end to end.

  it("starts OAuth through RIFT and delegates navigation through an injectable boundary", async () => {
    const entry = catalogEntry("Higgsfield");
    const navigate = jest.fn();
    mockFetch.mockResolvedValueOnce(
      apiResponse({
        ok: true,
        authorizationUrl: "https://higgsfield.ai/oauth/authorize?state=safe",
      }),
    );
    render(<McpMarketplace navigateToAuthorization={navigate} />);

    connectFromSheet(entry.name);

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "https://higgsfield.ai/oauth/authorize?state=safe",
      ),
    );
    expect(mockFetch).toHaveBeenCalledWith("/api/mcp/oauth/start", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        catalogId: entry.id,
        name: entry.name,
        url: entry.url,
        transport: entry.transport,
      }),
    });
  });

  it("keeps API errors in context and accepts either the message or error response field", async () => {
    mockFetch.mockResolvedValueOnce(
      apiResponse(
        {
          ok: false,
          message: "Secure plugin credential storage is unavailable.",
        },
        false,
      ),
    );
    render(<McpMarketplace />);

    connectFromSheet("DeepWiki");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Secure plugin credential storage is unavailable.",
    );
    expect(alert).toHaveTextContent("Retry shortly");
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Connect",
      }),
    ).toBeEnabled();
  });

  it("includes ready OAuth providers in one-click and recovers from empty setup filters", () => {
    render(<McpMarketplace />);
    const filter = screen.getByRole("combobox", {
      name: "Filter plugins by state",
    });
    fireEvent.change(filter, { target: { value: "available" } });
    expect(
      screen.getByRole("button", { name: "DeepWiki" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "GitHub" })).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "setup" } });
    fireEvent.change(screen.getByLabelText("Search plugins"), {
      target: { value: "GitHub" },
    });
    expect(
      screen.queryByRole("button", { name: "GitHub" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByLabelText("Search plugins")).toHaveValue("");
    expect(filter).toHaveValue("all");
  });

  it("shows one empty result when a search matches neither connections nor the catalog", () => {
    jest.mocked(useQuery).mockReturnValue([installedServer()] as never);
    render(<McpMarketplace />);
    fireEvent.change(screen.getByLabelText("Search plugins"), {
      target: { value: "not-a-real-plugin" },
    });
    expect(
      screen.getByRole("heading", { name: "No matching plugins" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "No matching connections" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeEnabled();
  });

  it("renders connection health and capability without endpoint noise", () => {
    jest.mocked(useQuery).mockReturnValue([
      installedServer({
        enabled: false,
        authKind: "api_key_header",
        headerKeys: ["X-API-Key"],
      }),
    ] as never);
    render(<McpMarketplace />);

    const connections = screen.getByText("Connections").closest("section");
    expect(connections).not.toBeNull();
    expect(
      within(connections!).getByText("0 connected · 1 disabled"),
    ).toBeInTheDocument();
    expect(within(connections!).getByText("Disabled")).toBeInTheDocument();
    expect(
      within(connections!).getByText(catalogEntry("DeepWiki").description),
    ).toBeInTheDocument();
    // The row deliberately no longer carries the auth kind, the last-checked
    // stamp, the raw endpoint or a dump of tool ids: none of it was actionable
    // where it sat, and it buried the one thing that is.
    expect(within(connections!).queryByText(/API key/)).not.toBeInTheDocument();
    expect(within(connections!).queryByText(/Checked/)).not.toBeInTheDocument();
    expect(
      within(connections!).queryByText(/mcp_deepwiki_search/),
    ).not.toBeInTheDocument();
    // One named action replaces the unlabelled switch.
    expect(
      within(connections!).getByRole("button", { name: "Connect" }),
    ).toBeInTheDocument();
  });

  it("summarizes healthy and attention connections without calling every row configured", () => {
    jest.mocked(useQuery).mockReturnValue([
      installedServer(),
      installedServer({
        _id: "server-2",
        catalogId: "stripe",
        name: "Stripe",
        url: catalogEntry("Stripe").url,
        connectionStatus: "needs_attention",
        toolCount: 0,
        toolNames: [],
      }),
    ] as never);
    render(<McpMarketplace />);

    const connections = screen.getByText("Connections").closest("section")!;
    expect(
      within(connections).getByText("1 connected · 1 attention"),
    ).toBeInTheDocument();
    expect(within(connections).queryByText("2/2")).not.toBeInTheDocument();
  });

  it("labels an installed-but-unhealthy plugin by its real status, not Connected", () => {
    // Presence in the installed set is not a live connection. A plugin that
    // needs attention used to read "Connected" on its catalog row, asserting a
    // link that was actually broken.
    jest.mocked(useQuery).mockReturnValue([
      installedServer({
        _id: "server-2",
        catalogId: "stripe",
        name: "Stripe",
        url: catalogEntry("Stripe").url,
        connectionStatus: "needs_attention",
        toolCount: 0,
        toolNames: [],
      }),
    ] as never);
    render(<McpMarketplace />);

    const stripeRow = screen
      .getByRole("button", { name: "Stripe" })
      .closest("article")!;
    expect(within(stripeRow).getByText("Needs attention")).toBeInTheDocument();
    expect(within(stripeRow).queryByText("Connected")).not.toBeInTheDocument();
  });

  it("shows a verified provider once, with its connection state", () => {
    jest.mocked(useQuery).mockReturnValue([installedServer()] as never);
    render(<McpMarketplace />);

    const deepwikiRow = screen
      .getByRole("button", { name: "DeepWiki" })
      .closest("article")!;
    expect(within(deepwikiRow).getByText("Connected")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "DeepWiki" })).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Disconnect" }),
    ).not.toBeInTheDocument();
  });

  it("reconnects GitHub through the registered Rift OAuth flow", () => {
    const server = installedServer({
      catalogId: "github",
      name: "GitHub",
      url: catalogEntry("GitHub").url,
      hasAuth: true,
      authKind: "bearer",
      connectionStatus: "needs_attention",
    });
    jest.mocked(useQuery).mockReturnValue([server] as never);
    const navigate = jest.fn();
    render(<McpMarketplace navigateToAuthorization={navigate} />);
    const connections = screen.getByText("Connections").closest("section")!;
    fireEvent.click(
      within(connections).getByRole("button", { name: "Reconnect" }),
    );
    expect(navigate).toHaveBeenCalledWith(
      "/api/github/authorize?return_to=%2Fplugins%3Fconnect%3Dgithub",
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows the existing legacy Firecrawl connection once with its brand", () => {
    jest.mocked(useQuery).mockReturnValue([
      installedServer({
        catalogId: undefined,
        name: "Firecrawl",
        url: "https://mcp.firecrawl.dev/legacy/mcp",
        authKind: "bearer",
      }),
    ] as never);
    render(<McpMarketplace />);
    expect(
      screen.getAllByRole("button", { name: "Firecrawl", exact: true }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Connect Firecrawl" }),
    ).not.toBeInTheDocument();
  });

  it("maps persisted connections by catalog id before using legacy URL fallback", () => {
    jest.mocked(useQuery).mockReturnValue([
      installedServer({
        catalogId: "github",
        name: "GitHub work",
        url: catalogEntry("DeepWiki").url,
        hasAuth: true,
        authKind: "bearer",
        headerKeys: ["Authorization"],
      }),
    ] as never);
    render(<McpMarketplace />);

    // The GitHub card is matched by catalog id even though its stored URL is
    // DeepWiki's, so its sheet offers Manage rather than Connect.
    openPluginSheet("GitHub");
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Manage",
      }),
    ).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(
      screen.getByRole("button", { name: "DeepWiki" }),
    ).toBeInTheDocument();
  });

  it("requires a fresh secret when edit mode changes authentication kind or header", async () => {
    const server = installedServer({
      catalogId: "github",
      name: "GitHub",
      url: catalogEntry("GitHub").url,
      hasAuth: true,
      authKind: "bearer",
      headerKeys: ["Authorization"],
    });
    jest.mocked(useQuery).mockReturnValue([server] as never);
    successfulConnection(["get_issue", "list_prs"]);
    render(<McpMarketplace />);

    const connections = screen.getByText("Connections").closest("section")!;
    // Edit now lives behind the row's overflow menu, matching the reference
    // board: one primary action, everything else one press deeper.
    // jsdom has no PointerEvent, so Radix never sees a synthetic pointerdown.
    // Enter on the focused trigger is the keyboard path it does listen for —
    // and exercising that path is worth more than simulating a mouse anyway.
    const overflow = within(connections).getByRole("button", {
      name: "More actions for GitHub",
    });
    overflow.focus();
    fireEvent.keyDown(overflow, { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Edit endpoint/ }),
    );
    const dialog = screen.getByRole("dialog", { name: "Edit GitHub" });
    fireEvent.change(within(dialog).getByLabelText("Authentication"), {
      target: { value: "api_key_header" },
    });
    fireEvent.change(within(dialog).getByLabelText("API-key header"), {
      target: { value: "X-GitHub-Key" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Verify changes" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Enter the credential supplied by the provider",
    );
    expect(mockFetch).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText("API key"), {
      target: { value: "  replacement-secret  " },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Verify changes" }),
    );
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledWith("/api/mcp/recheck", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "server-1",
        catalogId: "github",
        name: "GitHub",
        url: catalogEntry("GitHub").url,
        transport: "http",
        auth: {
          kind: "api_key_header",
          headerName: "X-GitHub-Key",
          secret: "replacement-secret",
        },
      }),
    });
  });

  it("can verify an unchanged saved auth method without exposing its secret", async () => {
    jest.mocked(useQuery).mockReturnValue([
      installedServer({
        catalogId: "github",
        name: "GitHub",
        url: catalogEntry("GitHub").url,
        hasAuth: true,
        authKind: "bearer",
        headerKeys: ["Authorization"],
      }),
    ] as never);
    successfulConnection(["get_issue"]);
    render(<McpMarketplace />);

    const connections = screen.getByText("Connections").closest("section")!;
    // Edit now lives behind the row's overflow menu, matching the reference
    // board: one primary action, everything else one press deeper.
    // jsdom has no PointerEvent, so Radix never sees a synthetic pointerdown.
    // Enter on the focused trigger is the keyboard path it does listen for —
    // and exercising that path is worth more than simulating a mouse anyway.
    const overflow = within(connections).getByRole("button", {
      name: "More actions for GitHub",
    });
    overflow.focus();
    fireEvent.keyDown(overflow, { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Edit endpoint/ }),
    );
    const dialog = screen.getByRole("dialog", { name: "Edit GitHub" });
    expect(
      within(dialog).getByLabelText(
        new RegExp(`^${catalogEntry("GitHub").tokenLabel}`),
      ),
    ).not.toBeRequired();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Verify changes" }),
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(mockFetch.mock.calls[0][1].body));
    expect(body.auth).toEqual({ kind: "bearer" });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("shows an honest loading status while connection health resolves", () => {
    jest.mocked(useQuery).mockReturnValue(undefined);
    render(<McpMarketplace />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Syncing connection health",
    );
    openPluginSheet("DeepWiki");
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Connect",
      }),
    ).toBeDisabled();
  });

  it("keeps provider badges local instead of loading third-party images", () => {
    const { container } = render(<McpMarketplace />);
    // The mark is decorative: the provider name sits next to it, so an alt
    // would make a screen reader announce the same provider twice. The asset
    // is still asserted to be served from our own origin.
    const deepWikiLogo = container.querySelector(
      'img[src="/plugin-logos/deepwiki.svg"]',
    );
    expect(deepWikiLogo).not.toBeNull();
    expect(deepWikiLogo).toHaveAttribute("alt", "");
    const filterBar = screen
      .getByLabelText("Search plugins")
      .closest(".sticky");
    expect(filterBar).toHaveClass("bg-background/95");
    expect(filterBar).not.toHaveClass("dark:bg-[#181818]/95");
    expect(container.querySelector("img[src^='http']")).toBeNull();
  });

  it("keeps primary marketplace controls touch-sized without changing fine-pointer density", () => {
    render(<McpMarketplace />);

    expect(screen.getByLabelText("Search plugins")).toHaveClass(
      "h-11",
      "touch-manipulation",
      "md:pointer-fine:h-9",
    );
    expect(screen.getByLabelText("Filter plugins by state")).toHaveClass(
      "h-11",
      "touch-manipulation",
    );
    const categories = screen.getByRole("group", {
      name: "Plugin categories",
    });
    expect(within(categories).getAllByRole("button")[0]).toHaveClass(
      "min-h-11",
      "touch-manipulation",
    );
    expect(
      screen.getByRole("button", { name: "Connect DeepWiki" }),
    ).toBeEnabled();
    expect(
      screen.getByText(catalogEntry("DeepWiki").description),
    ).toBeVisible();
  });

  it("bounds the connection wizard to dvh with a single mobile scroll surface", async () => {
    jest.mocked(useQuery).mockReturnValue([
      installedServer({
        catalogId: "github",
        name: "GitHub",
        url: catalogEntry("GitHub").url,
        hasAuth: true,
        authKind: "bearer",
        headerKeys: ["Authorization"],
      }),
    ] as never);
    render(<McpMarketplace />);

    const connections = screen.getByText("Connections").closest("section")!;
    // Edit now lives behind the row's overflow menu, matching the reference
    // board: one primary action, everything else one press deeper.
    // jsdom has no PointerEvent, so Radix never sees a synthetic pointerdown.
    // Enter on the focused trigger is the keyboard path it does listen for —
    // and exercising that path is worth more than simulating a mouse anyway.
    const overflow = within(connections).getByRole("button", {
      name: "More actions for GitHub",
    });
    overflow.focus();
    fireEvent.keyDown(overflow, { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Edit endpoint/ }),
    );

    const dialog = screen.getByRole("dialog", { name: "Edit GitHub" });
    expect(dialog).toHaveClass(
      "bottom-0",
      "top-auto",
      "max-h-[calc(100dvh-env(safe-area-inset-top))]",
      "overflow-y-auto",
      "overscroll-contain",
      "pb-[max(1rem,env(safe-area-inset-bottom))]",
    );
    expect(
      within(dialog).getByRole("button", {
        name: "Close plugin connection",
      }),
    ).toHaveClass("size-11", "touch-manipulation");
    expect(within(dialog).getByLabelText("Connection name")).toHaveClass(
      "h-11",
      "md:pointer-fine:h-9",
    );
  });
});
