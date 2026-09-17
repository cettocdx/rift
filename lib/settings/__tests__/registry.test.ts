import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_HOST_BASE_PATHS,
  SETTINGS_EXTERNAL_ALIASES,
  SETTINGS_SECTION_ALIASES,
  SETTINGS_SECTIONS,
  getSettingsAliasRedirects,
  getSettingsSection,
  isSettingsSectionId,
  resolveExternalSettingsAlias,
  resolveSettingsSection,
  searchSettingsSections,
  settingsHref,
} from "../registry";

describe("settings registry", () => {
  it("keeps section ids unique and addressable", () => {
    const ids = SETTINGS_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => {
      expect(isSettingsSectionId(id)).toBe(true);
      expect(getSettingsSection(id).id).toBe(id);
    });
    expect(isSettingsSectionId("nope")).toBe(false);
    expect(ids).toContain(DEFAULT_SETTINGS_SECTION);
  });

  it("gives every section a label, a description and search terms", () => {
    // A section with nothing in it is the defect this asserts away: the old
    // dialog shipped an "extensions" tab whose whole body was a link out.
    SETTINGS_SECTIONS.forEach((section) => {
      expect(section.label.length).toBeGreaterThan(0);
      expect(section.description.length).toBeGreaterThan(0);
      expect(section.keywords.length).toBeGreaterThan(0);
    });
  });

  it("resolves ids, labels and every legacy tab name", () => {
    expect(resolveSettingsSection("appearance")).toBe("appearance");
    expect(resolveSettingsSection("Usage & billing")).toBe("billing");
    expect(resolveSettingsSection("  Personalization ")).toBe("general");
    expect(resolveSettingsSection(null)).toBeNull();
    expect(resolveSettingsSection("")).toBeNull();
    expect(resolveSettingsSection("nonsense")).toBeNull();

    Object.entries(SETTINGS_SECTION_ALIASES).forEach(([alias, target]) => {
      expect(resolveSettingsSection(alias)).toBe(target);
      expect(isSettingsSectionId(target)).toBe(true);
    });
  });

  it("sends usage and extra usage to billing, not to the account page", () => {
    // Both were live deep-link bugs: /usage resolved to "Account".
    expect(resolveSettingsSection("usage")).toBe("billing");
    expect(resolveSettingsSection("Extra Usage")).toBe("billing");
  });

  it("routes surfaces that own themselves out of settings", () => {
    Object.entries(SETTINGS_EXTERNAL_ALIASES).forEach(([alias, href]) => {
      expect(resolveExternalSettingsAlias(alias)).toBe(href);
      expect(href.startsWith("/")).toBe(true);
      // An external alias must not also resolve to a section, or the two
      // lookups would disagree about where the caller lands.
      expect(resolveSettingsSection(alias)).toBeNull();
    });
    expect(resolveExternalSettingsAlias("appearance")).toBeNull();
  });

  it("composes hrefs for every shell that hosts settings", () => {
    expect(settingsHref("/")).toBe("/settings");
    expect(settingsHref("/", "billing")).toBe("/settings/billing");
    expect(settingsHref("/lab/app", "appearance")).toBe(
      "/lab/app/settings/appearance",
    );
    expect(settingsHref("/workspace/", "keyboard")).toBe(
      "/workspace/settings/keyboard",
    );
    expect(settingsHref("/workspace", null)).toBe("/workspace/settings");

    SETTINGS_HOST_BASE_PATHS.forEach((basePath) => {
      expect(settingsHref(basePath, "general")).toMatch(
        /^\/(?:workspace\/|lab\/app\/)?settings\/general$/,
      );
    });
  });

  it("falls back to the root copy for a shell that hosts no settings", () => {
    // The marketing capture lab renders the product chrome at /lab/capture but
    // mounts no settings routes; composing one there would be a 404 link.
    expect(settingsHref("/lab/capture", "billing")).toBe("/settings/billing");
    expect(settingsHref("", "billing")).toBe("/settings/billing");
  });

  it("emits alias redirects for every host", () => {
    const redirects = getSettingsAliasRedirects();

    SETTINGS_HOST_BASE_PATHS.forEach((basePath) => {
      const root = basePath === "/" ? "" : basePath;
      expect(redirects).toContainEqual({
        source: `${root}/settings/usage`,
        destination: settingsHref(basePath, "billing"),
        permanent: false,
      });
    });
    // Slug-shaped only: dialog tab names arrive through a caller, never a URL.
    expect(redirects.every((entry) => !entry.source.includes(" "))).toBe(true);
  });

  it("ranks search results by how directly they answer the query", () => {
    expect(searchSettingsSections("")).toEqual(SETTINGS_SECTIONS);
    expect(searchSettingsSections("appearance")[0].id).toBe("appearance");
    expect(searchSettingsSections("shortcuts")[0].id).toBe("keyboard");
    expect(searchSettingsSections("auto-reload")[0].id).toBe("billing");
    expect(searchSettingsSections("zzzz")).toHaveLength(0);
  });
});
