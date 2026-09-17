import { fireEvent, render, screen } from "@testing-library/react";

import PluginsError from "../../(chat)/plugins/error";
import PluginsLoading from "../../(chat)/plugins/loading";

describe("Plugins route states", () => {
  it("announces the route loading state", () => {
    render(<PluginsLoading />);

    const main = screen.getByRole("main", { name: "Loading plugins" });
    expect(main).toHaveAttribute("aria-busy", "true");
    expect(main).toHaveClass("bg-background");
    expect(main).not.toHaveClass("dark:bg-[#181818]");
    expect(
      screen.getByText("Loading plugins and connection health…"),
    ).toHaveClass("sr-only");
  });

  it("keeps route failures recoverable", () => {
    const reset = jest.fn();
    render(<PluginsError reset={reset} />);

    const main = screen.getByRole("main");
    expect(main).toHaveClass("bg-background");
    expect(main).not.toHaveClass("dark:bg-[#181818]");
    expect(
      screen.getByRole("heading", { name: "Connections could not load" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Saved plugins were not changed",
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry connections" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Open Build" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
