export type AppearanceMode = "light" | "dark";

export type AppearancePresetId =
  | "rift"
  | "oled"
  | "cursor"
  | "codex"
  | "claude"
  | "linear"
  | "github"
  | "vercel"
  | "dracula"
  | "catppuccin";

export type AppearanceColors = {
  accent: string;
  background: string;
  foreground: string;
  sidebar: string;
  surface: string;
  border: string;
};

export type AppearancePreset = {
  id: AppearancePresetId;
  name: string;
  description: string;
  light: AppearanceColors;
  dark: AppearanceColors;
};

export type AppearanceModeConfig = AppearanceColors & {
  preset: AppearancePresetId;
};

export type AppearanceConfig = {
  version: 5;
  light: AppearanceModeConfig;
  dark: AppearanceModeConfig;
  uiFont: "system" | "geist" | "space-grotesk";
  codeFont: "sf-mono" | "jetbrains" | "menlo";
  uiFontSize: number;
  codeFontSize: number;
  contrast: "standard" | "high";
  translucentSidebar: boolean;
  pointerCursors: boolean;
};

export const APPEARANCE_STORAGE_KEY = "rift:appearance:v1";
export const APPEARANCE_CHANGE_EVENT = "rift:appearance-change";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// Refresh shipped palettes without replacing any user-customized colors.
// Shared with the pre-hydration script so saved themes never flash old ink.
const TEXT_PALETTE_UPDATES = [
  {
    previous: {
      preset: "rift",
      accent: "#006cde",
      background: "#ffffff",
      foreground: "#363642",
      sidebar: "#ffffff",
      surface: "#f3f4f6",
      border: "#e8e9ef",
    },
    foreground: "#111111",
  },
  {
    previous: {
      preset: "rift",
      accent: "#0a84ff",
      background: "#18191b",
      foreground: "#f2f2f7",
      sidebar: "#202124",
      surface: "#292a2e",
      border: "#36373d",
    },
    foreground: "#f5f5f5",
  },
] as const;

function refreshPaletteText(
  colors: AppearanceModeConfig,
): AppearanceModeConfig {
  const update = TEXT_PALETTE_UPDATES.find(({ previous }) =>
    Object.entries(previous).every(
      ([key, value]) => colors[key as keyof AppearanceModeConfig] === value,
    ),
  );
  return update ? { ...colors, foreground: update.foreground } : colors;
}

// Installed Cursor Agents base tokens (2026-09-12). These are input colors,
// not screenshot composites: applying glass opacity to sampled pixels tinted
// the native surfaces twice. Native material equivalence remains unverified.
const CURSOR_AGENTS_DARK: AppearanceColors = {
  accent: "#969696",
  background: "#141414",
  foreground: "#f0f0f0",
  sidebar: "#181818",
  surface: "#212121",
  border: "#2f2d2e",
};

// Only complete historical stock palettes migrate. A change to any color is
// a user customization and keeps the whole palette. Serialize this same list
// into bootstrap to avoid a different palette before and after hydration.
const RETIRED_CURSOR_DARK: readonly AppearanceColors[] = [
  {
    accent: "#969696",
    background: "#191919",
    foreground: "#d8d8d8",
    sidebar: "#232323",
    surface: "#212121",
    border: "#303030",
  },
  {
    accent: "#969696",
    background: "#181818",
    foreground: "#f0f0f0",
    sidebar: "#181818",
    surface: "#1f1f1f",
    border: "#2b2b2b",
  },
  {
    accent: "#969696",
    background: "#141414",
    foreground: "#f0f0f0",
    sidebar: "#181818",
    surface: "#1f1f1f",
    border: "#2b2b2b",
  },
  {
    accent: "#969696",
    background: "#181818",
    foreground: "#f0f0f0",
    sidebar: "#141414",
    surface: "#1f1f1f",
    border: "#282828",
  },
  {
    accent: "#969696",
    background: "#151515",
    foreground: "#c3c2b8",
    sidebar: "#111111",
    surface: "#212121",
    border: "#292929",
  },
  {
    accent: "#969696",
    background: "#151515",
    foreground: "#f5f5f5",
    sidebar: "#111111",
    surface: "#212121",
    border: "#292929",
  },
  {
    accent: "#969696",
    background: "#191919",
    foreground: "#f5f5f5",
    sidebar: "#232122",
    surface: "#212121",
    border: "#2f2d2e",
  },
];

function relativeLuminance(color: string) {
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(color.slice(offset, offset + 2), 16),
  );
  return channels
    .map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    })
    .reduce(
      (luminance, channel, index) =>
        luminance + channel * [0.2126, 0.7152, 0.0722][index],
      0,
    );
}

export function getContrastRatio(first: string, second: string) {
  if (!HEX_COLOR.test(first) || !HEX_COLOR.test(second)) return 1;
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

export function getAccessibleTextColor(background: string) {
  return getContrastRatio(background, "#000000") >=
    getContrastRatio(background, "#ffffff")
    ? "#000000"
    : "#ffffff";
}

/**
 * Runs before React and next-themes hydrate so a saved workspace palette never
 * flashes the default theme. The script intentionally accepts only the same
 * strict six-digit colors and bounded preferences as normalizeAppearanceConfig.
 */
export const APPEARANCE_BOOTSTRAP_SCRIPT = String.raw`(()=>{try{
const raw=localStorage.getItem("rift:appearance:v1");if(!raw)return;
const config=JSON.parse(raw);
const savedTheme=localStorage.getItem("theme");
const prefersDark=typeof matchMedia==="function"&&matchMedia("(prefers-color-scheme: dark)").matches;
const mode=savedTheme==="light"?"light":savedTheme==="system"?(prefersDark?"dark":"light"):"dark";
const colorKeys=["accent","background","foreground","sidebar","surface","border"];
const validHex=(value)=>typeof value==="string"&&/^#[0-9a-f]{6}$/i.test(value);
const retiredCursorDark=${JSON.stringify(RETIRED_CURSOR_DARK)};
const nextCursorDark=${JSON.stringify({ preset: "cursor", ...CURSOR_AGENTS_DARK })};
const matchesCursor=(colors)=>config&&config.dark&&config.dark.preset==="cursor"&&colorKeys.every((key)=>config.dark[key]===colors[key]);
const isLegacyCursorDark=matchesCursor(retiredCursorDark[0]);
const shouldMigrateCursorDark=retiredCursorDark.some(matchesCursor);
const savedColors=config&&config[mode];
const retiredOledAccents={"#d98330":"#f5f5f5","#a8510e":"#111111"};
const withAccent=(value)=>value&&value.preset==="oled"&&typeof value.accent==="string"&&retiredOledAccents[value.accent.toLowerCase()]?{...value,accent:retiredOledAccents[value.accent.toLowerCase()]}:value;
const textPaletteUpdates=${JSON.stringify(TEXT_PALETTE_UPDATES)};
const withTextContrast=(colors)=>{const update=textPaletteUpdates.find(({previous})=>colors&&Object.entries(previous).every(([key,value])=>colors[key]===value));return update?{...colors,foreground:update.foreground}:colors;};
const colors=withTextContrast(withAccent(shouldMigrateCursorDark&&mode==="dark"?nextCursorDark:savedColors));
if(!colors||!colorKeys.every((key)=>validHex(colors[key])))return;
const bounded=(value,fallback,min,max)=>typeof value==="number"&&Number.isFinite(value)?Math.min(max,Math.max(min,Math.round(value))):fallback;
let uiSize=bounded(config.uiFontSize,13,12,18);if(isLegacyCursorDark&&uiSize===14)uiSize=13;
const codeSize=bounded(config.codeFontSize,14,11,18);
const root=document.documentElement;
const channel=(hex,offset)=>parseInt(hex.slice(offset,offset+2),16)/255;
const luminance=(hex)=>[1,3,5].map((offset)=>{const value=channel(hex,offset);return value<=0.04045?value/12.92:Math.pow((value+0.055)/1.055,2.4)}).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);
const ratio=(first,second)=>{const a=luminance(first);const b=luminance(second);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)};
const onAccent=ratio(colors.accent,"#000000")>=ratio(colors.accent,"#ffffff")?"#000000":"#ffffff";
root.dataset.riftAppearance="ready";
root.dataset.riftPreset=typeof colors.preset==="string"?colors.preset:"cursor";
root.dataset.riftUiFont=["system","geist","space-grotesk"].includes(config.uiFont)?config.uiFont:"system";
root.dataset.riftCodeFont=["sf-mono","jetbrains","menlo"].includes(config.codeFont)?config.codeFont:"sf-mono";
root.dataset.riftContrast=config.contrast==="high"?"high":"standard";
root.dataset.riftSidebar=(config.version>=5&&config.translucentSidebar===true)?"translucent":"solid";
root.dataset.riftPointer=config.pointerCursors===false?"disabled":"enabled";
const properties={"--rift-appearance-accent":colors.accent,"--rift-appearance-on-accent":onAccent,"--rift-appearance-background":colors.background,"--rift-appearance-foreground":colors.foreground,"--rift-appearance-sidebar":colors.sidebar,"--rift-appearance-surface":colors.surface,"--rift-appearance-border":colors.border,"--rift-ui-font-size":uiSize+"px","--rift-code-font-size":codeSize+"px","--rift-root-font-size":16*uiSize/13+"px"};
Object.entries(properties).forEach(([property,value])=>root.style.setProperty(property,value));
}catch{}})();`;

export const APPEARANCE_PRESETS: readonly AppearancePreset[] = [
  {
    id: "rift",
    name: "RIFT",
    description: "Soft neutral surfaces, crisp type and a blue accent.",
    light: {
      accent: "#006cde",
      background: "#ffffff",
      foreground: "#111111",
      sidebar: "#ffffff",
      surface: "#f3f4f6",
      border: "#e8e9ef",
    },
    dark: {
      accent: "#0a84ff",
      background: "#18191b",
      foreground: "#f5f5f5",
      sidebar: "#202124",
      surface: "#292a2e",
      border: "#36373d",
    },
  },
  {
    id: "oled",
    name: "OLED",
    // Built for panels that switch pixels off at #000: the shell disappears and
    // only the work is lit. The sidebar sits one step above true black so the
    // chrome still reads as a surface rather than a void.
    description: "True black, built for OLED panels.",
    light: {
      // Ink, the light-mode counterpart of the dark accent below. The accent
      // was an amber; it was the loudest thing on every screen it appeared on
      // and it was the only saturated colour in a product that is otherwise
      // monochrome. On white this holds 17.9:1 and its on-accent foreground
      // resolves to white automatically.
      accent: "#111111",
      background: "#ffffff",
      foreground: "#111111",
      sidebar: "#f6f6f6",
      surface: "#f0f0f0",
      border: "#e0e0e0",
    },
    dark: {
      // White. The accent was an amber, and it read as the one saturated thing
      // in an otherwise monochrome product: the toggle, the focus ring and the
      // primary button all shouted in a colour nothing else used. White on
      // true black holds 19.4:1 and its on-accent foreground resolves to black
      // automatically, which is the same pairing the references use for their
      // primary action. The eight impersonation presets below keep their own
      // accents: a Linear theme whose accent is not Linear's indigo has no
      // reason to exist.
      accent: "#f5f5f5",
      background: "#000000",
      // Not #ffffff: at full white on true black an OLED blooms and text edges
      // smear on scroll. #f5f5f5 still reads as white and holds ~19.4:1.
      foreground: "#f5f5f5",
      sidebar: "#0a0a0a",
      surface: "#101010",
      border: "#242424",
    },
  },
  {
    id: "cursor",
    name: "Graphite",
    description: "Measured graphite planes and neutral interaction states.",
    light: {
      // Existing light palette retained. The refreshed dark preset below is
      // based on the separate Cursor Agents window, not the IDE theme file.
      accent: "#141414",
      background: "#fcfcfc",
      foreground: "#141414",
      sidebar: "#f3f3f3",
      surface: "#f3f3f3",
      border: "#e3e3e3",
    },
    dark: CURSOR_AGENTS_DARK,
  },
  {
    id: "codex",
    name: "Codex",
    description: "Crisp neutral canvas with a precise blue accent.",
    light: {
      accent: "#0285ff",
      background: "#ffffff",
      foreground: "#0d0d0d",
      sidebar: "#f4f4f4",
      surface: "#ededed",
      border: "#dedede",
    },
    dark: {
      accent: "#339cff",
      background: "#181818",
      foreground: "#ffffff",
      sidebar: "#222222",
      surface: "#242424",
      border: "#343434",
    },
  },
  {
    id: "claude",
    name: "Claude",
    description: "Warm paper neutrals with a restrained clay accent.",
    light: {
      accent: "#b85f42",
      background: "#f7f4ee",
      foreground: "#2f2a24",
      sidebar: "#efeae2",
      surface: "#ebe5dc",
      border: "#d9d1c6",
    },
    dark: {
      accent: "#d97757",
      background: "#1f1e1b",
      foreground: "#eee9df",
      sidebar: "#292723",
      surface: "#302d28",
      border: "#403c35",
    },
  },
  {
    id: "linear",
    name: "Linear",
    description: "Dense violet controls on low-chroma product surfaces.",
    light: {
      accent: "#5e6ad2",
      background: "#f7f7f8",
      foreground: "#222326",
      sidebar: "#efeff1",
      surface: "#e9e9ec",
      border: "#d8d8dc",
    },
    dark: {
      accent: "#7c85f6",
      background: "#17171a",
      foreground: "#f1f1f2",
      sidebar: "#1f1f23",
      surface: "#25252a",
      border: "#34343b",
    },
  },
  {
    id: "github",
    name: "GitHub",
    description: "Familiar developer surfaces with clear semantic contrast.",
    light: {
      accent: "#0969da",
      background: "#ffffff",
      foreground: "#1f2328",
      sidebar: "#f6f8fa",
      surface: "#eff2f5",
      border: "#d0d7de",
    },
    dark: {
      accent: "#2f81f7",
      background: "#0d1117",
      foreground: "#e6edf3",
      sidebar: "#161b22",
      surface: "#21262d",
      border: "#30363d",
    },
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Pure editorial contrast with minimal chrome.",
    light: {
      accent: "#000000",
      background: "#ffffff",
      foreground: "#111111",
      sidebar: "#fafafa",
      surface: "#f2f2f2",
      border: "#e5e5e5",
    },
    dark: {
      accent: "#ffffff",
      background: "#000000",
      foreground: "#ededed",
      sidebar: "#0a0a0a",
      surface: "#1a1a1a",
      border: "#333333",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    description: "A classic high-contrast editor palette.",
    light: {
      accent: "#8839ef",
      background: "#f8f8f2",
      foreground: "#282a36",
      sidebar: "#eeeef0",
      surface: "#e8e8ea",
      border: "#d4d4d8",
    },
    dark: {
      accent: "#ff79c6",
      background: "#282a36",
      foreground: "#f8f8f2",
      sidebar: "#21222c",
      surface: "#343746",
      border: "#44475a",
    },
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    description: "Soft lavender accents and calm editor contrast.",
    light: {
      accent: "#8839ef",
      background: "#eff1f5",
      foreground: "#4c4f69",
      sidebar: "#e6e9ef",
      surface: "#dce0e8",
      border: "#ccd0da",
    },
    dark: {
      accent: "#cba6f7",
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      sidebar: "#181825",
      surface: "#313244",
      border: "#45475a",
    },
  },
] as const;

function presetMode(
  presetId: AppearancePresetId,
  mode: AppearanceMode,
): AppearanceModeConfig {
  const preset =
    APPEARANCE_PRESETS.find((candidate) => candidate.id === presetId) ??
    APPEARANCE_PRESETS[0];
  return { preset: preset.id, ...preset[mode] };
}

export const DEFAULT_APPEARANCE_CONFIG: AppearanceConfig = {
  version: 5,
  // New installs use the same Rift material family in both modes.
  // Saved custom palettes are preserved by normalizeAppearanceConfig.
  light: presetMode("rift", "light"),
  dark: presetMode("rift", "dark"),
  // A consistent text face across the desktop and web workspace.
  uiFont: "system",
  codeFont: "sf-mono",
  uiFontSize: 13,
  codeFontSize: 14,
  contrast: "standard",
  // Reveal the native material on new installations. The shell applies
  // separate sidebar/content alpha values; existing saved preferences remain
  // unchanged, including an explicit solid surface or high-contrast mode.
  translucentSidebar: true,
  pointerCursors: true,
};

function copyDefaultAppearanceConfig(): AppearanceConfig {
  return {
    ...DEFAULT_APPEARANCE_CONFIG,
    light: { ...DEFAULT_APPEARANCE_CONFIG.light },
    dark: { ...DEFAULT_APPEARANCE_CONFIG.dark },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * The amber the OLED preset used to carry, in both modes.
 *
 * It was the only saturated colour in a monochrome product, so it was also the
 * loudest thing on every screen that had a toggle, a focus ring or a primary
 * button. Someone still holding the old value gets the new one; someone who
 * picked their own accent keeps it, because the match has to be exact.
 */
const RETIRED_OLED_ACCENTS: Readonly<Record<string, string>> = {
  "#d98330": "#f5f5f5",
  "#a8510e": "#111111",
};

function readMode(
  value: unknown,
  fallback: AppearanceModeConfig,
): AppearanceModeConfig {
  if (!isRecord(value)) return fallback;
  const preset = APPEARANCE_PRESETS.some(
    (candidate) => candidate.id === value.preset,
  )
    ? (value.preset as AppearancePresetId)
    : fallback.preset;
  const readColor = (key: keyof AppearanceColors) =>
    typeof value[key] === "string" && HEX_COLOR.test(value[key])
      ? value[key]
      : fallback[key];
  const readAccent = () => {
    const stored = readColor("accent");
    if (preset !== "oled") return stored;
    return RETIRED_OLED_ACCENTS[stored.toLowerCase()] ?? stored;
  };
  return refreshPaletteText({
    preset,
    accent: readAccent(),
    background: readColor("background"),
    foreground: readColor("foreground"),
    sidebar: readColor("sidebar"),
    surface: readColor("surface"),
    border: readColor("border"),
  });
}

function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function matchesCursorDefaults(
  value: unknown,
  colors: AppearanceColors,
): boolean {
  if (!isRecord(value) || value.preset !== "cursor") return false;
  return (Object.keys(colors) as (keyof AppearanceColors)[]).every(
    (key) => value[key] === colors[key],
  );
}

export function normalizeAppearanceConfig(value: unknown): AppearanceConfig {
  if (!isRecord(value)) return copyDefaultAppearanceConfig();
  const storedVersion = typeof value.version === "number" ? value.version : 0;
  const legacyCursorDefaults = matchesCursorDefaults(
    value.dark,
    RETIRED_CURSOR_DARK[0],
  );
  const shouldMigrateCursorDefaults = RETIRED_CURSOR_DARK.some((colors) =>
    matchesCursorDefaults(value.dark, colors),
  );
  const storedUiFont =
    value.uiFont === "geist" ||
    value.uiFont === "space-grotesk" ||
    value.uiFont === "system"
      ? value.uiFont
      : DEFAULT_APPEARANCE_CONFIG.uiFont;
  return {
    version: 5,
    light: readMode(value.light, DEFAULT_APPEARANCE_CONFIG.light),
    dark: shouldMigrateCursorDefaults
      ? // Refresh a stale Cursor palette to the current Cursor one. This must
        // name the preset rather than follow the default: someone who chose
        // Cursor keeps Cursor, whatever a new install now starts on.
        presetMode("cursor", "dark")
      : readMode(value.dark, DEFAULT_APPEARANCE_CONFIG.dark),
    uiFont: storedUiFont,
    codeFont:
      value.codeFont === "jetbrains" || value.codeFont === "menlo"
        ? value.codeFont
        : "sf-mono",
    uiFontSize:
      legacyCursorDefaults && value.uiFontSize === 14
        ? 13
        : boundedNumber(value.uiFontSize, 13, 12, 18),
    codeFontSize: boundedNumber(value.codeFontSize, 14, 11, 18),
    contrast: value.contrast === "high" ? "high" : "standard",
    // Version-gated rather than `!== false`, and re-gated at v4.
    //
    // v3 forced this to false for everyone, so a stored v3 `false` is this
    // shell's choice, not the user's -- honouring it would pin every existing
    // install to a flat panel sitting on top of the window vibrancy macOS is
    // already compositing. v4 configs are real preferences and are honoured as
    // written; anything older adopts the glass default.
    // Only a choice made after the default flipped counts as a choice.
    // Before v5 every stored config carried translucentSidebar: true because
    // that WAS the default, so honouring it would pin the old look on
    // everyone; a post-v5 true is someone turning the glass back on.
    translucentSidebar:
      storedVersion >= 5 ? value.translucentSidebar === true : false,
    pointerCursors: value.pointerCursors !== false,
  };
}

export function loadAppearanceConfig(): AppearanceConfig {
  if (typeof window === "undefined") {
    return copyDefaultAppearanceConfig();
  }
  try {
    const stored = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return stored
      ? normalizeAppearanceConfig(JSON.parse(stored) as unknown)
      : copyDefaultAppearanceConfig();
  } catch {
    return copyDefaultAppearanceConfig();
  }
}

/**
 * Every custom property the appearance system writes, and the list the
 * bootstrap script has to agree with.
 *
 * APPEARANCE_BOOTSTRAP_SCRIPT is a hand-written re-implementation of this
 * function that runs before any bundle loads, so it cannot import it. It can
 * only drift. Naming the properties here lets a test assert the script still
 * writes all of them, and the behavioural harness beside it asserts the two
 * paths leave the document in the same state.
 */
export const APPEARANCE_CSS_VARS = [
  "--rift-appearance-accent",
  "--rift-appearance-on-accent",
  "--rift-appearance-background",
  "--rift-appearance-foreground",
  "--rift-appearance-sidebar",
  "--rift-appearance-surface",
  "--rift-appearance-border",
  "--rift-ui-font-size",
  "--rift-code-font-size",
  "--rift-root-font-size",
] as const;

/** The dataset flags it writes alongside them. */
export const APPEARANCE_DATASET_KEYS = [
  "riftAppearance",
  "riftPreset",
  "riftUiFont",
  "riftCodeFont",
  "riftContrast",
  "riftSidebar",
  "riftPointer",
] as const;

export function applyAppearanceConfig(
  config: AppearanceConfig,
  resolvedMode: string | undefined,
) {
  if (typeof document === "undefined") return;
  const mode: AppearanceMode = resolvedMode === "light" ? "light" : "dark";
  const colors = config[mode];
  const root = document.documentElement;

  root.dataset.riftAppearance = "ready";
  root.dataset.riftPreset = colors.preset;
  root.dataset.riftUiFont = config.uiFont;
  root.dataset.riftCodeFont = config.codeFont;
  root.dataset.riftContrast = config.contrast;
  root.dataset.riftSidebar = config.translucentSidebar
    ? "translucent"
    : "solid";
  root.dataset.riftPointer = config.pointerCursors ? "enabled" : "disabled";

  const properties: Record<string, string> = {
    "--rift-appearance-accent": colors.accent,
    "--rift-appearance-on-accent": getAccessibleTextColor(colors.accent),
    "--rift-appearance-background": colors.background,
    "--rift-appearance-foreground": colors.foreground,
    "--rift-appearance-sidebar": colors.sidebar,
    "--rift-appearance-surface": colors.surface,
    "--rift-appearance-border": colors.border,
    "--rift-ui-font-size": `${config.uiFontSize}px`,
    "--rift-code-font-size": `${config.codeFontSize}px`,
    "--rift-root-font-size": `${(16 * config.uiFontSize) / 13}px`,
  };
  for (const property of APPEARANCE_CSS_VARS) {
    root.style.setProperty(property, properties[property]);
  }
}

export function saveAppearanceConfig(
  config: AppearanceConfig,
  resolvedMode?: string,
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(config));
  applyAppearanceConfig(config, resolvedMode);
  window.dispatchEvent(
    new CustomEvent<AppearanceConfig>(APPEARANCE_CHANGE_EVENT, {
      detail: config,
    }),
  );
}

export function applyPreset(
  config: AppearanceConfig,
  mode: AppearanceMode,
  presetId: AppearancePresetId,
): AppearanceConfig {
  return { ...config, [mode]: presetMode(presetId, mode) };
}
