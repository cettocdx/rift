import { render, screen } from "@testing-library/react";
import { BuildModelSelector } from "../BuildModelSelector";

jest.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({
    children,
    className,
    side,
    avoidCollisions,
    style,
    "data-ui": dataUi,
    "data-open-direction": openDirection,
  }: {
    children: React.ReactNode;
    className?: string;
    side?: string;
    avoidCollisions?: boolean;
    style?: React.CSSProperties;
    "data-ui"?: string;
    "data-open-direction"?: string;
  }) => (
    <div
      className={className}
      data-ui={dataUi}
      data-side={side}
      data-avoid-collisions={String(avoidCollisions)}
      data-open-direction={openDirection}
      style={style}
    >
      {children}
    </div>
  ),
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

describe("BuildModelSelector", () => {
  it("offers Astra, Fable and Gemini with brand artwork and removes retired choices", () => {
    render(<BuildModelSelector value="build-gemini" onChange={jest.fn()} />);
    expect(
      screen.getByRole("button", { name: "Build model: Gemini 3.8 Flash" }),
    ).toBeVisible();
    expect(screen.getByText("GPT-6 Astra")).toBeVisible();
    expect(screen.getByText("Claude Fable 5.1")).toBeVisible();
    expect(document.querySelector('[data-brand="Gemini"]')).toBeInTheDocument();
    expect(screen.queryByText("GPT-5.6 Luna")).not.toBeInTheDocument();
    expect(screen.queryByText("GPT-5.6 Sol Pro")).not.toBeInTheDocument();
    expect(screen.queryByText("Claude Sonnet 5")).not.toBeInTheDocument();
  });
  it("shows the canonical Build default for auto and cross-purpose state", () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <BuildModelSelector value="auto" onChange={onChange} />,
    );

    expect(
      screen.getByRole("button", { name: "Build model: GPT-5.6 Sol" }),
    ).toBeVisible();

    rerender(<BuildModelSelector value="video-grok" onChange={onChange} />);
    expect(
      screen.getByRole("button", { name: "Build model: GPT-5.6 Sol" }),
    ).toBeVisible();
  });

  it("shows the selected working family with verified metadata", () => {
    render(<BuildModelSelector value="build-kimi" onChange={jest.fn()} />);

    const trigger = screen.getByRole("button", {
      name: "Build model: Kimi K3",
    });
    expect(trigger).toBeVisible();
    expect(trigger).toHaveAttribute(
      "title",
      expect.stringContaining("1.05M context"),
    );
    expect(trigger).toHaveAttribute(
      "title",
      expect.stringContaining("reasoning, tools, vision"),
    );
  });

  it("shows the exact text-only Qwen3.8 Max contract", () => {
    render(<BuildModelSelector value="build-qwen" onChange={jest.fn()} />);

    const trigger = screen.getByRole("button", {
      name: "Build model: Qwen3.8 Max",
    });
    expect(trigger).toHaveAttribute(
      "title",
      expect.stringContaining("1M context"),
    );
    expect(trigger).toHaveAttribute(
      "title",
      expect.stringContaining("reasoning, tools"),
    );
    expect(trigger).not.toHaveAttribute(
      "title",
      expect.stringContaining("vision"),
    );
  });

  it("fits model logos and full names in a compact 280px menu", () => {
    render(<BuildModelSelector value="auto" onChange={jest.fn()} />);

    const menu = document.querySelector('[data-ui="model-selector-menu"]');
    expect(menu).toHaveClass("w-[280px]");
    expect(menu).toHaveClass("overflow-y-auto", "overscroll-contain");
    expect(menu).toHaveStyle({
      maxHeight:
        "min(520px, var(--radix-dropdown-menu-content-available-height, 70dvh))",
    });
  });

  it("uses semantic contrast for selection, details, and metadata", () => {
    render(<BuildModelSelector value="auto" onChange={jest.fn()} />);

    expect(
      screen.getByRole("button", { name: "Build model: GPT-5.6 Sol" }),
    ).toHaveClass("text-[var(--cursor-text-secondary)]");
    expect(
      document.querySelector('[data-ui="model-selector-model-name"]'),
    ).toHaveClass("text-foreground");
    expect(
      document.querySelector('[data-ui="model-selector-context"]'),
    ).toHaveClass("text-muted-foreground");
  });

  it("keeps the initial composer model menu below its trigger", () => {
    render(
      <BuildModelSelector value="auto" onChange={jest.fn()} openDownward />,
    );

    const menu = document.querySelector('[data-ui="model-selector-menu"]');
    expect(menu).toHaveAttribute("data-open-direction", "down");
    expect(menu).toHaveAttribute("data-side", "bottom");
    expect(menu).toHaveAttribute("data-avoid-collisions", "true");
    expect(
      screen.getByRole("button", { name: "Build model: GPT-5.6 Sol" }),
    ).toHaveClass("hover:bg-muted/70");
  });
});
