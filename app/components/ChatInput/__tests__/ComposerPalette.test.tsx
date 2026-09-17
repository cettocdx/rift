import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useQuery } from "convex/react";
import { getFunctionName } from "convex/server";
import { useRef, useState } from "react";
import { ComposerPalette } from "../ComposerPalette";
import { WEB_SLASH_COMMANDS } from "@/lib/composer/palette-items";
import {
  normalizeAgentRosterConfiguration,
  renderAgentRosterSkillInstructions,
} from "@/lib/ai/agents/pet-roster";
import type { ChatPurpose } from "@/types/chat";

jest.mock("convex/react", () => ({
  useQuery: jest.fn(),
}));

jest.mock("@/app/components/pro/ProShortcutsDialog", () => ({
  openShortcutsDialog: jest.fn(),
}));

interface PaletteHarnessProps {
  initialInput?: string;
  onClear?: jest.Mock;
  proShell?: boolean;
  purpose?: ChatPurpose;
}

function PaletteHarness({
  initialInput = "/",
  onClear,
  proShell = true,
  purpose = "app",
}: PaletteHarnessProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState(initialInput);
  const [cursorAt, setCursorAt] = useState(initialInput.length);
  const [inputRevision, setInputRevision] = useState(0);

  const updateInput = (next: string, nextCursor = next.length) => {
    setInput(next);
    setCursorAt(nextCursor);
    setInputRevision((revision) => revision + 1);
  };

  return (
    <>
      <textarea
        ref={inputRef}
        aria-label="Composer"
        data-testid="chat-input"
        value={input}
        onChange={(event) => updateInput(event.target.value)}
      />
      <button type="button">Outside action</button>
      <ComposerPalette
        input={input}
        inputRef={inputRef}
        cursorAt={cursorAt}
        inputRevision={inputRevision}
        onApply={updateInput}
        onClear={onClear}
        proShell={proShell}
        purpose={purpose}
      />
    </>
  );
}

function selectedOption() {
  return screen
    .getAllByRole("option")
    .find((option) => option.getAttribute("aria-selected") === "true");
}

describe("ComposerPalette", () => {
  let skills: unknown[];
  let servers: unknown[];

  beforeEach(() => {
    jest.clearAllMocks();
    skills = [];
    servers = [];
    jest.mocked(useQuery).mockImplementation((query) => {
      const functionName = getFunctionName(query as never);
      if (functionName === "skills:listForUser") return skills as never;
      if (functionName === "mcpServers:listForUser") return servers as never;
      return undefined;
    });
  });

  it("inserts exact runtime agent, skill, and verified MCP activations", () => {
    const configuration = normalizeAgentRosterConfiguration({
      activeAgentId: "build-engineer",
      workflowAgentIds: ["build-engineer"],
      customAgents: [
        {
          name: "Sentinel",
          petId: "german-shepherd",
          roleName: "Security Engineer",
          mission: "Review the current change for concrete security risk.",
          skillIds: [
            "recon-methodology",
            "web-vuln-hunting",
            "pentest-report",
            "ctf-playbook",
          ],
        },
      ],
    });
    skills = [
      {
        _id: "managed",
        catalog_id: "rift-agent-roster",
        description: "Managed crew",
        enabled: true,
        instructions: renderAgentRosterSkillInstructions(configuration),
        name: "RIFT Agent Crew",
      },
      {
        _id: "skill-1",
        catalog_id: "sql-data",
        description: "Work with real structured data.",
        enabled: true,
        name: "SQL Data",
      },
    ];
    servers = [
      {
        _id: "mcp-1",
        connectionStatus: "verified",
        enabled: true,
        name: "Repository tools",
      },
      {
        _id: "mcp-2",
        connectionStatus: "needs_attention",
        enabled: true,
        name: "Unavailable tools",
      },
    ];

    const { unmount } = render(<PaletteHarness initialInput="@agent:sent" />);
    const composer = screen.getByRole("textbox", { name: "Composer" });
    expect(screen.getByRole("option")).toHaveTextContent("@agent:sentinel");
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(composer).toHaveValue("@agent:sentinel ");
    unmount();

    const skillRender = render(<PaletteHarness initialInput="@skill:sql" />);
    const skillComposer = screen.getByRole("textbox", { name: "Composer" });
    expect(screen.getByRole("option")).toHaveTextContent("$sql-data");
    fireEvent.keyDown(skillComposer, { key: "Enter" });
    expect(skillComposer).toHaveValue("$sql-data ");
    skillRender.unmount();

    render(<PaletteHarness initialInput="@mcp:repo" />);
    const mcpComposer = screen.getByRole("textbox", { name: "Composer" });
    expect(screen.getByRole("option")).toHaveTextContent(
      "@mcp:Repository tools",
    );
    expect(screen.queryByText(/Unavailable tools/)).not.toBeInTheDocument();
    fireEvent.keyDown(mcpComposer, { key: "Enter" });
    expect(mcpComposer).toHaveValue("Use the “Repository tools” MCP tools ");
  });

  it("renders slash commands as a compact, labelled listbox", () => {
    render(<PaletteHarness />);
    const listbox = screen.getByRole("listbox", { name: "Commands" });
    const options = within(listbox).getAllByRole("option");

    expect(
      screen.getByText(`${WEB_SLASH_COMMANDS.length} results`),
    ).toBeVisible();
    expect(options).toHaveLength(WEB_SLASH_COMMANDS.length);
    expect(options[0]).toHaveTextContent(`/${WEB_SLASH_COMMANDS[0].id}`);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(
      options[0].querySelector('[data-ui="composer-palette-item-label"]'),
    ).toHaveTextContent(`/${WEB_SLASH_COMMANDS[0].id}`);
    expect(
      options[0].querySelector('[data-ui="composer-palette-item-description"]'),
    ).toHaveTextContent(WEB_SLASH_COMMANDS[0].description);
    // Slash categories label their groups without repeating a heading above
    // every individual command in the registry's keyboard order.
    expect(
      screen
        .getByTestId("composer-palette")
        .querySelectorAll('[id*="-group-"]'),
    ).toHaveLength(0);
  });

  it("exposes the selected command's full description and usage without hover", () => {
    render(<PaletteHarness initialInput="/goal" />);
    const command = WEB_SLASH_COMMANDS.find((item) => item.id === "goal")!;
    const help = screen.getByRole("region", { name: "Help for /goal" });
    expect(within(help).getByText(command.description)).toBeVisible();
    expect(
      within(help).getByText(`/goal ${command.argumentHint}`),
    ).toBeVisible();
    expect(help).not.toHaveAttribute("title");
  });

  it("updates help when keyboard selection changes and restores its scroll position", () => {
    render(<PaletteHarness />);
    const composer = screen.getByRole("textbox", { name: "Composer" });
    const first = WEB_SLASH_COMMANDS[0];
    const second = WEB_SLASH_COMMANDS[1];
    const help = screen.getByRole("region", { name: `Help for /${first.id}` });
    help.scrollTop = 80;
    fireEvent.keyDown(composer, { key: "ArrowDown" });
    expect(
      screen.getByRole("region", { name: `Help for /${second.id}` }),
    ).toHaveTextContent(second.description);
    expect(help.scrollTop).toBe(0);
    expect(composer).toHaveValue("/");
  });

  it("lets keyboard readers focus help and return to the unchanged composer", () => {
    render(<PaletteHarness initialInput="/goal" />);
    const composer = screen.getByRole("textbox", { name: "Composer" });
    composer.focus();
    fireEvent.keyDown(composer, { key: "F1" });
    const help = screen.getByRole("region", { name: "Help for /goal" });
    expect(help).toHaveFocus();
    expect(fireEvent.keyDown(help, { key: "ArrowDown" })).toBe(true);
    fireEvent.keyDown(help, { key: "Escape" });
    expect(composer).toHaveFocus();
    expect(composer).toHaveValue("/goal");
    expect(screen.getByRole("listbox", { name: "Commands" })).toBeVisible();
    fireEvent.keyDown(composer, { key: "Escape" });
    expect(
      screen.queryByRole("region", { name: "Help for /goal" }),
    ).not.toBeInTheDocument();
  });

  it("lets a touch activation inspect Clear before explicitly using it", () => {
    const onClear = jest.fn();
    render(<PaletteHarness initialInput="/cle" onClear={onClear} />);
    const option = screen.getByRole("option", { name: /\/clear/ });
    const pointer = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(pointer, "pointerType", { value: "touch" });
    fireEvent(option, pointer);
    fireEvent.click(option, { detail: 1 });
    expect(onClear).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Composer" })).toHaveValue(
      "/cle",
    );
    fireEvent.click(screen.getByRole("button", { name: "Use /clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: "Composer" })).toHaveValue("");
  });

  it.each([
    { bottom: 178, maxHeight: "46px", top: "186px" },
    { bottom: 180, maxHeight: "48px", top: "184px" },
  ])(
    "keeps a full touch target viewport and return from help at composer bottom $bottom",
    ({ bottom, maxHeight, top }) => {
      const originalHeight = window.innerHeight;
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 240,
      });
      const rect = jest
        .spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockReturnValue({
          top: 8,
          bottom,
          left: 8,
          right: 352,
          x: 8,
          y: 8,
          width: 344,
          height: bottom - 8,
          toJSON: () => ({}),
        });
      try {
        render(<PaletteHarness initialInput="/goal" />);
        const composer = screen.getByRole("textbox", { name: "Composer" });
        fireEvent.keyDown(composer, { key: "F1" });
        fireEvent.click(
          screen.getByRole("button", { name: "Back to commands" }),
        );
        expect(composer).toHaveFocus();
        expect(composer).toHaveValue("/goal");
        expect(screen.getByRole("option", { name: /\/goal/ })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        const descriptionId = screen
          .getByRole("option", { name: /\/goal/ })
          .getAttribute("aria-describedby");
        expect(descriptionId).toBeTruthy();
        expect(document.getElementById(descriptionId!)).toHaveTextContent(
          WEB_SLASH_COMMANDS.find((command) => command.id === "goal")!
            .description,
        );
        expect(screen.getByTestId("composer-palette")).toHaveStyle({
          maxHeight,
          top,
        });
      } finally {
        rect.mockRestore();
        Object.defineProperty(window, "innerHeight", {
          configurable: true,
          value: originalHeight,
        });
      }
    },
  );

  it("surfaces only slash commands with a real browser runtime", () => {
    render(<PaletteHarness initialInput="/" />);

    expect(screen.getByText("/theme")).toBeVisible();
    expect(screen.getByText("/permissions")).toBeVisible();
    expect(screen.queryByText("/worktree")).not.toBeInTheDocument();
    expect(screen.queryByText("/vim")).not.toBeInTheDocument();
    expect(screen.queryByText("/statusline")).not.toBeInTheDocument();
    expect(screen.queryByText("/recon")).not.toBeInTheDocument();
    expect(screen.queryByText("/network-scan")).not.toBeInTheDocument();
  });

  it("hides developer-agent prompt commands from the Studio catalog", () => {
    render(<PaletteHarness initialInput="/" purpose="image" />);

    for (const command of ["init", "review", "diff", "ps", "plan", "agent"]) {
      expect(screen.queryByText(`/${command}`)).not.toBeInTheDocument();
    }
    for (const command of ["model", "fast", "new", "task", "apps", "plugins"]) {
      expect(screen.getByText(`/${command}`)).toBeVisible();
    }
  });

  it("connects the active suggestion to the focused composer", () => {
    render(<PaletteHarness />);
    const composer = screen.getByRole("textbox", { name: "Composer" });
    const listbox = screen.getByRole("listbox", { name: "Commands" });
    const initialOption = selectedOption();

    expect(listbox).toHaveAttribute("id");
    expect(composer).toHaveAttribute("aria-autocomplete", "list");
    expect(composer).toHaveAttribute("aria-controls", listbox.id);
    expect(composer).toHaveAttribute(
      "aria-activedescendant",
      initialOption?.id,
    );

    fireEvent.keyDown(composer, { key: "ArrowDown" });
    expect(composer).toHaveAttribute(
      "aria-activedescendant",
      selectedOption()?.id,
    );
  });

  it("anchors above the composer and constrains the scroll region to the available viewport", () => {
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 720,
    });
    const rectSpy = jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getBoundingClientRect() {
        if ((this as HTMLElement).dataset.ui === "composer-palette-anchor") {
          return {
            bottom: 384,
            height: 69,
            left: 420,
            right: 1156,
            top: 315,
            width: 736,
            x: 420,
            y: 315,
            toJSON: () => ({}),
          };
        }
        return {
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          top: 0,
          width: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      });

    try {
      render(<PaletteHarness />);

      const palette = screen.getByTestId("composer-palette");
      const scrollRegion = palette.querySelector<HTMLElement>(
        '[data-ui="composer-palette-scroll"]',
      );

      expect(palette).toHaveAttribute("data-placement", "top");
      expect(palette).toHaveStyle({ bottom: "413px", width: "400px" });
      expect(
        Number.parseFloat(scrollRegion?.style.maxHeight ?? "0"),
      ).toBeLessThanOrEqual(237);
    } finally {
      rectSpy.mockRestore();
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalHeight,
      });
    }
  });

  it("stays inside the visual viewport when the software keyboard covers the composer", () => {
    const originalVisualViewport = Object.getOwnPropertyDescriptor(
      window,
      "visualViewport",
    );
    const visualViewport = new EventTarget();
    Object.defineProperties(visualViewport, {
      height: { configurable: true, value: 360 },
      offsetLeft: { configurable: true, value: 10 },
      offsetTop: { configurable: true, value: 200 },
      width: { configurable: true, value: 360 },
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });
    const rectSpy = jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getBoundingClientRect() {
        if ((this as HTMLElement).dataset.ui === "composer-palette-anchor") {
          return {
            bottom: 620,
            height: 80,
            left: 5,
            right: 485,
            top: 540,
            width: 480,
            x: 5,
            y: 540,
            toJSON: () => ({}),
          };
        }
        return {
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          top: 0,
          width: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      });

    try {
      render(<PaletteHarness />);

      const palette = screen.getByTestId("composer-palette");
      const scrollRegion = palette.querySelector<HTMLElement>(
        '[data-ui="composer-palette-scroll"]',
      );
      const bottomOffset = Number.parseFloat(palette.style.bottom);
      const paletteBottom = window.innerHeight - bottomOffset;
      const paletteMaxHeight =
        Number.parseFloat(scrollRegion?.style.maxHeight ?? "0") + 62;

      expect(palette).toHaveAttribute("data-placement", "top");
      expect(palette).toHaveStyle({ left: "18px", width: "344px" });
      expect(paletteBottom).toBeLessThanOrEqual(552);
      expect(paletteBottom - paletteMaxHeight).toBeGreaterThanOrEqual(208);
    } finally {
      rectSpy.mockRestore();
      if (originalVisualViewport) {
        Object.defineProperty(window, "visualViewport", originalVisualViewport);
      } else {
        delete (window as Window & { visualViewport?: VisualViewport })
          .visualViewport;
      }
    }
  });

  it("flips below the composer when the upper viewport is too shallow", () => {
    const rectSpy = jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getBoundingClientRect() {
        if ((this as HTMLElement).dataset.ui === "composer-palette-anchor") {
          return {
            bottom: 120,
            height: 56,
            left: 24,
            right: 504,
            top: 64,
            width: 480,
            x: 24,
            y: 64,
            toJSON: () => ({}),
          };
        }
        return {
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          top: 0,
          width: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      });

    try {
      render(<PaletteHarness />);
      expect(screen.getByTestId("composer-palette")).toHaveAttribute(
        "data-placement",
        "bottom",
      );
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("only handles palette shortcuts while the composer owns the event", () => {
    render(<PaletteHarness />);
    const composer = screen.getByRole("textbox", { name: "Composer" });

    fireEvent.keyDown(screen.getByRole("button", { name: "Outside action" }), {
      key: "Enter",
    });
    expect(composer).toHaveValue("/");

    fireEvent.keyDown(composer, { key: "Enter" });
    expect(composer).toHaveValue(WEB_SLASH_COMMANDS[0].insert);
  });

  it("supports Arrow, Home and End navigation with wrapping", () => {
    render(<PaletteHarness />);
    const composer = screen.getByRole("textbox", { name: "Composer" });
    const lastCommand = WEB_SLASH_COMMANDS.at(-1);

    fireEvent.keyDown(composer, { key: "ArrowDown" });
    expect(selectedOption()).toHaveTextContent(`/${WEB_SLASH_COMMANDS[1].id}`);

    fireEvent.keyDown(composer, { key: "End" });
    expect(selectedOption()).toHaveTextContent(`/${lastCommand?.id}`);

    fireEvent.keyDown(composer, { key: "Home" });
    expect(selectedOption()).toHaveTextContent(`/${WEB_SLASH_COMMANDS[0].id}`);

    fireEvent.keyDown(composer, { key: "ArrowUp" });
    expect(selectedOption()).toHaveTextContent(`/${lastCommand?.id}`);

    fireEvent.keyDown(composer, { key: "ArrowDown" });
    expect(selectedOption()).toHaveTextContent(`/${WEB_SLASH_COMMANDS[0].id}`);
  });

  it("fully reveals End selection while the menu entrance is scaled", () => {
    render(<PaletteHarness />);
    const list = screen
      .getByTestId("composer-palette")
      .querySelector<HTMLElement>('[data-ui="composer-palette-scroll"]')!;
    const last = screen.getAllByRole("option").at(-1)!;
    Object.defineProperties(list, {
      offsetHeight: { configurable: true, value: 200 },
      clientHeight: { configurable: true, value: 200 },
    });
    const box = (top: number, height: number) => ({
      x: 0,
      y: top,
      top,
      left: 0,
      right: 294,
      bottom: top + height,
      width: 294,
      height,
      toJSON: () => ({}),
    });
    // The entrance transforms every descendant, but scrollTop remains in
    // layout pixels. A last row ending at 1400 needs 1200px of local scroll.
    const listRect = jest
      .spyOn(list, "getBoundingClientRect")
      .mockImplementation(() => box(100, 200 * 0.98));
    const itemRect = jest
      .spyOn(last, "getBoundingClientRect")
      .mockImplementation(() =>
        box(100 + (1356 - list.scrollTop) * 0.98, 44 * 0.98),
      );
    try {
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Composer" }), {
        key: "End",
      });
      expect(selectedOption()).toBe(last);
      expect(list.scrollTop).toBeCloseTo(1200);
      expect(last.getBoundingClientRect().bottom).toBeCloseTo(
        list.getBoundingClientRect().bottom,
        9,
      );
    } finally {
      listRect.mockRestore();
      itemRect.mockRestore();
    }
  });

  it("selects the active option with Tab", () => {
    render(<PaletteHarness />);
    const composer = screen.getByRole("textbox", { name: "Composer" });

    fireEvent.keyDown(composer, { key: "ArrowDown" });
    fireEvent.keyDown(composer, { key: "Tab" });

    expect(composer).toHaveValue(WEB_SLASH_COMMANDS[1].insert);
  });

  it.each(["shiftKey", "ctrlKey", "metaKey", "altKey"])(
    "leaves %s modified editor keys unconsumed without applying a command",
    (modifier) => {
      const onClear = jest.fn();
      render(<PaletteHarness initialInput="/cle" onClear={onClear} />);
      const composer = screen.getByRole("textbox", { name: "Composer" });
      const selected = selectedOption();
      for (const key of [
        "ArrowDown",
        "ArrowUp",
        "Home",
        "End",
        "Enter",
        "Tab",
        "Escape",
      ]) {
        expect(fireEvent.keyDown(composer, { key, [modifier]: true })).toBe(
          true,
        );
        expect(composer).toHaveValue("/cle");
        expect(selectedOption()).toBe(selected);
        expect(onClear).not.toHaveBeenCalled();
      }
    },
  );

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "leaves composition keys to the input method (%j)",
    (composition) => {
      const onClear = jest.fn();
      render(<PaletteHarness initialInput="/cle" onClear={onClear} />);
      const composer = screen.getByRole("textbox", { name: "Composer" });
      const selected = selectedOption();
      for (const key of ["ArrowDown", "Enter", "Escape"]) {
        expect(fireEvent.keyDown(composer, { key, ...composition })).toBe(true);
        expect(composer).toHaveValue("/cle");
        expect(selectedOption()).toBe(selected);
        expect(onClear).not.toHaveBeenCalled();
      }
    },
  );

  it("dismisses an exact /model reapplication so Enter is not trapped", () => {
    render(<PaletteHarness initialInput="/model" />);
    const composer = screen.getByRole("textbox", { name: "Composer" });

    expect(screen.getByRole("listbox", { name: "Commands" })).toBeVisible();
    fireEvent.keyDown(composer, { key: "Enter" });

    expect(composer).toHaveValue("/model");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("reopens a dismissed trigger after the input is edited and recreated", () => {
    render(<PaletteHarness />);
    const composer = screen.getByRole("textbox", { name: "Composer" });

    fireEvent.keyDown(composer, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.change(composer, { target: { value: "" } });
    fireEvent.change(composer, { target: { value: "/" } });
    expect(screen.getByRole("listbox", { name: "Commands" })).toBeVisible();
  });

  it("keeps the palette visible with a useful empty state", () => {
    render(<PaletteHarness initialInput="/definitely-unknown" />);

    expect(screen.getByRole("listbox", { name: "Commands" })).toBeVisible();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("0 results")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "No matching commands",
    );
  });

  it("applies palette options through their native click activation", () => {
    const onClear = jest.fn();
    render(<PaletteHarness initialInput="/clear" onClear={onClear} />);

    fireEvent.click(screen.getByRole("option", { name: /\/clear/i }));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: "Composer" })).toHaveValue("");
  });

  it("preserves context-source filtering and insertion in Pro Shell", () => {
    render(<PaletteHarness initialInput="Review @fi" />);

    const listbox = screen.getByRole("listbox", { name: "Context" });
    expect(within(listbox).getAllByRole("option")).toHaveLength(1);
    expect(within(listbox).getByRole("option")).toHaveTextContent("@files");
    expect(
      within(listbox)
        .getByRole("option")
        .querySelector('[data-ui="composer-palette-item-label"]'),
    ).toHaveTextContent("Files");

    fireEvent.click(within(listbox).getByRole("option"));
    expect(screen.getByRole("textbox", { name: "Composer" })).toHaveValue(
      "Review @files ",
    );
  });

  it("does not expose context sources outside Pro Shell", () => {
    render(<PaletteHarness initialInput="@" proShell={false} />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("feature-detects command grouping, arguments, categories and shortcuts", () => {
    const metadataCommand = {
      id: "deploy-preview",
      label: "Deploy preview",
      description: "Publish the current workspace for review",
      icon: WEB_SLASH_COMMANDS[0].icon,
      insert: "/deploy-preview ",
      group: "Workflow",
      category: "Project",
      argumentHint: "[environment]",
      shortcut: ["⌘", "D"],
    } as unknown as (typeof WEB_SLASH_COMMANDS)[number];

    WEB_SLASH_COMMANDS.push(metadataCommand);
    try {
      render(<PaletteHarness initialInput="/deploy" />);

      const option = screen.getByRole("option", { name: /\/deploy-preview/i });
      expect(screen.getByRole("group", { name: "Workflow" })).toBeVisible();
      expect(option).toHaveTextContent("[environment]");
      expect(option).toHaveTextContent("Project");
      expect(option).toHaveTextContent("⌘ D");
      expect(screen.getByText("1 result")).toBeVisible();
    } finally {
      WEB_SLASH_COMMANDS.pop();
    }
  });
});
