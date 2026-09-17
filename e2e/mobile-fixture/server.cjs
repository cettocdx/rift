// Isolated fixture server: never reads .env or starts Next/Convex/workers.
// Loopback by default; a physical-device test can explicitly bind a local LAN IP.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../..");
const requireRoot = createRequire(path.join(root, "package.json"));
const store = path.join(root, "node_modules/.pnpm");
const installed = fs
  .readdirSync(store)
  .filter((name) => /^esbuild@/.test(name))
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
if (!installed) throw new Error("Install the workspace dependencies first");
const esbuild = require(path.join(store, installed, "node_modules/esbuild"));
const postcss = createRequire(requireRoot.resolve("@tailwindcss/postcss"))(
  "postcss",
);
const tailwind = requireRoot("@tailwindcss/postcss");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rift-mobile-fixture-"));
const renderDiagnostic = process.env.RIFT_RENDER_FIXTURE === "1";
const sidebar = renderDiagnostic || process.env.RIFT_SIDEBAR_FIXTURE === "1";
const transcript = process.env.RIFT_TRANSCRIPT_FIXTURE === "1";
const mobileTools = process.env.RIFT_MOBILE_TOOLS_FIXTURE === "1";
const hack = process.env.RIFT_HACK_FIXTURE === "1";
const completionProfile =
  transcript && process.env.RIFT_COMPLETION_PROFILE === "1";
const chatShell = transcript || process.env.RIFT_CHAT_SHELL_FIXTURE === "1";
const shellNavigation = chatShell && !transcript;
const shellServices = JSON.stringify(
  path.join(__dirname, "chat-shell-services.ts"),
);
const composer = chatShell || process.env.RIFT_COMPOSER_FIXTURE === "1";
const plugins = process.env.RIFT_PLUGINS_FIXTURE === "1";
const switches = process.env.RIFT_SWITCH_FIXTURE === "1";
const settings = process.env.RIFT_SETTINGS_FIXTURE === "1";
const workspaceTargets = process.env.RIFT_WORKSPACE_TARGETS_FIXTURE === "1";
const defaultPort = sidebar
  ? 3038
  : workspaceTargets
    ? 3042
    : settings
      ? 3041
      : switches
        ? 3040
        : plugins
          ? 3039
          : composer
            ? 3038
            : 3037;
const port =
  process.env.RIFT_FIXTURE_PORT === undefined
    ? defaultPort
    : Number(process.env.RIFT_FIXTURE_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid fixture loopback port");
const host = process.env.RIFT_FIXTURE_HOST || "127.0.0.1";
if (host !== "127.0.0.1") {
  const privateIPv4 = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(host);
  const local = Object.values(os.networkInterfaces()).flat().some(
    (address) => address && address.family === "IPv4" && address.address === host,
  );
  if (!privateIPv4 || !local) throw new Error("Fixture host must be a local private IPv4 address");
}
let server;
function cleanup() {
  server?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
process.once("SIGTERM", () => {
  cleanup();
  process.exit(0);
});
process.once("SIGINT", () => {
  cleanup();
  process.exit(0);
});

(async () => {
  await esbuild.build({
    entryPoints: [
      path.join(
        __dirname,
        hack
          ? "hack-entry.tsx"
          : renderDiagnostic
            ? "render-entry.tsx"
            : sidebar
              ? "sidebar-entry.tsx"
              : transcript
                ? "transcript-entry.tsx"
                : chatShell
                  ? "chat-shell-entry.tsx"
                  : workspaceTargets
                    ? "workspace-targets-entry.tsx"
                    : settings
                      ? "settings-entry.tsx"
                      : switches
                        ? "switch-entry.tsx"
                        : plugins
                          ? "plugins-entry.tsx"
                          : composer
                            ? "composer-entry.tsx"
                            : "entry.tsx",
      ),
    ],
    bundle: true,
    jsx: "automatic",
    platform: "browser",
    outfile: path.join(temp, "app.js"),
    tsconfig: path.join(root, "tsconfig.json"),
    define: {
      "process.env.NODE_ENV": completionProfile ? '"development"' : '"test"',
      "process.env": "{}",
    },
    plugins: [
      {
        name: "isolated-service-boundaries",
        setup(build) {
          if (hack) {
            const services = JSON.stringify(
              path.join(__dirname, "hack-services.ts"),
            );
            const modules = {
              "contexts/GlobalState.tsx": `export {useGlobalState} from ${services};`,
              "hooks/useRetainedChat.ts": `export {useRetainedChat} from ${services};`,
              "hooks/useAutoResume.ts": "export const useAutoResume=()=>false;",
              "hooks/useFileUpload.ts": `export {useFileUpload} from ${services};`,
              "lib/chat/hack-transport.ts":
                "export const fetchHackChatStream=()=>{throw Error('Assessment transport disabled in fixture')};export const cancelHackRun=fetchHackChatStream;",
            };
            build.onLoad({ filter: /\.[tj]sx?$/ }, (args) => {
              const entry = Object.entries(modules).find(([suffix]) =>
                args.path.endsWith(suffix),
              );
              return entry ? { contents: entry[1], loader: "jsx" } : undefined;
            });
          }
          if (completionProfile) {
            const helper = JSON.stringify(
              path.join(__dirname, "completion-profile.ts"),
            );
            const replaceOnce = (source, before, after) => {
              if (source.split(before).length !== 2)
                throw new Error("Completion instrumentation source mismatch");
              return source.replace(before, after);
            };
            build.onLoad(
              {
                filter:
                  /(?:AgentActivityPanel|MemoizedMarkdown|MessageItem)\.tsx$|component-.*\.mjs$/,
              },
              (args) => {
                let source = fs.readFileSync(args.path, "utf8");
                if (args.path.endsWith("/AgentActivityPanel.tsx")) {
                  source = replaceOnce(
                    source,
                    "export function AgentActivityPanel(",
                    "function ActualAgentActivityPanel(",
                  );
                  return {
                    loader: "tsx",
                    contents:
                      `import {Profiler as CompletionProfiler} from "react";import {completionProfiler} from ${helper};\n` +
                      source +
                      '\nexport function AgentActivityPanel(props: AgentActivityPanelProps) { return <CompletionProfiler id="Activity" onRender={completionProfiler}><ActualAgentActivityPanel {...props}/></CompletionProfiler>; }',
                  };
                }
                if (args.path.endsWith("/MemoizedMarkdown.tsx")) {
                  source = replaceOnce(
                    source,
                    "createIncrementalMarkdownParser(parseMarkdownIntoBlocks)",
                    'createIncrementalMarkdownParser((text) => profileCompletionCall("markdown-parse", () => parseMarkdownIntoBlocks(text)))',
                  );
                } else if (args.path.endsWith("/MessageItem.tsx")) {
                  source = replaceOnce(
                    source,
                    "extractWebSourcesFromMessage(message as any)",
                    'profileCompletionCall("web-sources", () => extractWebSourcesFromMessage(message as any))',
                  );
                } else if (
                  args.path.includes("/react-shiki/") &&
                  source.includes("async function highlight(code,")
                ) {
                  source = replaceOnce(
                    source,
                    "async function highlight(code, resolved, opts, factory) {",
                    'async function highlight(code, resolved, opts, factory) { recordCompletion("shiki-job");',
                  );
                  source = replaceOnce(
                    source,
                    'return opts.outputFormat === "html" ? highlighter.codeToHtml(code, options) : toJsxRuntime(highlighter.codeToHast(code, options), {',
                    'return profileCompletionCall("shiki-render", () => opts.outputFormat === "html" ? highlighter.codeToHtml(code, options) : toJsxRuntime(highlighter.codeToHast(code, options), {',
                  );
                  source = replaceOnce(
                    source,
                    "\t\tFragment\n\t});\n}",
                    "\t\tFragment\n\t}));\n}",
                  );
                } else return undefined;
                return {
                  loader: args.path.endsWith(".mjs") ? "js" : "tsx",
                  contents:
                    `import {profileCompletionCall,recordCompletion} from ${helper};\n` +
                    source,
                };
              },
            );
          }
          if (sidebar) {
            const sidebarModules = {
              "contexts/GlobalState.tsx": `export {useGlobalState} from ${JSON.stringify(path.join(__dirname, renderDiagnostic ? "render-services.ts" : "sidebar-services.ts"))};`,
              "hooks/useChats.ts":
                "export const usePinChat=()=>()=>{throw Error('Disabled')};export const useUnpinChat=usePinChat;",
              "components/ShareDialog.tsx":
                "export const ShareDialog=()=>null;",
              "components/SidebarHeader.tsx": `export { SIDEBAR_SECTION_LABEL_CLASS } from ${JSON.stringify(path.join(root, "lib/ui/workspace-chrome.ts"))};`,
            };
            build.onLoad({ filter: /\.[tj]sx?$/ }, (args) => {
              const entry = Object.entries(sidebarModules).find(([suffix]) =>
                args.path.endsWith(suffix),
              );
              return entry ? { contents: entry[1], loader: "jsx" } : undefined;
            });
          }
          if (renderDiagnostic || transcript) {
            const inactiveModules = {
              "lib/pricing/model-price.ts":
                "export const formatModelPrice=()=>({input:'Offline',output:'Offline'});",
              "hooks/useDesktopWorkspaceAccess.ts":
                "export const useDesktopWorkspaceAccess=()=>({grants:[]});",
              ...(mobileTools
                ? {}
                : {
                    "components/ComputerSidebar.tsx":
                      "export const ComputerSidebarBase=()=>null;",
                    "components/BuildPreviewPanel.tsx":
                      "export const BuildPreviewPanel=()=>null;",
                    "components/workbench/WorkbenchBrowser.tsx":
                      "export const WorkbenchBrowser=()=>null;",
                  }),
              "components/pro/HomeWorkspacePane.tsx":
                "export const HomeWorkspacePane=()=>null;",
            };
            build.onLoad({ filter: /\.[tj]sx?$/ }, (args) => {
              const entry = Object.entries(inactiveModules).find(([suffix]) =>
                args.path.endsWith(suffix),
              );
              return entry ? { contents: entry[1], loader: "jsx" } : undefined;
            });
          }
          if (chatShell) {
            // Keep the real ProChatLayout/header and question/composer components.
            // Disable only unrelated side panels and service-owning boundaries.
            const isolatedShellModules = {
              ...(transcript
                ? {
                    "hooks/useFeedback.ts":
                      "export const useFeedback=()=>({feedbackInputMessageId:null,handleFeedback:()=>{},handleFeedbackSubmit:async()=>{},handleFeedbackCancel:()=>{}});",
                    "components/DataStreamProvider.tsx":
                      "export const useDataStreamState=()=>({isAutoResuming:false,isReplaying:false}); export const useDataStreamDispatch=()=>()=>{}; export const useDataStream=()=>[];",
                  }
                : {}),
              ...(shellNavigation
                ? {}
                : {
                    "components/Sidebar.tsx": "export default ()=>null;",
                    "components/SidebarUserNav.tsx": "export default ()=>null;",
                  }),
              "components/pro/ProCommandPalette.tsx":
                "export const ProCommandPalette=()=>null;",
              "components/pro/ProShortcutsDialog.tsx":
                "export const ProShortcutsDialog=()=>null;export const openShortcutsDialog=()=>{};",
              "components/pro/WorkspaceHistoryNavigation.tsx":
                "export const WorkspaceHistoryNavigation=()=>null;",
              "components/terminal/TerminalDock.tsx":
                "export const TerminalDock=()=>null;",
              "components/terminal/RiftConsoleConnection.tsx":
                "export const RiftConsoleConnection=()=>null;",
              "components/terminal/RiftAgentConsoleContext.tsx":
                "export const RiftAgentConsoleProvider=({children})=>children;",
              "components/launch/AppLaunchProvider.tsx":
                "export const AppLaunchComplete=()=>null;",
              "hooks/useChats.ts": shellNavigation
                ? `export {useChats,usePinChat,useUnpinChat} from ${shellServices};`
                : "export const useChats=()=>undefined;",
              "hooks/useChatNavigation.ts": shellNavigation
                ? `export {useChatNavigation,chatIdFromPathname} from ${shellServices};`
                : "export const useChatNavigation=()=>({goPurpose:()=>{}});",
              "components/pro/useProKeyboardShortcuts.ts":
                "export const useProKeyboardShortcuts=()=>{};",
            };
            build.onLoad({ filter: /\.[tj]sx?$/ }, (args) => {
              const entry = Object.entries(isolatedShellModules).find(
                ([suffix]) => args.path.endsWith(suffix),
              );
              return entry ? { contents: entry[1], loader: "jsx" } : undefined;
            });
          }
          if (composer || settings || workspaceTargets) {
            build.onLoad({ filter: /contexts\/GlobalState\.tsx$/ }, () => ({
              contents: workspaceTargets
                ? "export const useGlobalState=()=>({subscription:'pro'});"
                : `export { useGlobalState } from ${JSON.stringify(path.join(__dirname, transcript ? "transcript-dock-state.tsx" : chatShell ? "chat-shell-state.tsx" : "composer-state.tsx"))};`,
              loader: "js",
            }));
            build.onLoad({ filter: /hooks\/useAuth\.tsx?$/ }, () => ({
              contents: shellNavigation
                ? `export {useAuth} from ${shellServices};`
                : "export const useAuth=()=>({user:{id:'fixture-only',email:'fixture@example.invalid'}});",
              loader: "js",
            }));
          }
          if (composer) {
            build.onLoad({ filter: /hooks\/useFileUpload\.tsx?$/ }, () => ({
              contents:
                "export const useFileUpload=()=>({handlePasteEvent:async()=>{}});",
              loader: "js",
            }));
          }
          // Keep the profile editor real; only the separate roster route is out of scope.
          if (workspaceTargets) {
            build.onLoad(
              { filter: /agents\/AgentsWorkbench\.tsx$/ },
              (args) => ({
                contents: `export const ${path.basename(args.path, ".tsx")}=()=>null;`,
                loader: "js",
              }),
            );
          }
          const modules = {
            "convex/react": hack
              ? `export {useQuery,usePaginatedQuery,useMutation,useAction,useConvex} from ${JSON.stringify(path.join(__dirname, "hack-services.ts"))};`
              : shellNavigation
                ? `export {useQuery,useQueries,usePaginatedQuery,useMutation,useAction,useConvex} from ${shellServices};`
                : sidebar
                  ? "export const useMutation=()=>()=>{throw Error('Services disabled in sidebar fixture')};"
                  : workspaceTargets
                    ? `export {useQuery,useMutation,useAction} from ${JSON.stringify(path.join(__dirname, "workspace-targets-services.ts"))};`
                    : transcript
                      ? `import {rejectTranscriptService} from ${JSON.stringify(path.join(__dirname, "transcript-dock-state.tsx"))}; import {getFunctionName} from "convex/server";const client={};export const useQuery=()=>undefined;export const useConvex=()=>client;export const useAction=(reference)=>async(args)=>{const download=window.__fixtureDownload;if(download && getFunctionName(reference)==="s3Actions:getFileUrlAction" && args?.fileId==="fixture-generated-image"){download.resolutions++;if(download.deny)throw Error("Fixture authorization denied");return download.url;}return rejectTranscriptService("action")};export const useMutation=()=>()=>rejectTranscriptService("mutation");`
                      : settings
                        ? `export {useQuery,useMutation,useAction} from ${JSON.stringify(path.join(__dirname, "settings-services.ts"))};`
                        : switches
                          ? `export {useQuery,useMutation} from ${JSON.stringify(path.join(__dirname, "switch-services.ts"))};`
                          : plugins
                            ? `export {useQuery,useMutation} from ${JSON.stringify(path.join(__dirname, "plugins-services.ts"))};`
                            : "export const useQuery=()=>undefined;export const useConvex=()=>({});export const useAction=()=>()=>{throw Error('Services disabled in mobile fixture')};",
            "next/navigation": shellNavigation
              ? `export {usePathname,useRouter,useSearchParams} from ${shellServices};`
              : sidebar
                ? `export {usePathname,useRouter,useSearchParams} from ${JSON.stringify(path.join(__dirname, "sidebar-services.ts"))};`
                : "export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push:()=>{throw Error('Navigation disabled in fixture')}});",
          };
          if (shellNavigation) {
            modules["@convex-dev/auth/react"] =
              `export {useAuthActions} from ${shellServices};`;
          }
          build.onResolve(
            {
              filter:
                /^(convex\/react|next\/navigation|@convex-dev\/auth\/react)$/,
            },
            (args) =>
              modules[args.path]
                ? { path: args.path, namespace: "fixture-stub" }
                : undefined,
          );
          build.onLoad({ filter: /.*/, namespace: "fixture-stub" }, (args) => ({
            contents: modules[args.path],
            loader: "jsx",
            resolveDir: root,
          }));
          // The focus fixture's activity pane is not part of these control tests.
          build.onLoad(
            { filter: /components\/AgentActivityPanel\.tsx$/ },
            () =>
              renderDiagnostic || transcript
                ? undefined
                : {
                    contents: "export const AgentActivityPanel=()=>null;",
                    loader: "js",
                  },
          );
        },
      },
    ],
  });
  const globals = fs
    .readFileSync(path.join(root, "app/globals.css"), "utf8")
    .replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const composerCss =
    hack ||
    sidebar ||
    composer ||
    plugins ||
    switches ||
    settings ||
    workspaceTargets
      ? fs.readFileSync(
          process.env.RIFT_COMPOSER_CSS ||
            path.join(root, "app/styles/workspace.css"),
          "utf8",
        ) +
        fs.readFileSync(path.join(root, "app/styles/typography.css"), "utf8") +
        fs.readFileSync(path.join(root, "app/styles/mobile-chat.css"), "utf8")
      : "";
  const css = await postcss([tailwind({ base: root })]).process(
    globals +
      composerCss +
      (hack
        ? '\n@source "./components/HackerMode.tsx";\n@source "./components/hack";\n@source "./components/ToolApprovalRequests.tsx";\n'
        : "") +
      (mobileTools
        ? '\n@source "./components/MobileToolDialog.tsx";\n@source "./components/ComputerSidebar.tsx";\n@source "./components/BuildPreviewPanel.tsx";'
        : "") +
      (transcript
        ? '\n@source "./components/CodeHighlight.tsx";\n@source "./components/MemoizedMarkdown.tsx";\n'
        : "") +
      (renderDiagnostic || transcript
        ? '\n@source "./components/AgentActivityPanel.tsx";\n@source "./components/workbench/WorkbenchDock.tsx";\n@source "../e2e/mobile-fixture/render-entry.tsx";\n'
        : "") +
      (sidebar
        ? '\n@source "./components/SidebarHistory.tsx";\n@source "./components/ChatItem.tsx";\n@source "../e2e/mobile-fixture/sidebar-entry.tsx";\n'
        : "") +
      (workspaceTargets
        ? '\n@source "./components/projects";\n@source "./components/ArtifactsGallery.tsx";\n@source "./components/runs";\n@source "./components/tasks";\n@source "./components/agents";\n@source "./components/page-shell";\n@source "./components/AppearanceSettingsTab.tsx";\n@source "./components/settings";\n@source "../e2e/mobile-fixture/workspace-targets-entry.tsx";\n'
        : "") +
      (settings
        ? '\n@source "./components/ApiKeysTab.tsx";\n@source "./components/ExtraUsageSection.tsx";\n@source "./components/AccountTab.tsx";\n@source "./components/DeleteAccountDialog.tsx";\n@source "./components/extra-usage";\n@source "./components/AppearanceSettingsTab.tsx";\n@source "./components/settings";\n@source "../e2e/mobile-fixture/settings-entry.tsx";\n'
        : "") +
      (switches
        ? '\n@source "./components/PersonalizationTab.tsx";\n@source "../e2e/mobile-fixture/switch-entry.tsx";\n'
        : "") +
      (plugins
        ? '\n@source "./components/McpMarketplace.tsx";\n@source "./components/RegistryPlugins.tsx";\n@source "./components/page-shell";\n@source "../e2e/mobile-fixture/plugins-entry.tsx";\n'
        : "") +
      (chatShell
        ? '\n@source "./components/pro/ProChatLayout.tsx";\n@source "../e2e/mobile-fixture/chat-shell-entry.tsx";\n@source "../e2e/mobile-fixture/transcript-entry.tsx";\n@source "./components/Messages.tsx";\n@source "./components/MessageItem.tsx";\n'
        : "") +
      (shellNavigation
        ? '\n@source "./components/Sidebar.tsx";\n@source "./components/SidebarHeader.tsx";\n@source "./components/SidebarUserNav.tsx";\n@source "./components/SidebarGithub.tsx";\n@source "./components/GithubConnectButton.tsx";\n@source "./components/SidebarProjects.tsx";\n@source "./components/SidebarHistory.tsx";\n@source "./components/SidebarActiveRuns.tsx";\n@source "./components/usage";\n@source "../lib/ui/workspace-chrome.ts";\n'
        : "") +
      (composer
        ? '\n@source "./components/ChatInput";\n@source "./components/AttachmentButton.tsx";\n@source "../e2e/mobile-fixture/composer-entry.tsx";\n'
        : "") +
      '\n@source "./lab/scroll/page.tsx";\n@source "./lab/focus/page.tsx";\n@source "./components/FilePartRenderer.tsx";\n@source "./components/GeneratingImagePlaceholder.tsx";\n@source "./components/ImageViewer.tsx";\n@source "../components/ui";',
    { from: path.join(root, "app/mobile-fixture.css") },
  );
  // Adapt only the lab's desktop debug toolbar, not the production transcript.
  // Its original unwrapped row expands the page's visual viewport on phones.
  const fixtureChrome = `
    [data-mobile-fixture="/lab/scroll"] header {
      height:auto;min-height:48px;flex-wrap:wrap;gap:8px;padding:8px;
    }
    [data-mobile-fixture="/lab/scroll"] header button {
      min-height:44px;padding:0 8px;border:1px solid var(--border);border-radius:6px;
    }
  `;
  fs.writeFileSync(path.join(temp, "styles.css"), css.css + fixtureChrome);
  const viewportDiagnostics = `<script>
    if (new URLSearchParams(location.search).has('viewportDiagnostics')) {
      const output = document.createElement('output');
      output.style.cssText = 'position:fixed;bottom:0;left:0;z-index:99999;font:10px monospace;background:white;color:black;pointer-events:none';
      document.body.append(output);
      const report = () => {
        const v = visualViewport, r = document.querySelector('.rift-chat-viewport');
        output.textContent = 'Viewport ' + JSON.stringify({ scale:v.scale, width:innerWidth, height:innerHeight, vheight:v.height, offset:v.offsetTop, scroll:scrollY, rootY:r?.getBoundingClientRect().y, rootH:r?.getBoundingClientRect().height, active:r?.getAttribute('data-rift-visible-viewport'), coarse:matchMedia('(pointer:coarse)').matches });
      };
      visualViewport.addEventListener('resize', () => setTimeout(report,300));
      visualViewport.addEventListener('scroll', () => setTimeout(report,300));
      document.addEventListener('focusin', () => setTimeout(report,1000));
      setTimeout(report,1000);
    }
  </script>`;
  const html =
    '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script>' +
    viewportDiagnostics +
    "</body></html>";
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://127.0.0.1").pathname;
    if (renderDiagnostic)
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'",
      );
    const assets = {
      "/app.js": [path.join(temp, "app.js"), "text/javascript"],
      "/app.css": [path.join(temp, "app.css"), "text/css"],
      "/styles.css": [path.join(temp, "styles.css"), "text/css"],
      "/scroll-fixture.svg": [
        path.join(root, "public/scroll-fixture.svg"),
        "image/svg+xml",
      ],
    };
    if (mobileTools && pathname === "/api/preview/status") {
      // Isolate the health service, while keeping the production hook and
      // its chat/URL identity checks active in the preview interaction tests.
      const query = new URL(req.url, "http://127.0.0.1").searchParams;
      const previewUrl = `http://${host}:${server.address().port}/preview-fixture`;
      const valid =
        query.get("chatId") === "mobile-preview-fixture" &&
        query.get("previewUrl") === previewUrl;
      res.writeHead(valid ? 200 : 404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          valid
            ? {
                chatId: "mobile-preview-fixture",
                previewUrl,
                status: "running",
                url: previewUrl,
              }
            : { error: "Unknown fixture preview" },
        ),
      );
    } else if (mobileTools && pathname.startsWith("/preview-fixture")) {
      res.setHeader("Content-Type", "text/html");
      res.end(
        "<!doctype html><meta name=viewport content=width=device-width><h1>Live preview fixture</h1><button onclick=\"this.textContent='Interacted'\">Try preview</button>",
      );
    } else if (renderDiagnostic && pathname === "/") {
      res.writeHead(302, { Location: "/c/chat-0?theme=dark" });
      res.end();
    } else if (plugins && /^\/plugin-logos\/[a-zA-Z0-9_.-]+$/.test(pathname)) {
      const file = path.join(root, "public", pathname);
      res.setHeader(
        "Content-Type",
        pathname.endsWith(".svg") ? "image/svg+xml" : "image/png",
      );
      res.end(fs.existsSync(file) ? fs.readFileSync(file) : "");
    } else if (assets[pathname]) {
      const [file, type] = assets[pathname];
      res.setHeader("Content-Type", type);
      res.end(fs.existsSync(file) ? fs.readFileSync(file) : "");
    } else if (
      (sidebar && pathname.startsWith("/c/")) ||
      [
        "/lab/scroll",
        "/lab/focus",
        "/lab/browser",
        "/lab/composer",
        "/lab/plugins",
        "/lab/switch",
        "/lab/settings",
        "/lab/workspace-targets",
        "/health",
      ].includes(pathname)
    ) {
      res.setHeader("Content-Type", "text/html");
      res.end(html);
    } else {
      res.writeHead(404);
      res.end("Not a mobile fixture route");
    }
  });
  server.listen(port, host, () =>
    console.log(`Mobile fixtures ready on http://${host}:${port}`),
  );
})().catch((error) => {
  console.error(error);
  cleanup();
  process.exitCode = 1;
});
