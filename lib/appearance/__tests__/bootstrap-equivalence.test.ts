import {
  APPEARANCE_BOOTSTRAP_SCRIPT,
  APPEARANCE_PRESETS,
  APPEARANCE_CSS_VARS,
  APPEARANCE_DATASET_KEYS,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE_CONFIG,
  applyAppearanceConfig,
  normalizeAppearanceConfig,
} from "../presets";

/**
 * The bootstrap script is a hand-written copy of normalizeAppearanceConfig +
 * applyAppearanceConfig. It runs before any bundle loads, so it cannot import
 * them, and nothing but a test stops the two from drifting — a drift shows up
 * as the wrong palette for one frame on every cold load, or as the wrong
 * palette entirely if React never corrects it.
 */

function resetDocument() {
  const root = document.documentElement;
  APPEARANCE_DATASET_KEYS.forEach((key) => {
    delete root.dataset[key];
  });
  APPEARANCE_CSS_VARS.forEach((property) => {
    root.style.removeProperty(property);
  });
}

function snapshot() {
  const root = document.documentElement;
  return {
    dataset: Object.fromEntries(
      APPEARANCE_DATASET_KEYS.map((key) => [key, root.dataset[key] ?? null]),
    ),
    style: Object.fromEntries(
      APPEARANCE_CSS_VARS.map((property) => [
        property,
        root.style.getPropertyValue(property) || null,
      ]),
    ),
  };
}

function runBootstrap() {
  resetDocument();
  // Indirect eval, so the script runs in global scope exactly as it does in
  // the document head rather than closing over this module's bindings.
  (0, eval)(APPEARANCE_BOOTSTRAP_SCRIPT);
  return snapshot();
}

function runRuntime(raw: string | null, theme: string | null) {
  resetDocument();
  if (raw === null) return snapshot();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return snapshot();
  }
  const prefersDark = false;
  const mode =
    theme === "light"
      ? "light"
      : theme === "system"
        ? prefersDark
          ? "dark"
          : "light"
        : "dark";
  applyAppearanceConfig(normalizeAppearanceConfig(parsed), mode);
  return snapshot();
}

function seed(config: unknown, theme = "dark") {
  window.localStorage.clear();
  if (config !== undefined) {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(config));
  }
  window.localStorage.setItem("theme", theme);
}

// Only the OLED preset ever carried the amber, and the shipped light default
// is Graphite — so the light half of this fixture has to name OLED explicitly.
const RETIRED_AMBER_CONFIG = {
  ...DEFAULT_APPEARANCE_CONFIG,
  dark: {
    ...DEFAULT_APPEARANCE_CONFIG.dark,
    preset: "oled",
    accent: "#d98330",
  },
  light: {
    preset: "oled" as const,
    accent: "#a8510e",
    background: "#ffffff",
    foreground: "#111111",
    sidebar: "#f6f6f6",
    surface: "#f0f0f0",
    border: "#e0e0e0",
  },
};

const LEGACY_CURSOR_CONFIG = {
  ...DEFAULT_APPEARANCE_CONFIG,
  uiFontSize: 14,
  dark: {
    preset: "cursor",
    accent: "#969696",
    background: "#191919",
    foreground: "#d8d8d8",
    sidebar: "#232323",
    surface: "#212121",
    border: "#303030",
  },
};

const RETIRED_CURSOR_PALETTES = [
  {
    preset: "cursor",
    accent: "#969696",
    background: "#191919",
    foreground: "#f5f5f5",
    sidebar: "#232122",
    surface: "#212121",
    border: "#2f2d2e",
  },
  LEGACY_CURSOR_CONFIG.dark,
  {
    preset: "cursor",
    accent: "#969696",
    background: "#181818",
    foreground: "#f0f0f0",
    sidebar: "#181818",
    surface: "#1f1f1f",
    border: "#2b2b2b",
  },
  {
    preset: "cursor",
    accent: "#969696",
    background: "#141414",
    foreground: "#f0f0f0",
    sidebar: "#181818",
    surface: "#1f1f1f",
    border: "#2b2b2b",
  },
  {
    preset: "cursor",
    accent: "#969696",
    background: "#181818",
    foreground: "#f0f0f0",
    sidebar: "#141414",
    surface: "#1f1f1f",
    border: "#282828",
  },
  {
    preset: "cursor",
    accent: "#969696",
    background: "#151515",
    foreground: "#c3c2b8",
    sidebar: "#111111",
    surface: "#212121",
    border: "#292929",
  },
  {
    preset: "cursor",
    accent: "#969696",
    background: "#151515",
    foreground: "#f5f5f5",
    sidebar: "#111111",
    surface: "#212121",
    border: "#292929",
  },
];

describe("appearance bootstrap equivalence", () => {
  afterEach(() => {
    resetDocument();
    window.localStorage.clear();
  });

  it.each([
    ["a stored default config, dark", DEFAULT_APPEARANCE_CONFIG, "dark"],
    ["a stored default config, light", DEFAULT_APPEARANCE_CONFIG, "light"],
    ["a legacy Cursor palette", LEGACY_CURSOR_CONFIG, "dark"],
    ...(
      [
        ["rift", "light", "#363642"],
        ["rift", "dark", "#f2f2f7"],
        ["cursor", "dark", "#c3c2b8"],
      ] as const
    ).map(([presetId, mode, foreground]) => {
      const preset = APPEARANCE_PRESETS.find((entry) => entry.id === presetId)!;
      return [
        `the previous ${presetId} ${mode} reading color`,
        {
          ...DEFAULT_APPEARANCE_CONFIG,
          [mode]: { preset: presetId, ...preset[mode], foreground },
        },
        mode,
      ];
    }),

    ["the retired amber accent, dark", RETIRED_AMBER_CONFIG, "dark"],
    ["the retired amber accent, light", RETIRED_AMBER_CONFIG, "light"],
    [
      "font sizes out of range",
      { ...DEFAULT_APPEARANCE_CONFIG, uiFontSize: 99, codeFontSize: 2 },
      "dark",
    ],
    [
      "a non-standard preference",
      {
        ...DEFAULT_APPEARANCE_CONFIG,
        uiFont: "space-grotesk",
        codeFont: "menlo",
        contrast: "high",
        translucentSidebar: false,
        pointerCursors: false,
      },
      "dark",
    ],
  ])("leaves the document identical for %s", (_label, config, theme) => {
    seed(config, theme);
    const fromScript = runBootstrap();

    seed(config, theme);
    const fromRuntime = runRuntime(
      window.localStorage.getItem(APPEARANCE_STORAGE_KEY),
      theme,
    );

    expect(fromScript).toEqual(fromRuntime);
    // And it actually did something, so an all-null match cannot pass.
    expect(fromScript.dataset.riftAppearance).toBe("ready");
  });

  it.each(RETIRED_CURSOR_PALETTES)(
    "refreshes only exact retired Cursor palette %# before and after hydration",
    (dark) => {
      const config = { ...DEFAULT_APPEARANCE_CONFIG, uiFontSize: 15, dark };
      seed(config);
      const before = runBootstrap();
      const normalized = normalizeAppearanceConfig(config);
      expect(normalized.dark).toEqual({
        preset: "cursor",
        accent: "#969696",
        background: "#141414",
        foreground: "#f0f0f0",
        sidebar: "#181818",
        surface: "#212121",
        border: "#2f2d2e",
      });
      expect(normalized.uiFontSize).toBe(15);
      expect(before).toEqual(runRuntime(JSON.stringify(config), "dark"));
      expect(before.style["--rift-appearance-sidebar"]).toBe("#181818");
      expect(before.style["--rift-appearance-background"]).toBe("#141414");

      for (const field of [
        "accent",
        "background",
        "foreground",
        "sidebar",
        "surface",
        "border",
      ]) {
        const custom = { ...config, dark: { ...dark, [field]: "#123456" } };
        expect(normalizeAppearanceConfig(custom).dark).toEqual(custom.dark);
        seed(custom);
        expect(runBootstrap()).toEqual(
          runRuntime(JSON.stringify(custom), "dark"),
        );
      }
    },
  );

  it.each(APPEARANCE_PRESETS)(
    "preserves current $id colors in both modes",
    (preset) => {
      const config = {
        ...DEFAULT_APPEARANCE_CONFIG,
        light: { preset: preset.id, ...preset.light },
        dark: { preset: preset.id, ...preset.dark },
      };
      const normalized = normalizeAppearanceConfig(config);
      expect(normalized.light).toEqual(config.light);
      expect(normalized.dark).toEqual(config.dark);
      for (const mode of ["light", "dark"]) {
        seed(config, mode);
        expect(runBootstrap()).toEqual(
          runRuntime(JSON.stringify(config), mode),
        );
      }
    },
  );

  it("carries a stored amber accent forward in both paths", () => {
    // The accent was the only saturated colour in a monochrome product. Both
    // the script and the runtime have to retire it, or a cold load flashes the
    // old colour before React corrects it.
    seed(RETIRED_AMBER_CONFIG, "dark");
    expect(runBootstrap().style["--rift-appearance-accent"]).toBe("#f5f5f5");

    seed(RETIRED_AMBER_CONFIG, "light");
    expect(runBootstrap().style["--rift-appearance-accent"]).toBe("#111111");

    // A chosen accent is a choice, so only the exact retired values move.
    seed(
      {
        ...DEFAULT_APPEARANCE_CONFIG,
        dark: { ...DEFAULT_APPEARANCE_CONFIG.dark, accent: "#ff8800" },
      },
      "dark",
    );
    expect(runBootstrap().style["--rift-appearance-accent"]).toBe("#ff8800");
  });

  it("defaults every pre-v5 config to the solid panel, and keeps a v5 opt-in", () => {
    // Glass WAS the default through v4, so a stored translucentSidebar: true
    // from that era is this shell's choice rather than the user's. Honouring
    // it would pin every existing install to the 82% pane that never read as
    // crisp as the reference windows; only a true written after the default
    // flipped (v5) counts as someone turning the glass back on.
    const shellChosen = {
      ...DEFAULT_APPEARANCE_CONFIG,
      version: 4,
      translucentSidebar: true,
    };
    seed(shellChosen, "dark");
    const fromScript = runBootstrap();
    seed(shellChosen, "dark");
    const fromRuntime = runRuntime(
      window.localStorage.getItem(APPEARANCE_STORAGE_KEY),
      "dark",
    );
    expect(fromScript.dataset.riftSidebar).toBe("solid");
    // Both paths must agree, or a cold load flashes the wrong material before
    // React corrects it.
    expect(fromScript).toEqual(fromRuntime);

    // Turned on deliberately on a v5 config, it stays on.
    const userChosen = {
      ...DEFAULT_APPEARANCE_CONFIG,
      version: 5,
      translucentSidebar: true,
    };
    seed(userChosen, "dark");
    expect(runBootstrap().dataset.riftSidebar).toBe("translucent");
    seed(userChosen, "dark");
    expect(
      runRuntime(window.localStorage.getItem(APPEARANCE_STORAGE_KEY), "dark")
        .dataset.riftSidebar,
    ).toBe("translucent");
  });

  it("touches nothing when there is no stored config", () => {
    seed(undefined);
    const fromScript = runBootstrap();

    expect(fromScript.dataset.riftAppearance).toBeNull();
    expect(fromScript.style["--rift-appearance-accent"]).toBeNull();
  });

  it.each([
    ["unparseable JSON", "{not json"],
    [
      "a config with an invalid colour",
      JSON.stringify({
        ...DEFAULT_APPEARANCE_CONFIG,
        dark: { ...DEFAULT_APPEARANCE_CONFIG.dark, accent: "red" },
      }),
    ],
  ])("leaves the document untouched for %s", (_label, raw) => {
    window.localStorage.clear();
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, raw);
    window.localStorage.setItem("theme", "dark");

    const fromScript = runBootstrap();

    // The script deliberately bails rather than guessing: React applies the
    // real defaults a moment later, and a wrong guess would flash first.
    expect(fromScript.dataset.riftAppearance).toBeNull();
  });

  it("writes every property the runtime writes", () => {
    APPEARANCE_CSS_VARS.forEach((property) => {
      expect(APPEARANCE_BOOTSTRAP_SCRIPT).toContain(property);
    });
    // The dataset keys appear in the script as their attribute form.
    expect(APPEARANCE_BOOTSTRAP_SCRIPT).toContain(
      "root.dataset.riftAppearance",
    );
    expect(APPEARANCE_BOOTSTRAP_SCRIPT).toContain("root.dataset.riftUiFont");
    expect(APPEARANCE_BOOTSTRAP_SCRIPT).toContain("root.dataset.riftSidebar");
  });
});
