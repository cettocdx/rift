// Real terminal/render/input components; only native transport and app providers
// are synthetic. No application service or shell is started by this fixture.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
module.exports = async function buildTerminalFixture() {
  const store = path.join(root, "node_modules/.pnpm");
  const installed = fs.readdirSync(store).find((n) => n.startsWith("esbuild@"));
  const esbuild = require(path.join(store, installed, "node_modules/esbuild"));
  const replacements = {
    "app/hooks/useTauri.ts": "export const isTauriEnvironment=()=>true;",
    "app/components/workbench/WorkbenchProvider.tsx":
      "const headers={};export const useWorkbenchRequestHeaders=()=>headers;",
    "app/components/workbench/WorkbenchActivity.tsx":
      "export const useOptionalWorkbenchActivityPublisher=()=>null;",
    "app/services/desktop-terminal-owner.ts":
      'export const DESKTOP_TERMINAL_OWNER_CHANGED_EVENT="fixture-owner-changed";',
    "app/services/desktop-profile-terminal.ts": fs.readFileSync(
      path.join(__dirname, "terminal-transport.fixture.txt"),
      "utf8",
    ),
  };
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, "terminal-entry.tsx")],
    outfile: "terminal.js",
    bundle: true,
    write: false,
    jsx: "automatic",
    platform: "browser",
    tsconfig: path.join(root, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [
      {
        name: "isolated-terminal",
        setup(build) {
          build.onResolve({ filter: /^next-themes$/ }, () => ({
            path: "theme",
            namespace: "fixture",
          }));
          build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "export const useTheme=()=>({resolvedTheme:window.fixtureTheme});",
            loader: "js",
          }));
          build.onLoad({ filter: /\.[tj]sx?$/ }, (args) => {
            const relative = path.relative(root, args.path);
            if (replacements[relative])
              return { contents: replacements[relative], loader: "ts" };
            if (
              relative ===
              "app/components/workbench/WorkbenchInteractiveTerminal.tsx"
            ) {
              // Observe the actual xterm instance without replacing its renderer.
              const source = fs
                .readFileSync(args.path, "utf8")
                .replace(
                  "terminalRef.current = terminal;",
                  "terminalRef.current = terminal; window.fixtureTerminal = terminal;",
                );
              return { contents: source, loader: "tsx" };
            }
          });
        },
      },
    ],
  });
  return {
    js: result.outputFiles.find((f) => f.path.endsWith(".js")).text,
    css: result.outputFiles.find((f) => f.path.endsWith(".css")).text,
  };
};
