// Real Workbench shell, Explorer, provider and app CSS. In-memory adapter and
// textarea Monaco boundary test navigation/save, not Monaco or backend reads.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../..");
const req = createRequire(path.join(root, "package.json"));
module.exports = async function buildWorkbenchFileFixture({
  realMonaco = false,
  entryPoint = path.join(__dirname, "workbench-file-entry.tsx"),
} = {}) {
  const store = path.join(root, "node_modules/.pnpm");
  const esbuild = require(
    path.join(
      store,
      fs.readdirSync(store).find((n) => n.startsWith("esbuild@")),
      "node_modules/esbuild",
    ),
  );
  const replacements = {
    "app/components/computer-sidebar-utils.tsx":
      "export const getLanguageFromPath=()=>'typescript';",
    "app/components/workbench/WorkbenchActivity.tsx":
      "export const useWorkbenchActivity=()=>({terminal:null,interactiveTerminal:'starting'});",
    "app/components/workbench/WorkbenchTerminalPanel.tsx":
      "export const WorkbenchTerminalPanel=()=>null;",
    "app/contexts/GlobalState.tsx":
      "export const useGlobalState=()=>({initializeNewChat(){},closeSidebar(){}});",
    "app/hooks/useChatNavigation.ts":
      "export const useChatNavigation=()=>({goHome(){}});export const chatIdFromPathname=()=>null;",
    "app/hooks/useHydrated.ts": "export const useHydrated=()=>true;",
    "app/components/pro/ProTitlebarModelMenu.tsx":
      "export const ProTitlebarModelMenu=()=>null;export const getWorkspaceModeLabel=()=>'';",
    "app/components/settings/useSettingsNavigation.ts":
      "export const useSettingsNavigation=()=>({openSettings(){}});",
    "lib/utils/command-palette.ts": "export const openCommandPalette=()=>{};",
  };
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    outfile: path.join(__dirname, "fixture-bundle.js"),
    jsx: "automatic",
    platform: "browser",
    tsconfig: path.join(root, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [
      {
        name: "offline-panel",
        setup(build) {
          build.onResolve(
            { filter: /^next\/(dynamic|navigation)$/ },
            (args) => ({ path: args.path, namespace: "fixture" }),
          );
          build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            loader: "tsx",
            resolveDir: root,
            contents:
              args.path === "next/dynamic"
                ? realMonaco
                  ? `import React from 'react';export default function dynamic(load){const Component=React.lazy(()=>load().then(defaultExport=>({default:defaultExport})));return function Loaded(props){return <React.Suspense fallback={<div>Loading editor</div>}><Component {...props}/></React.Suspense>}}`
                  : `import React from 'react';import {useWorkbench} from './app/components/workbench/WorkbenchProvider';export default function dynamic(){return function MonacoBoundary({value,onChange}){const {state}=useWorkbench();const document=state.documents[state.activePath];return <textarea aria-label="File contents" value={value} onChange={event=>onChange(event.target.value)} data-dirty={document.content!==document.savedContent} data-saved-content={document.savedContent} data-revision={document.revision} data-status={document.status} data-error={document.error??''} />}}`
                : "export const usePathname=()=>'/fixture';export const useRouter=()=>({push(){}});export const useSearchParams=()=>new URLSearchParams();export default()=>()=>null;",
          }));
          build.onLoad({ filter: /\.[tj]sx?$/ }, (args) => {
            const content = replacements[path.relative(root, args.path)];
            if (content)
              return { contents: content, loader: "tsx", resolveDir: root };
          });
        },
      },
    ],
  });
  const globals = fs
    .readFileSync(path.join(root, "app/globals.css"), "utf8")
    .replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const postcss = createRequire(req.resolve("@tailwindcss/postcss"))("postcss");
  const css = await postcss([
    req("@tailwindcss/postcss")({ base: root }),
  ]).process(
    globals +
      fs.readFileSync(path.join(root, "app/styles/workspace.css"), "utf8") +
      fs.readFileSync(path.join(root, "app/styles/typography.css"), "utf8") +
      '\n@source "./components/ComputerCodeBlock.tsx";\n@source "./components/DiffView.tsx";\n@source "./components/workbench/Workbench.tsx";\n@source "./components/workbench/WorkbenchExplorer.tsx";\n@source "./components/workbench/WorkbenchEditor.tsx";\n@source "../components/ui";',
    { from: path.join(root, "app/workbench-file-fixture.css") },
  );
  return {
    js: result.outputFiles.find((file) => file.path.endsWith(".js")).text,
    css:
      css.css +
      (result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ||
        ""),
  };
};
