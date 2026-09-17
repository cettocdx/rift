import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RegistryPlugins } from "../RegistryPlugins";
const entry = {
  id: "registry-test",
  namespace: "io.example/remote",
  version: "1.0",
  name: "Remote tools",
  description: "Work with tools",
  url: "https://example.com/mcp",
  transport: "http",
  setupUrl: "https://example.com",
};
describe("Registry discovery UI", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  it("loads only when requested and passes a server-owned identity into real setup", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          entries: [entry],
          fetchedAt: Date.now(),
          truncated: false,
          stale: false,
        }),
      });
    const select = jest.fn();
    render(<RegistryPlugins installedUrls={[]} onSelect={select} />);
    expect(global.fetch).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: /Explore the MCP Registry/ }),
    );
    await screen.findByText("Remote tools");
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        id: entry.id,
        url: entry.url,
        availability: "requires_configuration",
      }),
    );
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
  });
  it("does not duplicate installed endpoints or repeated Registry endpoints", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          entries: [entry, { ...entry, id: "other" }],
          fetchedAt: Date.now(),
        }),
      });
    render(
      <RegistryPlugins
        installedUrls={[entry.url + "/"]}
        onSelect={jest.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Explore the MCP Registry/ }),
    );
    await screen.findByText(/No additional remote servers/);
    expect(screen.queryByText("Remote tools")).not.toBeInTheDocument();
  });
  it("keeps failure retryable instead of representing the catalog as connected", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("Registry unavailable"));
    render(<RegistryPlugins installedUrls={[]} onSelect={jest.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Explore the MCP Registry/ }),
    );
    await screen.findByText("Registry unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });
});
