import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  SETTINGS_HOST_BASE_PATHS,
  SETTINGS_SECTIONS,
  isSettingsSectionId,
} from "../registry";

/**
 * The registry and the routes have to agree in both directions.
 *
 * A section listed in the nav with no page is a link to a 404. A page with no
 * registry entry is a surface nobody can reach except by typing its address —
 * which is how the settings dialog ended up with a tab whose whole body was a
 * link somewhere else.
 */

const ROOT = process.cwd();
const CHAT_SETTINGS = join(ROOT, "app/(chat)/settings");
const RESERVED = new Set([
  "layout.tsx",
  "page.tsx",
  "loading.tsx",
  "not-found.tsx",
  "error.tsx",
  "[section]",
]);

function sectionDirectories(dir: string) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !RESERVED.has(entry.name))
    .map((entry) => entry.name);
}

describe("settings section coverage", () => {
  it("gives every registry section a page in the chat shell", () => {
    SETTINGS_SECTIONS.forEach((section) => {
      const page = join(CHAT_SETTINGS, section.id, "page.tsx");
      expect(existsSync(page)).toBe(true);
      // The page must actually render that section's component, not a
      // placeholder that happens to satisfy the file check.
      const source = readFileSync(page, "utf8");
      expect(source).toMatch(/<[A-Z][A-Za-z]*Section \/>/);
    });
  });

  it("leaves no page without a registry entry", () => {
    sectionDirectories(CHAT_SETTINGS).forEach((slug) => {
      expect(isSettingsSectionId(slug)).toBe(true);
    });
  });

  it("mounts the same sections in every shell that hosts settings", () => {
    // Opening settings from the IDE must not drop half the sections.
    const hosts = SETTINGS_HOST_BASE_PATHS.filter(
      (basePath) => basePath !== "/",
    ).map((basePath) => join(ROOT, "app", basePath.slice(1), "settings"));

    hosts.forEach((dir) => {
      expect(existsSync(dir)).toBe(true);
      expect(sectionDirectories(dir).sort()).toEqual(
        SETTINGS_SECTIONS.map((section) => section.id).sort(),
      );
      ["layout.tsx", "page.tsx", "loading.tsx", "not-found.tsx"].forEach(
        (file) => expect(existsSync(join(dir, file))).toBe(true),
      );
      expect(existsSync(join(dir, "[section]", "page.tsx"))).toBe(true);
    });
  });

  it("binds each shell's alias page to its own base path", () => {
    // A shared alias page would resolve /workspace/settings/usage back to the
    // chat shell and throw away the file tree the reader was working in.
    SETTINGS_HOST_BASE_PATHS.forEach((basePath) => {
      const dir =
        basePath === "/"
          ? CHAT_SETTINGS
          : join(ROOT, "app", basePath.slice(1), "settings");
      const source = readFileSync(join(dir, "[section]", "page.tsx"), "utf8");
      expect(source).toContain(`createSettingsAliasPage("${basePath}")`);
    });
  });
});
