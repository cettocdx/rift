import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE_CONFIG,
} from "@/lib/appearance/presets";

const mockSetTheme = jest.fn();
const mockNextThemeProvider = jest.fn(
  ({ children }: { children: React.ReactNode }) => <>{children}</>,
);
let currentTheme = "dark";
let currentResolvedTheme = "dark";

jest.mock("next-themes", () => ({
  useTheme: () => ({
    theme: currentTheme,
    resolvedTheme: currentResolvedTheme,
    setTheme: mockSetTheme,
  }),
  ThemeProvider: (props: { children: React.ReactNode }) =>
    mockNextThemeProvider(props),
}));

const { AppearanceSettingsTab } = jest.requireActual<
  typeof import("../AppearanceSettingsTab")
>("../AppearanceSettingsTab");
const { ThemeProvider } =
  jest.requireActual<typeof import("../ThemeProvider")>("../ThemeProvider");

describe("Appearance settings", () => {
  beforeEach(() => {
    currentTheme = "dark";
    currentResolvedTheme = "dark";
    mockSetTheme.mockClear();
    mockNextThemeProvider.mockClear();
    window.localStorage.clear();
    document.documentElement.removeAttribute("style");
    for (const attribute of [...document.documentElement.attributes]) {
      if (attribute.name.startsWith("data-rift-")) {
        document.documentElement.removeAttribute(attribute.name);
      }
    }
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: jest.fn().mockResolvedValue(undefined as never) },
    });
  });

  it("offers light, dark, and system modes and persists the selection", () => {
    render(<AppearanceSettingsTab />);

    expect(screen.getByRole("button", { name: /Dark/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: /System/i }));

    expect(mockSetTheme).toHaveBeenCalledWith("system");
    expect(
      screen.getByText("System mode saved on this device."),
    ).toBeInTheDocument();
  });

  it("provides independent app presets for light and dark mode", () => {
    render(<AppearanceSettingsTab />);

    fireEvent.change(screen.getByLabelText("dark preset"), {
      target: { value: "codex" },
    });

    expect(screen.getByLabelText("dark preset")).toHaveValue("codex");
    expect(document.documentElement).toHaveAttribute(
      "data-rift-preset",
      "codex",
    );
    expect(
      document.documentElement.style.getPropertyValue(
        "--rift-appearance-accent",
      ),
    ).toBe("#339cff");
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toContain(
      '"preset":"codex"',
    );
  });

  it("edits colors and typography as live device preferences", () => {
    render(<AppearanceSettingsTab />);

    fireEvent.change(screen.getAllByLabelText("Foreground color")[1], {
      target: { value: "#101010" },
    });
    fireEvent.change(screen.getByLabelText("UI font"), {
      target: { value: "geist" },
    });

    expect(document.documentElement).toHaveAttribute(
      "data-rift-ui-font",
      "geist",
    );
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toContain(
      '"uiFont":"geist"',
    );
  });

  it("copies a reusable theme document", async () => {
    render(<AppearanceSettingsTab />);

    fireEvent.click(screen.getAllByRole("button", { name: /Copy theme/i })[1]);

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('"mode": "dark"'),
      ),
    );
  });

  it.each([
    ["empty object", {}],
    [
      "package manifest",
      {
        name: "example-app",
        version: "1.0.0",
        scripts: { build: "next build" },
      },
    ],
    ["array", []],
    ["empty wrapper", { version: 1, mode: "dark", theme: {} }],
    [
      "invalid color",
      { ...DEFAULT_APPEARANCE_CONFIG.dark, foreground: "not-a-color" },
    ],
  ])(
    "rejects %s as a theme and preserves the current saved appearance",
    async (_name, document) => {
      const { container } = render(<AppearanceSettingsTab />);
      fireEvent.change(screen.getAllByLabelText("Foreground color")[1], {
        target: { value: "#abcdef" },
      });
      const saved = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
      const applied = window.document.documentElement.getAttribute("style");
      const fileInput = container.querySelector('input[type="file"]')!;
      fireEvent.change(fileInput, {
        target: { files: [{ text: async () => JSON.stringify(document) }] },
      });
      await waitFor(() =>
        expect(
          screen.getByText(
            "That file is not a valid RIFT theme JSON document.",
          ),
        ).toBeInTheDocument(),
      );
      expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe(saved);
      expect(window.document.documentElement.getAttribute("style")).toBe(
        applied,
      );
      expect(screen.getAllByLabelText("Foreground color")[1]).toHaveValue(
        "#abcdef",
      );
      expect(
        screen.queryByText("dark theme imported."),
      ).not.toBeInTheDocument();
    },
  );

  it.each(["exported", "raw"])(
    "imports a valid %s palette without changing the other mode or typography",
    async (format) => {
      const { container } = render(<AppearanceSettingsTab />);
      fireEvent.change(screen.getByLabelText("UI font"), {
        target: { value: "geist" },
      });
      const saved = JSON.parse(
        window.localStorage.getItem(APPEARANCE_STORAGE_KEY)!,
      );
      const palette = {
        ...DEFAULT_APPEARANCE_CONFIG.dark,
        foreground: "#abcdef",
      };
      const document =
        format === "exported"
          ? { version: 1, mode: "dark", theme: palette }
          : palette;
      fireEvent.change(container.querySelector('input[type="file"]')!, {
        target: { files: [{ text: async () => JSON.stringify(document) }] },
      });
      await waitFor(() =>
        expect(screen.getByText("dark theme imported.")).toBeInTheDocument(),
      );
      const imported = JSON.parse(
        window.localStorage.getItem(APPEARANCE_STORAGE_KEY)!,
      );
      expect(imported.dark.foreground).toBe("#abcdef");
      expect(imported.light).toEqual(saved.light);
      expect(imported.uiFont).toBe("geist");
    },
  );

  it("no longer offers a second copy of itself to open", () => {
    // Appearance used to be both a settings tab and its own page, with a link
    // between them. There is one surface now: /settings/appearance.
    render(<AppearanceSettingsTab />);

    expect(
      screen.queryByRole("link", { name: /Open full page/i }),
    ).not.toBeInTheDocument();
  });

  it("enables next-themes system persistence and the appearance runtime", () => {
    render(
      <ThemeProvider>
        <div>App</div>
      </ThemeProvider>,
    );

    const providerProps = mockNextThemeProvider.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(providerProps).toEqual(
      expect.objectContaining({
        attribute: "class",
        defaultTheme: "dark",
        enableSystem: true,
        enableColorScheme: true,
        disableTransitionOnChange: true,
      }),
    );
    expect(document.documentElement).toHaveAttribute(
      "data-rift-appearance",
      "ready",
    );
  });
});
