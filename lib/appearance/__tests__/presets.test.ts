import {
  APPEARANCE_BOOTSTRAP_SCRIPT,
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE_CONFIG,
  applyAppearanceConfig,
  applyPreset,
  getAccessibleTextColor,
  getContrastRatio,
  normalizeAppearanceConfig,
} from "../presets";

function mixColors(foreground: string, background: string, weight: number) {
  const channel = (color: string, offset: number) =>
    Number.parseInt(color.slice(offset, offset + 2), 16);
  return `#${[1, 3, 5]
    .map((offset) =>
      Math.round(
        channel(foreground, offset) * weight +
          channel(background, offset) * (1 - weight),
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

describe("appearance presets", () => {
  it("ships complete light and dark palettes for every app preset", () => {
    expect(APPEARANCE_PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(APPEARANCE_PRESETS.map((preset) => preset.id)).size).toBe(
      APPEARANCE_PRESETS.length,
    );

    for (const preset of APPEARANCE_PRESETS) {
      for (const mode of ["light", "dark"] as const) {
        for (const color of Object.values(preset[mode])) {
          expect(color).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    }
  });

  it("rejects invalid imported values without losing valid preferences", () => {
    const normalized = normalizeAppearanceConfig({
      ...DEFAULT_APPEARANCE_CONFIG,
      uiFontSize: 99,
      codeFontSize: 2,
      dark: {
        ...DEFAULT_APPEARANCE_CONFIG.dark,
        background: "url(javascript:bad)",
        accent: "#123456",
      },
    });

    expect(normalized.uiFontSize).toBe(18);
    expect(normalized.codeFontSize).toBe(11);
    expect(normalized.dark.background).toBe(
      DEFAULT_APPEARANCE_CONFIG.dark.background,
    );
    expect(normalized.dark.accent).toBe("#123456");
  });

  it("starts a new install with a complete Rift palette in both modes at 13px", () => {
    const rift = APPEARANCE_PRESETS.find((preset) => preset.id === "rift")!;
    expect(DEFAULT_APPEARANCE_CONFIG.uiFontSize).toBe(13);
    expect(DEFAULT_APPEARANCE_CONFIG.light).toEqual({
      preset: "rift",
      ...rift.light,
    });
    expect(DEFAULT_APPEARANCE_CONFIG.dark).toEqual({
      preset: "rift",
      ...rift.dark,
    });
  });

  it("keeps Graphite planes with crisp text in both modes", () => {
    const cursor = APPEARANCE_PRESETS.find((preset) => preset.id === "cursor");

    // Keep the existing light palette; dark planes follow Cursor Agents.
    expect(cursor?.light).toEqual({
      accent: "#141414",
      background: "#fcfcfc",
      foreground: "#141414",
      sidebar: "#f3f3f3",
      surface: "#f3f3f3",
      border: "#e3e3e3",
    });
    expect(cursor?.light.foreground).toBe("#141414");
    // Raw surface tokens are composed once by the native glass layer.
    expect(cursor?.dark).toMatchObject({
      background: "#141414",
      foreground: "#f0f0f0",
      sidebar: "#181818",
    });
  });

  it("migrates only the exact legacy Cursor defaults", () => {
    const legacyConfig = {
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
    const migrated = normalizeAppearanceConfig(legacyConfig);

    // Same rule as the previous-palette migration: refreshed to current
    // Cursor, not redirected to the new-install default.
    expect(migrated.dark.preset).toBe("cursor");
    expect(migrated.dark.background).toBe("#141414");
    expect(migrated.uiFontSize).toBe(13);

    const customized = normalizeAppearanceConfig({
      ...legacyConfig,
      dark: { ...legacyConfig.dark, border: "#333333" },
    });
    expect(customized.dark.border).toBe("#333333");
    expect(customized.uiFontSize).toBe(14);
  });

  it("applies the Cursor migration before hydration", () => {
    const legacyConfig = {
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
    window.localStorage.setItem(
      "rift:appearance:v1",
      JSON.stringify(legacyConfig),
    );
    window.localStorage.setItem("theme", "dark");

    window.eval(APPEARANCE_BOOTSTRAP_SCRIPT);

    expect(
      document.documentElement.style.getPropertyValue(
        "--rift-appearance-foreground",
      ),
    ).toBe("#f0f0f0");
    expect(
      document.documentElement.style.getPropertyValue(
        "--rift-appearance-background",
      ),
    ).toBe("#141414");
    expect(
      document.documentElement.style.getPropertyValue("--rift-ui-font-size"),
    ).toBe("13px");

    window.localStorage.clear();
  });

  it("migrates the complete previous Cursor palette", () => {
    const previousConfig = {
      ...DEFAULT_APPEARANCE_CONFIG,
      dark: {
        preset: "cursor",
        accent: "#969696",
        background: "#181818",
        foreground: "#f0f0f0",
        sidebar: "#181818",
        surface: "#1f1f1f",
        border: "#2b2b2b",
      },
    };

    // Refreshed to the current Cursor palette, NOT to whatever a new install
    // defaults to: someone who chose Cursor must keep Cursor.
    const migrated = normalizeAppearanceConfig(previousConfig).dark;
    expect(migrated.preset).toBe("cursor");
    expect(migrated.background).toBe("#141414");
    expect(migrated.sidebar).toBe("#181818");
    expect(migrated).not.toEqual(DEFAULT_APPEARANCE_CONFIG.dark);
  });

  it("migrates the palette that had the two planes swapped", () => {
    // A prior stock palette remains eligible for a complete refresh.
    const invertedConfig = {
      ...DEFAULT_APPEARANCE_CONFIG,
      dark: {
        preset: "cursor",
        accent: "#969696",
        background: "#141414",
        foreground: "#f0f0f0",
        sidebar: "#181818",
        surface: "#1f1f1f",
        border: "#2b2b2b",
      },
    };

    const migrated = normalizeAppearanceConfig(invertedConfig).dark;
    expect(migrated.preset).toBe("cursor");
    expect(migrated.background).toBe("#141414");
    expect(migrated.sidebar).toBe("#181818");

    window.localStorage.setItem(
      "rift:appearance:v1",
      JSON.stringify(invertedConfig),
    );
    window.localStorage.setItem("theme", "dark");
    window.eval(APPEARANCE_BOOTSTRAP_SCRIPT);
    expect(
      document.documentElement.style.getPropertyValue(
        "--rift-appearance-background",
      ),
    ).toBe("#141414");
    expect(
      document.documentElement.style.getPropertyValue(
        "--rift-appearance-sidebar",
      ),
    ).toBe("#181818");
    window.localStorage.clear();
  });

  it.each([
    ["rift", "light", "#363642"],
    ["rift", "dark", "#f2f2f7"],
  ] as const)(
    "refreshes saved %s %s text without resetting custom preferences",
    (presetId, mode, oldInk) => {
      const config = applyPreset(DEFAULT_APPEARANCE_CONFIG, mode, presetId);
      const saved = {
        ...config,
        uiFontSize: 15,
        [mode]: { ...config[mode], foreground: oldInk },
      };
      const refreshed = normalizeAppearanceConfig(saved);
      expect(refreshed[mode]).toEqual(config[mode]);
      expect(refreshed.uiFontSize).toBe(15);
      const customized = {
        ...saved,
        [mode]: { ...saved[mode], accent: "#123456" },
      };
      expect(normalizeAppearanceConfig(customized)[mode]).toEqual(
        customized[mode],
      );
    },
  );

  it("keeps the exact runtime text and control mixes contrast-safe", () => {
    for (const preset of APPEARANCE_PRESETS) {
      for (const mode of ["light", "dark"] as const) {
        const colors = preset[mode];
        const onAccent = getAccessibleTextColor(colors.accent);
        // These weights intentionally mirror app/globals.css. If the runtime
        // formulas change, this test must change with them rather than testing
        // a hypothetical friendlier mix.
        const graphite = preset.id === "cursor" && mode === "dark";
        const secondary = mixColors(
          colors.foreground,
          colors.background,
          graphite ? 0.74 : 0.86,
        );
        const tertiary = mixColors(
          colors.foreground,
          colors.background,
          graphite ? 0.6 : 0.84,
        );
        const caption = mixColors(
          colors.foreground,
          colors.background,
          graphite ? 0.56 : 0.82,
        );
        const controlBorder = mixColors(
          colors.border,
          colors.foreground,
          mode === "light" ? 0.45 : 0.6,
        );

        expect(
          getContrastRatio(colors.foreground, colors.background),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          getContrastRatio(onAccent, colors.accent),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          getContrastRatio(secondary, colors.background),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          getContrastRatio(tertiary, colors.background),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          getContrastRatio(caption, colors.background),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          getContrastRatio(controlBorder, colors.background),
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("applies the resolved mode to semantic runtime variables", () => {
    const config = applyPreset(DEFAULT_APPEARANCE_CONFIG, "light", "claude");
    applyAppearanceConfig(config, "light");

    expect(document.documentElement.dataset.riftPreset).toBe("claude");
    expect(
      document.documentElement.style.getPropertyValue(
        "--rift-appearance-background",
      ),
    ).toBe("#f7f4ee");
    expect(
      document.documentElement.style.getPropertyValue(
        "--rift-appearance-on-accent",
      ),
    ).toBe("#000000");
    expect(
      document.documentElement.style.getPropertyValue("--rift-root-font-size"),
    ).toBe(`${(16 * config.uiFontSize) / 13}px`);
    expect(
      document.documentElement.style.getPropertyValue("--rift-code-font-size"),
    ).toBe("14px");
  });

  it("ships a strict pre-hydration bootstrap for saved appearance settings", () => {
    expect(APPEARANCE_BOOTSTRAP_SCRIPT).toContain(
      'localStorage.getItem("rift:appearance:v1")',
    );
    expect(APPEARANCE_BOOTSTRAP_SCRIPT).toContain(
      "--rift-appearance-on-accent",
    );
    expect(APPEARANCE_BOOTSTRAP_SCRIPT).toContain("--rift-root-font-size");
    expect(APPEARANCE_BOOTSTRAP_SCRIPT).toContain("#f0f0f0");
    expect(APPEARANCE_BOOTSTRAP_SCRIPT).toContain(
      'root.dataset.riftAppearance="ready"',
    );
  });
});
