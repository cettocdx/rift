"use client";

import styles from "./AppearanceSettingsTab.module.css";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Check,
  Copy,
  FileUp,
  Monitor,
  Moon,
  RotateCcw,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Switch } from "@/components/ui/switch";
import {
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE_CONFIG,
  applyPreset,
  loadAppearanceConfig,
  normalizeAppearanceConfig,
  saveAppearanceConfig,
  type AppearanceConfig,
  type AppearanceColors,
  type AppearanceMode,
  type AppearancePresetId,
} from "@/lib/appearance/presets";

type ColorTheme = "light" | "dark" | "system";

const THEME_OPTIONS: ReadonlyArray<{
  id: ColorTheme;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
] as const;

const UI_FONTS = [
  { id: "system", label: "System UI" },
  { id: "geist", label: "Geist" },
  { id: "space-grotesk", label: "Space Grotesk" },
] as const;

const CODE_FONTS = [
  { id: "sf-mono", label: "SF Mono" },
  { id: "jetbrains", label: "JetBrains Mono" },
  { id: "menlo", label: "Menlo" },
] as const;

const subscribeToHydration = () => () => undefined;

function cloneDefaultConfig() {
  return normalizeAppearanceConfig(DEFAULT_APPEARANCE_CONFIG);
}

function importedThemePalette(
  value: unknown,
): AppearanceColors & { preset?: AppearancePresetId } {
  const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
    candidate !== null &&
    typeof candidate === "object" &&
    !Array.isArray(candidate);
  const invalid = () => new Error("Invalid RIFT theme document");
  if (!isRecord(value)) throw invalid();

  // Accept the copied v1 document and legacy bare palettes. Storage recovery
  // intentionally supplies defaults, so it must not validate imported files.
  let palette = value;
  if ("theme" in value) {
    if (value.version !== undefined && value.version !== 1) throw invalid();
    if (
      value.mode !== undefined &&
      value.mode !== "light" &&
      value.mode !== "dark"
    )
      throw invalid();
    if (!isRecord(value.theme)) throw invalid();
    palette = value.theme;
  }
  const colors: readonly (keyof AppearanceColors)[] = [
    "accent",
    "background",
    "foreground",
    "sidebar",
    "surface",
    "border",
  ];
  if (
    !colors.every(
      (key) =>
        typeof palette[key] === "string" &&
        /^#[0-9a-f]{6}$/i.test(palette[key] as string),
    )
  )
    throw invalid();
  if (
    palette.preset !== undefined &&
    !APPEARANCE_PRESETS.some((preset) => preset.id === palette.preset)
  )
    throw invalid();
  return palette as AppearanceColors & { preset?: AppearancePresetId };
}

function ThemePreview({
  config,
  mode,
}: {
  config: AppearanceConfig;
  mode: AppearanceMode;
}) {
  const colors = config[mode];
  return (
    <div
      className="overflow-hidden rounded-[8px] border text-ui-caption shadow-sm"
      style={{
        background: colors.background,
        borderColor: colors.border,
        color: colors.foreground,
      }}
      role="img"
      aria-label={`${mode} theme live preview`}
    >
      <div
        className="flex h-7 items-center gap-1.5 border-b px-2.5"
        style={{ borderColor: colors.border }}
      >
        <span
          className="size-1.5 rounded-full opacity-40"
          style={{ background: colors.foreground }}
        />
        <span
          className="size-1.5 rounded-full opacity-25"
          style={{ background: colors.foreground }}
        />
        <span className="ml-1 opacity-55">app/page.tsx</span>
      </div>
      <div className="grid grid-cols-[64px_minmax(0,1fr)]">
        <div
          className="space-y-2 px-2 py-2.5"
          style={{ background: colors.sidebar }}
        >
          <span
            className="block h-1.5 w-9 rounded-full opacity-55"
            style={{ background: colors.foreground }}
          />
          <span
            className="block h-1.5 w-11 rounded-full opacity-20"
            style={{ background: colors.foreground }}
          />
          <span
            className="block h-1.5 w-7 rounded-full opacity-20"
            style={{ background: colors.foreground }}
          />
        </div>
        <div
          className="space-y-1.5 p-2.5 font-mono"
          style={{ fontSize: `${Math.max(9, config.codeFontSize - 4)}px` }}
        >
          <p className="opacity-55">export function Rift() {"{"}</p>
          <p
            className="rounded-sm px-1 py-0.5"
            style={{
              background: `color-mix(in srgb, ${colors.accent} 14%, transparent)`,
              color: colors.accent,
            }}
          >
            + return &lt;Build ready /&gt;
          </p>
          <p
            className="rounded-sm px-1 py-0.5 opacity-70"
            style={{
              background: `color-mix(in srgb, ${colors.foreground} 7%, transparent)`,
            }}
          >
            - return &lt;Draft /&gt;
          </p>
          <p className="opacity-55">{"}"}</p>
        </div>
      </div>
    </div>
  );
}

function ColorControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid grid-cols-[1fr_auto] items-center gap-3 py-1.5 text-ui-caption">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <code className="font-mono text-[9.5px] text-foreground/75">
          {value.toUpperCase()}
        </code>
        <span
          className={`${styles.colorTarget} relative size-5 overflow-hidden rounded-[5px] border border-border shadow-xs`}
        >
          <input
            type="color"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="absolute -inset-2 size-10 cursor-pointer border-0 bg-transparent p-0"
            aria-label={`${label} color`}
          />
        </span>
      </span>
    </label>
  );
}

function ThemeEditorCard({
  mode,
  config,
  onPreset,
  onColor,
  onCopy,
  onImport,
}: {
  mode: AppearanceMode;
  config: AppearanceConfig;
  onPreset: (mode: AppearanceMode, preset: AppearancePresetId) => void;
  onColor: (
    mode: AppearanceMode,
    key: "accent" | "background" | "foreground",
    value: string,
  ) => void;
  onCopy: (mode: AppearanceMode) => void;
  onImport: (mode: AppearanceMode) => void;
}) {
  const Icon = mode === "light" ? Sun : Moon;
  const modeConfig = config[mode];
  const preset = APPEARANCE_PRESETS.find(
    (candidate) => candidate.id === modeConfig.preset,
  );

  return (
    <article className="min-w-0 rounded-[10px] border border-border bg-surface-1 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-[6px] border border-border bg-background text-muted-foreground">
            <Icon className="size-3.5" aria-hidden />
          </span>
          <div>
            <h3 className="text-ui-label font-medium capitalize">
              {mode} theme
            </h3>
            <p className="mt-0.5 text-[9.5px] text-muted-foreground">
              {preset?.description}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onImport(mode)}
            className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-[5px] px-1.5 text-[9.5px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none"
          >
            <FileUp className="size-3" aria-hidden /> Import
          </button>
          <button
            type="button"
            onClick={() => onCopy(mode)}
            className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-[5px] px-1.5 text-[9.5px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none"
          >
            <Copy className="size-3" aria-hidden /> Copy theme
          </button>
        </div>
      </div>

      <label className="mt-3 block">
        <span className="sr-only">{mode} preset</span>
        <select
          value={modeConfig.preset}
          onChange={(event) =>
            onPreset(mode, event.target.value as AppearancePresetId)
          }
          className="h-8 w-full cursor-pointer rounded-[6px] border border-border bg-background px-2.5 text-ui-caption text-foreground outline-none"
        >
          {APPEARANCE_PRESETS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3">
        <ThemePreview config={config} mode={mode} />
      </div>

      <div className="mt-2.5 divide-y divide-border">
        <ColorControl
          label="Accent"
          value={modeConfig.accent}
          onChange={(value) => onColor(mode, "accent", value)}
        />
        <ColorControl
          label="Background"
          value={modeConfig.background}
          onChange={(value) => onColor(mode, "background", value)}
        />
        <ColorControl
          label="Foreground"
          value={modeConfig.foreground}
          onChange={(value) => onColor(mode, "foreground", value)}
        />
      </div>
    </article>
  );
}

function SelectSetting({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { id: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-h-10 items-center justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <span className="text-ui-caption text-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 min-w-36 cursor-pointer rounded-[5px] border border-border bg-background px-2 text-ui-caption text-foreground outline-none"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function RangeSetting({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid min-h-10 grid-cols-[1fr_112px_34px] items-center gap-3 border-b border-border py-2 last:border-b-0">
      <span className="text-ui-caption text-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className={`${styles.slider} h-4 cursor-pointer accent-foreground`}
      />
      <output className="text-right font-mono text-ui-caption tabular-nums text-muted-foreground">
        {value}px
      </output>
    </label>
  );
}

export function AppearanceSettingsTab() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [config, setConfig] = useState<AppearanceConfig>(cloneDefaultConfig);
  const [announcement, setAnnouncement] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const importModeRef = useRef<AppearanceMode>("dark");

  useEffect(() => {
    if (!mounted) return;
    setConfig(loadAppearanceConfig());
  }, [mounted]);

  const selectedTheme: ColorTheme =
    theme === "light" || theme === "system" ? theme : "dark";
  const activeMode: AppearanceMode =
    resolvedTheme === "light" ? "light" : "dark";
  const activePreset = APPEARANCE_PRESETS.find(
    (candidate) => candidate.id === config[activeMode].preset,
  );

  const commit = (nextConfig: AppearanceConfig, message: string) => {
    setConfig(nextConfig);
    saveAppearanceConfig(nextConfig, resolvedTheme);
    setAnnouncement(message);
  };

  const selectTheme = (nextTheme: ColorTheme) => {
    // Only set the theme. AppearanceRuntime re-applies the stored config
    // whenever resolvedTheme changes, so re-saving an unchanged config here
    // was a second implementation of that, running one frame earlier.
    setTheme(nextTheme);
    const label = THEME_OPTIONS.find(
      (option) => option.id === nextTheme,
    )?.label;
    setAnnouncement(`${label ?? "Color"} mode saved on this device.`);
  };

  const updatePreset = (mode: AppearanceMode, preset: AppearancePresetId) => {
    const nextConfig = applyPreset(config, mode, preset);
    const name = APPEARANCE_PRESETS.find(
      (candidate) => candidate.id === preset,
    )?.name;
    commit(nextConfig, `${name ?? "Theme"} applied to ${mode} mode.`);
  };

  const updateModeColor = (
    mode: AppearanceMode,
    key: "accent" | "background" | "foreground",
    value: string,
  ) => {
    commit(
      { ...config, [mode]: { ...config[mode], [key]: value } },
      `${mode} ${key} updated.`,
    );
  };

  const updateConfig = <Key extends keyof AppearanceConfig>(
    key: Key,
    value: AppearanceConfig[Key],
    message: string,
  ) => commit({ ...config, [key]: value }, message);

  const copyTheme = async (mode: AppearanceMode) => {
    const payload = JSON.stringify(
      { version: 1, mode, theme: config[mode] },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(payload);
      setAnnouncement(`${mode} theme copied as JSON.`);
    } catch {
      setAnnouncement("Clipboard access is unavailable in this browser.");
    }
  };

  const openImport = (mode: AppearanceMode) => {
    importModeRef.current = mode;
    importInputRef.current?.click();
  };

  const importTheme = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const mode = importModeRef.current;
      const candidate = importedThemePalette(parsed);
      const nextConfig = normalizeAppearanceConfig({
        ...config,
        [mode]: { ...config[mode], ...candidate },
      });
      commit(nextConfig, `${mode} theme imported.`);
    } catch {
      setAnnouncement("That file is not a valid RIFT theme JSON document.");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  if (!mounted) {
    return (
      <div
        className="rounded-[8px] border border-border px-3 py-4 text-xs text-muted-foreground"
        role="status"
      >
        Loading appearance…
      </div>
    );
  }

  return (
    <div data-rift-appearance-settings className="space-y-8">
      <section aria-labelledby="appearance-color-mode">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="appearance-color-mode" className="text-ui font-medium">
              Base appearance
            </h2>
            <p className="mt-1 text-ui-caption leading-4 text-muted-foreground">
              Match your workspace to your surroundings.
            </p>
          </div>
        </div>

        <div
          className="mt-3 grid grid-cols-3 gap-1 rounded-[8px] border border-border bg-surface-2 p-1"
          role="group"
          aria-label="Base appearance"
        >
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            const selected = selectedTheme === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={selected}
                onClick={() => selectTheme(option.id)}
                className={`flex min-h-8 cursor-pointer items-center justify-center gap-1.5 rounded-[6px] px-2 text-ui-caption font-medium transition-colors focus-visible:outline-none motion-reduce:transition-none ${
                  selected
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
                }`}
              >
                <Icon className="size-3.5" aria-hidden />
                {option.label}
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="appearance-type-interface">
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <div>
            <h2 id="appearance-type-interface" className="text-ui font-medium">
              Type and interface
            </h2>
            <p className="mt-1 text-ui-caption leading-4 text-muted-foreground">
              Typography and contrast apply immediately across the workspace.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const defaults = cloneDefaultConfig();
              commit(defaults, "Appearance reset to the product defaults.");
            }}
            className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-[5px] px-2 text-ui-caption text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none"
          >
            <RotateCcw className="size-3" aria-hidden /> Reset
          </button>
        </div>

        <div className="rounded-[9px] border border-border bg-surface-1 px-3">
          <SelectSetting
            label="UI font"
            value={config.uiFont}
            options={UI_FONTS}
            onChange={(value) =>
              updateConfig(
                "uiFont",
                value as AppearanceConfig["uiFont"],
                "UI font updated.",
              )
            }
          />
          <SelectSetting
            label="Code font"
            value={config.codeFont}
            options={CODE_FONTS}
            onChange={(value) =>
              updateConfig(
                "codeFont",
                value as AppearanceConfig["codeFont"],
                "Code font updated.",
              )
            }
          />
          <RangeSetting
            label="UI font size"
            value={config.uiFontSize}
            min={12}
            max={18}
            onChange={(value) =>
              updateConfig("uiFontSize", value, "UI font size updated.")
            }
          />
          <RangeSetting
            label="Code font size"
            value={config.codeFontSize}
            min={11}
            max={18}
            onChange={(value) =>
              updateConfig("codeFontSize", value, "Code font size updated.")
            }
          />
          <label className="flex min-h-10 items-center justify-between gap-4 border-b border-border py-2">
            <span>
              <span className="block text-ui-caption text-foreground">
                High contrast
              </span>
              <span className="mt-0.5 block text-[9.5px] text-muted-foreground">
                Strengthen dividers and secondary text.
              </span>
            </span>
            <Switch
              checked={config.contrast === "high"}
              onCheckedChange={(checked) =>
                updateConfig(
                  "contrast",
                  checked ? "high" : "standard",
                  "Contrast preference updated.",
                )
              }
              aria-label="High contrast"
            />
          </label>
          <label className="flex min-h-10 items-center justify-between gap-4 border-b border-border py-2">
            <span>
              <span className="block text-ui-caption text-foreground">
                Translucent sidebar
              </span>
              <span className="mt-0.5 block text-[9.5px] text-muted-foreground">
                Blend the sidebar with supported desktop windows.
              </span>
            </span>
            <Switch
              checked={config.translucentSidebar}
              onCheckedChange={(checked) =>
                updateConfig(
                  "translucentSidebar",
                  checked,
                  "Sidebar material updated.",
                )
              }
              aria-label="Translucent sidebar"
            />
          </label>
          <label className="flex min-h-10 items-center justify-between gap-4 py-2">
            <span>
              <span className="block text-ui-caption text-foreground">
                Use pointer cursors
              </span>
              <span className="mt-0.5 block text-[9.5px] text-muted-foreground">
                Show a pointer over interactive controls.
              </span>
            </span>
            <Switch
              checked={config.pointerCursors}
              onCheckedChange={(checked) =>
                updateConfig(
                  "pointerCursors",
                  checked,
                  "Pointer cursor preference updated.",
                )
              }
              aria-label="Use pointer cursors"
            />
          </label>
        </div>
      </section>

      <details className="rift-theme-details rounded-xl border border-border p-4">
        <summary className="cursor-pointer text-ui font-medium">
          Customize theme colors{" "}
          <span className="ml-2 text-ui-label font-normal text-muted-foreground">
            Presets, import and export
          </span>
        </summary>
        <div className="pt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 id="appearance-theme-editors" className="text-ui font-medium">
                App themes
              </h2>
              <p className="mt-1 text-ui-caption leading-4 text-muted-foreground">
                Use a familiar product palette as-is, tune its colors, or import
                a shared theme.
              </p>
            </div>
            <span className="hidden items-center gap-1.5 text-[9.5px] text-muted-foreground sm:flex">
              <Check className="size-3" aria-hidden /> {activePreset?.name}{" "}
              active
            </span>
          </div>

          <div className="grid gap-2.5 xl:grid-cols-2">
            <ThemeEditorCard
              mode="light"
              config={config}
              onPreset={updatePreset}
              onColor={updateModeColor}
              onCopy={copyTheme}
              onImport={openImport}
            />
            <ThemeEditorCard
              mode="dark"
              config={config}
              onPreset={updatePreset}
              onColor={updateModeColor}
              onCopy={copyTheme}
              onImport={openImport}
            />
          </div>
        </div>
      </details>

      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void importTheme(event.target.files?.[0])}
      />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
