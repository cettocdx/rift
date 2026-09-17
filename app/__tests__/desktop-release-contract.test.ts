import { readFileSync, readdirSync, type Dirent } from "node:fs";
import { extname, join, relative } from "node:path";

const DESKTOP_ROOT = join(process.cwd(), "packages/desktop");

function source(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

function json<T>(relativePath: string): T {
  return JSON.parse(source(relativePath)) as T;
}

function releaseSources(directory = DESKTOP_ROOT): string[] {
  const ignoredDirectories = new Set([
    "gen",
    "icons",
    "node_modules",
    "target",
  ]);
  const readableExtensions = new Set([
    ".html",
    ".js",
    ".json",
    ".md",
    ".rs",
    ".sh",
    ".toml",
  ]);

  return readdirSync(directory, { withFileTypes: true }).flatMap(
    (entry: Dirent) => {
      if (ignoredDirectories.has(entry.name)) return [];
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) return releaseSources(absolutePath);
      if (!readableExtensions.has(extname(entry.name))) return [];
      return [relative(process.cwd(), absolutePath)];
    },
  );
}

type DesktopPackage = {
  version: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
};

type TauriConfig = {
  version: string;
  identifier: string;
  app: {
    macOSPrivateApi?: boolean;
    windows: Array<{
      decorations?: boolean;
      hiddenTitle?: boolean;
      titleBarStyle?: string;
      trafficLightPosition?: { x: number; y: number };
      transparent?: boolean;
      userAgent?: string;
    }>;
    security: { csp?: string; capabilities?: string[] };
  };
  bundle: Record<string, unknown>;
  plugins: Record<string, unknown>;
};

type Capability = {
  windows?: string[];
  webviews?: string[];
  remote?: { urls: string[] };
  permissions: Array<string | { identifier: string }>;
};

describe("canonical native desktop release contract", () => {
  const desktopPackage = json<DesktopPackage>("packages/desktop/package.json");
  const tauriConfig = json<TauriConfig>(
    "packages/desktop/src-tauri/tauri.conf.json",
  );
  const devConfig = source("packages/desktop/src-tauri/tauri.dev.conf.json");
  const capability = json<Capability>(
    "packages/desktop/src-tauri/capabilities/default.json",
  );
  const devCapability = json<Capability>(
    "packages/desktop/src-tauri/capabilities/dev.json",
  );
  const cargoToml = source("packages/desktop/src-tauri/Cargo.toml");
  const cargoLock = source("packages/desktop/src-tauri/Cargo.lock");
  const rust = source("packages/desktop/src-tauri/src/lib.rs");
  const commandPermission = source(
    "packages/desktop/src-tauri/permissions/desktop-command-bridge.toml",
  );
  const corePermission = source(
    "packages/desktop/src-tauri/permissions/desktop-core-bridge.toml",
  );
  const localAccessPermission = source(
    "packages/desktop/src-tauri/permissions/desktop-local-access.toml",
  );
  const profileTerminalPermission = source(
    "packages/desktop/src-tauri/permissions/desktop-profile-terminal.toml",
  );
  const {
    resolveAppUrl,
    renderLaunchHtml,
    readGeneratedAppUrl,
  } = require("../../packages/desktop/scripts/build.js");
  const desktopLoader = renderLaunchHtml({
    appUrl: resolveAppUrl({}),
    template: source("packages/desktop/scripts/launch.template.html"),
    css: source("components/launch/launch-screen.css"),
    logo: source("public/brand/Rift-Symbol-Black.svg"),
  });
  const legacyRust = source("src-tauri/src/lib.rs");
  const legacyCapability = json<Capability>(
    "src-tauri/capabilities/default.json",
  );

  it("locks the package, Rust crate, bundle and full native user agent to 0.1.0", () => {
    expect(desktopPackage.version).toBe("0.1.0");
    expect(cargoToml).toMatch(/name = "rift-desktop"\nversion = "0\.1\.0"/);
    expect(cargoLock).toMatch(/name = "rift-desktop"\nversion = "0\.1\.0"/);
    expect(tauriConfig.version).toBe("0.1.0");
    expect(tauriConfig.identifier).toBe("app.riftsys.desktop");
    expect(tauriConfig.app.windows[0]).toMatchObject({
      transparent: true,
      userAgent: expect.stringContaining("RIFT-Desktop/0.1.0"),
    });
    expect(tauriConfig.app.windows[0]?.userAgent).not.toContain(
      "RIFTWrapperLite",
    );
  });

  it("always produces a structurally signed macOS bundle", () => {
    const macOS = tauriConfig.bundle.macOS as {
      hardenedRuntime?: boolean;
      signingIdentity?: string | null;
    };
    const workflow = source(".github/workflows/desktop-build.yml");

    expect(macOS.signingIdentity).toBe("-");
    expect(macOS.hardenedRuntime).toBe(true);
    expect(workflow).toContain(
      "APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY || '-' }}",
    );
    expect(workflow).toContain(
      'codesign --verify --deep --strict --verbose=2 "$app_path"',
    );
  });

  it("integrates the native macOS titlebar without removing safe window controls", () => {
    const mainWindow = tauriConfig.app.windows[0];

    expect(mainWindow).toMatchObject({
      decorations: true,
      titleBarStyle: "Overlay",
      hiddenTitle: true,
    });
    // Insets must not be combined with an extra Unified toolbar: Wry and
    // AppKit would both resize the same native titlebar container.
    if (mainWindow.trafficLightPosition) {
      const chrome = source("packages/desktop/src-tauri/src/window_chrome.rs");
      expect(chrome).not.toContain("native.setToolbar(");
      expect(mainWindow.trafficLightPosition.x).toBeGreaterThan(0);
      expect(mainWindow.trafficLightPosition.y).toBeGreaterThan(0);
    }
    expect(mainWindow?.decorations).not.toBe(false);
    expect(capability.permissions).toContain(
      "core:window:allow-start-dragging",
    );
    expect(devCapability.permissions).toContain(
      "core:window:allow-start-dragging",
    );

    const titlebarSurfaces = [
      source("app/components/SidebarHeader.tsx"),
      source("app/components/ZauthPageShell.tsx"),
      source("app/components/ChatTitlebar.tsx"),
      source("app/components/pro/ProChatLayout.tsx"),
      source("app/components/workbench/Workbench.tsx"),
    ].join("\n");
    const appCss = source("app/globals.css");

    expect(titlebarSurfaces).toContain("data-tauri-drag-region");
    expect(titlebarSurfaces).toContain("data-rift-native-titlebar");
    expect(titlebarSurfaces).toContain('data-rift-native-titlebar="window"');
    expect(appCss).toContain("[data-rift-native-titlebar]");
    expect(appCss).toContain(".rift-native-window-drag-strip");
    expect(appCss).toContain("padding-left: 78px");
    // The strip is permanent and takes part in layout, open or closed. Cursor
    // keeps one title bar across the window with the toggle parked after the
    // traffic lights, so the control that closes the sidebar is the same pixel
    // that reopens it; the old rules only painted the strip while the sidebar
    // was shut and floated the toggle over the canvas on `position: fixed`.
    // The strip is permanent and takes part in layout on both surfaces: one bar
    // across the top of the window with the sidebar control at its leading edge
    // and a pair of controls at its far end, open or closed. That is what makes
    // the button that closes the sidebar the one that reopens it, and reserving
    // the height is what holds the top inset rather than letting the strip
    // float over the first row of content.
    expect(appCss).toMatch(
      /\[data-pro-workbench\] \.rift-native-window-drag-strip[\s\S]*?position:\s*relative/,
    );
    expect(appCss).toMatch(
      /\[data-pro-workbench\] \.rift-native-window-drag-strip[\s\S]*?flex:\s*0 0 auto/,
    );
    expect(appCss).not.toContain(
      '[data-pro-workbench][data-chat-sidebar-open="false"]',
    );
    expect(appCss).not.toMatch(
      /\.rift-collapsed-sidebar-toggle\s*\{[\s\S]*?position:\s*fixed/,
    );
    expect(appCss).toContain('[data-rift-native-titlebar="auth-window"]');
    expect(appCss).toContain("height: 28px");
    expect(appCss).toContain("pointer-events: auto");
    expect(appCss).toContain("html.rift-vibrancy [data-rift-main-panel]");
    expect(appCss).not.toMatch(
      /\[data-rift-main-panel\]\s*\{\s*padding-top:\s*36px/,
    );
    expect(appCss).toContain("-webkit-app-region: drag");
    expect(appCss).toContain("-webkit-app-region: no-drag");
    expect(appCss).toMatch(
      /html\.rift-vibrancy \.rift-titlebar\s*\{[\s\S]*?-webkit-app-region:\s*drag/,
    );
    expect(appCss).toMatch(
      /html\.rift-vibrancy \.rift-titlebar button,[\s\S]*?-webkit-app-region:\s*no-drag/,
    );
  });

  it("isolates the canonical production host from local development privileges", () => {
    expect(desktopPackage.scripts["build:prod"]).toContain(
      "APP_URL=https://riftsys.app/login",
    );
    expect(resolveAppUrl({})).toBe("https://riftsys.app/login");
    expect(readGeneratedAppUrl(desktopLoader)).toBe(
      "https://riftsys.app/login",
    );
    expect(capability.remote?.urls).toEqual(["https://riftsys.app/*"]);
    expect(devCapability.remote?.urls).toEqual([
      "http://localhost:3010",
      "https://riftsys.app/*",
    ]);
    expect(tauriConfig.app.security.capabilities).toEqual(["default"]);
    expect(tauriConfig.app.security.csp).toContain("https://riftsys.app");
    expect(tauriConfig.app.security.csp).not.toContain("localhost");
    expect(tauriConfig.app.security.csp).not.toContain("127.0.0.1");
    expect(devConfig).toContain("http://localhost:3010");
    expect(devConfig).toContain("https://riftsys.app");
    expect(devConfig).toContain('"capabilities": ["dev"]');
    expect(rust).toContain(
      'parsed.origin().ascii_serialization() == "https://riftsys.app"',
    );
    expect(rust).toContain("cfg!(debug_assertions)");
    expect(rust).toContain("#[cfg(debug_assertions)]");
    expect(rust).toContain('"https://riftsys.app".to_string()');

    const legacyHostPattern = /rift\.co(?:\/|\b)|rift\.security/i;
    for (const relativePath of releaseSources()) {
      expect({
        relativePath,
        hasLegacyHost: legacyHostPattern.test(source(relativePath)),
      }).toEqual({ relativePath, hasLegacyHost: false });
    }
  });

  it("renders the canonical offline RIFT loader for production sign-in", () => {
    const brandMark = desktopLoader.match(
      /<svg\s+class="rift-launch__mark"[\s\S]*?<\/svg>/,
    )?.[0];

    expect(readGeneratedAppUrl(desktopLoader)).toBe(
      "https://riftsys.app/login",
    );
    expect(desktopLoader).toContain("Recursive Intelligence for Technology");
    const paths = [
      ...source("public/brand/Rift-Symbol-Black.svg").matchAll(
        /<path\s+d="([^"]+)"/g,
      ),
    ];
    expect(paths.length).toBeGreaterThan(0);
    for (const [, path] of paths) expect(brandMark).toContain(`d="${path}"`);
    expect(brandMark).toContain('viewBox="0 0 124 124"');
    expect(brandMark).toContain('transform="rotate(180 50 50)"');
    expect(brandMark).toContain('fill="currentColor"');
    expect(brandMark).not.toContain("<rect");
    expect(brandMark).not.toContain("<circle");
    expect(brandMark?.toLowerCase()).not.toContain("orbit");
    expect(brandMark).not.toContain("#3159e8");
    expect(desktopLoader).toMatch(
      /\.rift-launch__mark \{[\s\S]*?width: clamp\(100px, 18vw, 160px\);/,
    );
  });

  it("cannot package the legacy shell as the production app", () => {
    const legacy = json<TauriConfig>("src-tauri/tauri.conf.json");
    expect(legacy.identifier).not.toBe(tauriConfig.identifier);
    expect(legacy.bundle.active).toBe(false);
    const rootPackage = json<{ scripts: Record<string, string> }>(
      "package.json",
    );
    expect(rootPackage.scripts["tauri:build"]).toBe("pnpm desktop:build");
  });

  it("keeps the legacy wrapper login-only with the same native titlebar contract", () => {
    expect(legacyRust).toContain('"https://riftsys.app/login".to_string()');
    expect(legacyRust).toMatch(
      /#\[cfg\(debug_assertions\)\][\s\S]*RIFT_DESKTOP_URL/,
    );
    expect(legacyRust).toContain("tauri::TitleBarStyle::Overlay");
    expect(legacyRust).toContain(".hidden_title(true)");
    expect(legacyRust).toContain(
      ".traffic_light_position(tauri::LogicalPosition::new(15.75, 24.75))",
    );
    expect(legacyCapability.remote?.urls).toContain("https://riftsys.app/*");
    expect(legacyCapability.permissions).toContain(
      "core:window:allow-start-dragging",
    );
  });

  it("has no updater endpoint, plugin, permission, dependency or launch task", () => {
    expect(desktopPackage.dependencies).not.toHaveProperty(
      "@tauri-apps/plugin-updater",
    );
    expect(cargoToml).not.toContain("tauri-plugin-updater");
    expect(cargoLock).not.toContain('name = "tauri-plugin-updater"');
    expect(tauriConfig.bundle).not.toHaveProperty("createUpdaterArtifacts");
    expect(tauriConfig.plugins).not.toHaveProperty("updater");
    expect(capability.permissions).not.toContain("updater:default");
    expect(rust).not.toMatch(
      /tauri_plugin_updater|check_for_updates|UPDATE_CHECK_INTERVAL|last_update_check/,
    );
    expect(source("pnpm-lock.yaml")).not.toContain(
      "@tauri-apps/plugin-updater",
    );
  });

  it("applies native macOS sidebar vibrancy to the existing transparent main window", () => {
    expect(tauriConfig.app.macOSPrivateApi).toBe(true);
    expect(cargoToml).toMatch(
      /tauri = \{ version = "2", features = \[[^\]]*"macos-private-api"/,
    );
    expect(cargoToml).toMatch(
      /\[target\.'cfg\(target_os = "macos"\)'\.dependencies\][\s\S]*window-vibrancy = "0\.5"/,
    );
    expect(rust).toContain('#[cfg(target_os = "macos")]');
    expect(rust).toContain('app.get_webview_window("main")');
    expect(rust).toContain("apply_vibrancy(");
    expect(rust).toContain("NSVisualEffectMaterial::Sidebar");
    // Stable material when the user moves between desktop apps.
    expect(rust).toContain("NSVisualEffectState::Active");
    expect(source("app/layout.tsx")).toContain("RIFT-Desktop");
    expect(source("app/layout.tsx")).toContain(
      "document.documentElement.classList.add('rift-vibrancy')",
    );
  });

  it("keeps production local access scoped while retaining command/PTy support only for development", () => {
    const coreCommands = [
      "get_dev_auth_port",
      "prepare_desktop_auth_state",
      "github_desktop_callback_scheme",
      "get_local_file_metadata",
      "read_local_file",
      "get_desktop_platform_info",
      "save_file_to_downloads",
    ];
    const localAccessCommands = [
      "request_workspace_access",
      "list_workspace_grants",
      "revoke_workspace_access",
      "list_workspace_entries",
      "read_workspace_file",
      "write_workspace_file",
      "fetch_loopback_url",
      "desktop_access_status",
      "set_desktop_access",
      "desktop_computer_action",
      "open_visible_url_with_consent",
    ];
    const developmentOnlyCommands = [
      "get_cmd_server_info",
      "execute_command",
      "execute_stream_command",
      "cancel_stream_command",
      "execute_pty_create",
      "execute_pty_input",
      "execute_pty_resize",
      "execute_pty_kill",
    ];
    const profileTerminalCommands = [
      "list_desktop_terminal_profiles",
      "create_desktop_profile_pty",
      "send_desktop_profile_pty_input",
      "resize_desktop_profile_pty",
      "kill_desktop_profile_pty",
    ];

    expect(capability.webviews).toEqual(["main"]);
    expect(capability.windows).toBeUndefined();
    expect(capability.permissions).toContain("allow-desktop-core-bridge");
    expect(capability.permissions).toContain("allow-desktop-local-access");
    expect(capability.permissions).toContain("allow-desktop-profile-terminal");
    expect(capability.permissions).not.toContain(
      "allow-desktop-command-bridge",
    );
    expect(devCapability.permissions).toContain("allow-desktop-command-bridge");
    expect(rust).toContain("tauri::generate_handler![");
    expect(rust).toContain("tauri_plugin_deep_link::DeepLinkExt");
    expect(rust).toMatch(
      /#\[cfg\(debug_assertions\)\]\s*tauri::async_runtime::spawn\(start_cmd_server\(\)\)/,
    );

    for (const command of coreCommands) {
      expect(rust).toContain(command);
      expect(corePermission).toContain(`"${command}"`);
    }
    for (const command of localAccessCommands) {
      expect(rust).toContain(command);
      expect(localAccessPermission).toContain(`"${command}"`);
    }
    for (const command of developmentOnlyCommands) {
      expect(rust).toContain(command);
      expect(commandPermission).toContain(`"${command}"`);
    }
    for (const command of profileTerminalCommands) {
      expect(rust).toContain(command);
      expect(profileTerminalPermission).toContain(`"${command}"`);
      expect(commandPermission).not.toContain(`"${command}"`);
    }
    expect(profileTerminalPermission).toContain("No caller-provided command");
    expect(rust).toContain("resolve_terminal_workspace_cwd");
    expect(rust).toContain("MAX_DESKTOP_PROFILE_PTY_INPUT_BYTES");
  });
});
